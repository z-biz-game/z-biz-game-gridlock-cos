// Sound for 死锁车库: a handful of short synthesised clunks, no audio files.
//
// 两件事按派工单 §2 的口径做实，不是做做样子：
//   ① **静音是真静音**。`setMuted(true)` 走 `AudioContext.suspend()`，并且 `voice()` 在静音态
//      直接返回 false —— 一个都不新建振荡器。只把 master gain 设 0 是假静音：节点照样建、
//      照样排程、照样吃 CPU，而 `oscillators` 这个计数器就是用来当场验这一条的。
//   ② AudioContext **懒建**：浏览器在首次用户手势之前不允许出声，构造期 new AudioContext()
//      会留下一条 suspended 的僵尸上下文；这里第一次要发声时才建。
//
// 没有 Web Audio 的环境（node 测试、老 Electron）里整套 API 退化成 no-op，调用方不必判空。

const TONES = {
  // 一次滑到位：木质的"咔"。
  slide: { freq: 196, type: 'triangle', dur: 0.09, gain: 0.24, slide: -60 },
  // 撞上邻车／水泥墩：闷而短。
  blocked: { freq: 92, type: 'square', dur: 0.06, gain: 0.16, slide: -28 },
  // 提示：两声上行，像地库里的对讲机。
  hint: { freq: 523, type: 'sine', dur: 0.07, gain: 0.16, slide: 120 },
  // 撤销：同一声下行。
  undo: { freq: 330, type: 'sine', dur: 0.07, gain: 0.14, slide: -110 },
  // 界面点击。
  tap: { freq: 660, type: 'square', dur: 0.03, gain: 0.07 },
};

export function createAudio({ isMuted, reducedMotion } = {}) {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  let ctx = null;
  let master = null;
  let stats = { created: 0, started: 0, refused: 0, suspends: 0, resumes: 0 };

  const muted = () => (isMuted ? !!isMuted() : false);
  const available = () => !!AC;

  function ensure() {
    if (!available() || muted()) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended' && ctx.resume) {
      ctx.resume().catch(() => { /* autoplay policy still holding it */ });
      stats.resumes += 1;
    }
    return ctx;
  }

  function voice(name, when = 0) {
    const spec = TONES[name];
    if (!spec) return false;
    const c = ensure();
    if (!c) {
      // 静音态不建节点：这一条是"真静音"与"gain=0"的分界，实测就数它。
      stats.refused += 1;
      return false;
    }
    const t0 = c.currentTime + when;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.freq, t0);
    if (spec.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, spec.freq + spec.slide), t0 + spec.dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(spec.gain, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + spec.dur + 0.02);
    stats.created += 1;
    stats.started += 1;
    return true;
  }

  function arp(name) {
    const c = ensure();
    if (!c) {
      stats.refused += 1;
      return false;
    }
    // 出场：一段三音上行。reduceMotion 只留最后一个音，安静一点的口径同样适用于耳朵。
    const notes = reducedMotion && reducedMotion() ? [name] : [name, name * 1.26, name * 1.5];
    notes.forEach((f, i) => {
      const t0 = c.currentTime + i * 0.1;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t0);
      osc.stop(t0 + 0.34);
      stats.created += 1;
      stats.started += 1;
    });
    return true;
  }

  return {
    play(name) { return voice(name); },
    win() { return arp(392); },
    // 开关本身也要有反馈，但静音态点它不该有声音——所以先落状态再出声，由调用方保证顺序。
    toggle() { return voice('tap'); },
    setMuted(on) {
      if (!ctx) return;
      if (on) {
        if (ctx.suspend) ctx.suspend().catch(() => { /* already closed */ });
        stats.suspends += 1;
      } else if (ctx.resume) {
        ctx.resume().catch(() => { /* autoplay policy */ });
        stats.resumes += 1;
      }
    },
    get state() {
      return {
        available: available(),
        hasContext: !!ctx,
        contextState: ctx ? ctx.state : 'none',
        muted: muted(),
        ...stats,
      };
    },
    get stats() { return { ...stats }; },
  };
}
