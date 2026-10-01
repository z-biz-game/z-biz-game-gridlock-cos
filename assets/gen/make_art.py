#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""死锁车库 / GRIDLOCK —— 美术资产工厂（仓内自产、可复现、只依赖 python3 标准库）。

为什么手写 PNG 而不调 PIL/canvas：这张母图既要在 CI 里能重跑（`python3 assets/gen/make_art.py`），
又不能被一个装不上的图像库钉死。zlib + struct 手搓 RGBA PNG 就够；像素级确定性由自带的
整数哈希保证（不碰 random / time / PIL），同一条命令两次运行产出同一批字节 ——
`make_art.py && make_art.py` 后 `git status` 应当是干净的。

视觉母题：**夜色车库，钠灯琥珀**。
  · 底面是沥青（#14161a / #1d2026）加一层可平铺的骨料噪声 —— 俯视停车场的地面；
  · 外圈一道水泥路缘（#2b2f38 / #3a3f47），和 js/view.js 里的 CURB、围墙同一个色；
  · 车位线是漆在地上的一段段虚线（就是 LANE 的 rgba(226,232,240,.10)）；
  · 压住去路的车是低饱和街色（BODY 前几号：钢青、砖红、苔绿、卡其、藕紫），一律车顶朝上；
  · 主角车是唯一的琥珀（HERO #e0a63c），横停在最后一排、车头朝右冲向出口车道，
    出口上两道 Chevron 指出去 —— 这张图本身就是"把琥珀开出去"的玩法说明。
  · 图上的字用自绘的 5x7 路面警示牌点阵（只含拉丁字母与数字）：点阵汉字要引外部字体，
    那就不再是可复现的字节，所以中文只留在 index.html 的 meta 与页面里。

产物（全部落 assets/img/，index.html / manifest / og 引用的就是这些）：
  icon-master-1024.png  母图；其余尺寸都从它按面积平均采样下来
  icon-512.png / icon-192.png / icon-maskable-512.png  PWA（maskable 走 78% 安全区）
  apple-touch-icon.png (180)、favicon.png (48)、favicon-32.png、favicon-16.png
  og-gridlock.png (1200x630)  社交卡
  tex-asphalt-256.png / tex-concrete-256.png  可平铺纹理，js/view.js 用 createPattern 贴进游戏
"""
import math
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'assets', 'img')

# ---- palette: read out of js/view.js + css/game.css, not invented here ----
ASPHALT = (20, 22, 26)
ASPHALT_LOT = (29, 32, 38)
CURB = (43, 47, 56)
CONCRETE = (58, 63, 71)
AMBER = (224, 166, 60)
AMBER_DARK = (169, 119, 33)
CYAN = (120, 220, 255)
INK = (230, 233, 239)
DIM = (143, 152, 168)
STEEL = [(63, 95, 116), (122, 74, 74), (79, 107, 79), (125, 107, 63),
         (90, 74, 114), (63, 107, 102), (115, 82, 65), (74, 85, 112)]


def write_png(path, w, h, px):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += px[y * w * 4:(y + 1) * w * 4]
    def chunk(tag, payload):
        return (struct.pack('>I', len(payload)) + tag + payload
                + struct.pack('>I', zlib.crc32(tag + payload) & 0xFFFFFFFF))
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as fh:
        fh.write(png)
    return len(png)


class Buf:
    def __init__(self, w, h, rgb=(0, 0, 0, 255)):
        self.w, self.h = w, h
        self.px = bytearray(bytes(bytearray(rgb)) * (w * h))

    def blend(self, x, y, rgba):
        if not (0 <= x < self.w and 0 <= y < self.h) or rgba[3] == 0:
            return
        o = (y * self.w + x) * 4
        a = rgba[3] / 255.0
        ia = 1 - a
        p = self.px
        p[o] = int(rgba[0] * a + p[o] * ia + 0.5)
        p[o + 1] = int(rgba[1] * a + p[o + 1] * ia + 0.5)
        p[o + 2] = int(rgba[2] * a + p[o + 2] * ia + 0.5)
        if rgba[3] > p[o + 3]:
            p[o + 3] = min(255, p[o + 3] + rgba[3])

    def get(self, x, y):
        o = (y * self.w + x) * 4
        return (self.px[o], self.px[o + 1], self.px[o + 2], self.px[o + 3])

    def tile_rows(self, tex, x0, y0, x1, y1, phase=0):
        """Blit a tileable texture over a box using row slices (no per-pixel calls)."""
        tw, tpx = tex.w, tex.px
        span = tw * 4
        reps = (self.w // tw) + 3
        rowcache = {}
        for y in range(max(0, y0), min(self.h, y1)):
            src = (((y + phase) % tex.h)) * span
            if src not in rowcache:
                rowcache[src] = tpx[src:src + span] * reps
            line = rowcache[src]
            sx = ((x0 + phase) % tw) * 4
            seg = line[sx:sx + (x1 - x0) * 4]
            o = (y * self.w + x0) * 4
            self.px[o:o + len(seg)] = seg

    def paste(self, other, ox, oy):
        for y in range(other.h):
            if not (0 <= oy + y < self.h):
                continue
            for x in range(other.w):
                if 0 <= ox + x < self.w:
                    self.blend(ox + x, oy + y, other.get(x, y))


def hash2(x, y, seed=1337):
    h = ((x * 374761393 + y * 668265263 + seed * 2654435761) & 0xFFFFFFFF)
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967295.0


def vnoise(x, y, cell, period, seed):
    """Bilinear value noise on a wrapping lattice => the tile seams cannot show."""
    fx, fy = x / cell, y / cell
    ix, iy = int(math.floor(fx)), int(math.floor(fy))
    tx, ty = fx - ix, fy - iy
    sx, sy = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    m = period
    def lat(i, j):
        return hash2(i % m, j % m, seed)
    a = lat(ix, iy) * (1 - sx) + lat(ix + 1, iy) * sx
    b = lat(ix, iy + 1) * (1 - sx) + lat(ix + 1, iy + 1) * sx
    return a * (1 - sy) + b * sy


def texture(w, h, base, grain, seed, speckle=0.0, aggregate=0.0):
    b = Buf(w, h, base + (255,))
    px = b.px
    c1, c2 = max(1, w // 21), max(1, w // 6)
    for y in range(h):
        for x in range(w):
            n = vnoise(x, y, 21.0, c1, seed) * 0.62 + vnoise(x, y, 6.0, c2, seed + 7) * 0.38
            k = grain * (n - 0.5) * 2
            r, g, bl = base[0] + k, base[1] + k * 0.96, base[2] + k * 0.92
            if aggregate:
                s = hash2(x, y, seed + 991)
                if s > 1 - aggregate:
                    lift = 26 + 34 * hash2(x, y, seed + 313)
                    r += lift
                    g += lift
                    bl += lift * 0.92
                elif s < aggregate * 0.6:
                    r -= 12
                    g -= 12
                    bl -= 10
            if speckle:
                j = (hash2(x, y, seed + 55) - 0.5) * speckle
                r += j
                g += j
                bl += j
            o = (y * w + x) * 4
            px[o] = 0 if r < 0 else (255 if r > 255 else int(r))
            px[o + 1] = 0 if g < 0 else (255 if g > 255 else int(g))
            px[o + 2] = 0 if bl < 0 else (255 if bl > 255 else int(bl))
    return b


# ------------------------------------------------------------- paint ops
def rect(b, x0, y0, x1, y1, rgba):
    x0, x1 = max(0, int(x0)), min(b.w, int(x1))
    y0, y1 = max(0, int(y0)), min(b.h, int(y1))
    if x1 <= x0 or y1 <= y0:
        return
    row = bytes(bytearray(rgba)) * (x1 - x0)
    for y in range(y0, y1):
        o = (y * b.w + x0) * 4
        b.px[o:o + len(row)] = row


_MASKS = {}


def rrect_alpha(w, h, r):
    key = (w, h, r)
    if key in _MASKS:
        return _MASKS[key]
    m = bytearray(w * h)
    rr = max(0.0, min(float(r), min(w, h) / 2.0))
    span = max(1, int(math.ceil(rr)) + 1)
    for y in range(h):
        for x in range(w):
            a = 255
            if x < span or y < span or x >= w - span or y >= h - span:
                dx = max(rr - x, x - (w - 1 - rr), 0.0)
                dy = max(rr - y, y - (h - 1 - rr), 0.0)
                d = math.hypot(dx, dy)
                if d > rr:
                    a = int(max(0.0, min(1.0, rr + 0.5 - d)) * 255)
                    if d - rr > 1.0:
                        a = 0
            m[y * w + x] = a
    _MASKS[key] = m
    return m


def round_rect(b, x, y, w, h, r, rgba):
    w, h = int(w), int(h)
    if w <= 0 or h <= 0:
        return
    x, y = int(x), int(y)
    m = rrect_alpha(w, h, r)
    a0, a1 = rgba[3] / 255.0, 1 - rgba[3] / 255.0
    px = b.px
    bw = b.w
    for j in range(h):
        by = y + j
        if not (0 <= by < b.h):
            continue
        ro = (by * bw + x) * 4
        mo = j * w
        for i in range(w):
            bx = x + i
            if not (0 <= bx < bw):
                continue
            cov = m[mo + i]
            if cov == 0:
                continue
            o = ro + i * 4
            k = a0 * (cov / 255.0)
            px[o] = int(rgba[0] * k + px[o] * (1 - k) + 0.5)
            px[o + 1] = int(rgba[1] * k + px[o + 1] * (1 - k) + 0.5)
            px[o + 2] = int(rgba[2] * k + px[o + 2] * (1 - k) + 0.5)
            na = rgba[3] * (cov / 255.0) + px[o + 3] * a1
            px[o + 3] = 255 if na > 255 else int(na)


def disc(b, cx, cy, rad, rgba):
    round_rect(b, cx - rad, cy - rad, rad * 2, rad * 2, rad, rgba)


def poly(b, pts, rgba):
    ys = [p[1] for p in pts]
    for y in range(max(0, int(min(ys))), min(b.h, int(max(ys)) + 1)):
        xs = []
        n = len(pts)
        for i in range(n):
            ax, ay = pts[i]
            bx, by = pts[(i + 1) % n]
            if (ay <= y < by) or (by <= y < ay):
                xs.append(ax + (y - ay) / (by - ay) * (bx - ax))
        xs.sort()
        for k in range(0, len(xs) - 1, 2):
            rect(b, round(xs[k]), y, round(xs[k + 1]) + 1, y + 1, rgba)


def glow(b, cx, cy, rad, rgba, power=1.0):
    a0 = rgba[3] / 255.0
    for y in range(max(0, int(cy - rad)), min(b.h, int(cy + rad))):
        for x in range(max(0, int(cx - rad)), min(b.w, int(cx + rad))):
            d = math.hypot(x - cx, y - cy) / rad
            if d > 1:
                continue
            f = (1 - d) ** 2.2 * power * a0
            if f > 0.004:
                b.blend(x, y, (rgba[0], rgba[1], rgba[2], int(f * 255)))


def apply_alpha(b, m, mode='cut'):
    """Multiply a 0..255 coverage map into the alpha channel ('cut' = keep colour)."""
    px = b.px
    for i in range(b.w * b.h):
        a = m[i]
        o = i * 4 + 3
        if mode == 'cut':
            px[o] = px[o] * a // 255
        else:
            px[o] = a


def badge_alpha(m, corner=0.205):
    w = bytearray(m * m)
    rr = m * corner
    span = int(math.ceil(rr)) + 1
    for y in range(m):
        ro = y * m
        dy = max(rr - y, y - (m - 1 - rr), 0.0)
        for x in range(m):
            dx = max(rr - x, x - (m - 1 - rr), 0.0)
            if (x < span or y < span or x >= m - span or y >= m - span) and dy:
                d = math.hypot(dx, dy)
                w[ro + x] = int(max(0.0, min(1.0, rr + 0.5 - d)) * 255) if d > rr else 255
            else:
                w[ro + x] = 255
    return w


# --------------------------------------------------------------- the motif
FONT = {}
for _k, _v in {
    'A': '01110 10001 10001 11111 10001 10001 10001',
    'B': '11110 10001 10001 11110 10001 10001 11110',
    'C': '01110 10001 10000 10000 10000 10001 01110',
    'D': '11110 10001 10001 10001 10001 10001 11110',
    'E': '11111 10000 10000 11110 10000 10000 11111',
    'F': '11111 10000 10000 11110 10000 10000 10000',
    'G': '01110 10001 10000 10111 10001 10001 01111',
    'H': '10001 10001 10001 11111 10001 10001 10001',
    'I': '11111 00100 00100 00100 00100 00100 11111',
    'J': '00111 00010 00010 00010 00010 10010 01100',
    'K': '10001 10010 10100 11000 10100 10010 10001',
    'L': '10000 10000 10000 10000 10000 10000 11111',
    'M': '10001 11011 10101 10101 10001 10001 10001',
    'N': '10001 11001 10101 10011 10001 10001 10001',
    'O': '01110 10001 10001 10001 10001 10001 01110',
    'P': '11110 10001 10001 11110 10000 10000 10000',
    'Q': '01110 10001 10001 10001 10101 10010 01101',
    'R': '11110 10001 10001 11110 10100 10010 10001',
    'S': '01111 10000 10000 01110 00001 00001 11110',
    'T': '11111 00100 00100 00100 00100 00100 00100',
    'U': '10001 10001 10001 10001 10001 10001 01110',
    'V': '10001 10001 10001 10001 10001 01010 00100',
    'W': '10001 10001 10001 10101 10101 11011 10001',
    'X': '10001 10001 01010 00100 01010 10001 10001',
    'Y': '10001 10001 01010 00100 00100 00100 00100',
    'Z': '11111 00001 00010 00100 01000 10000 11111',
    '0': '01110 10001 10011 10101 11001 10001 01110',
    '1': '00100 01100 00100 00100 00100 00100 01110',
    '2': '11110 00001 00001 01110 10000 10000 11111',
    '3': '11111 00010 00100 00010 00001 10001 01110',
    '4': '00010 00110 01010 10010 11111 00010 00010',
    '5': '11111 10000 11110 00001 00001 10001 01110',
    '6': '01110 10000 11110 10001 10001 10001 01110',
    '7': '11111 00001 00010 00100 01000 01000 01000',
    '8': '01110 10001 10001 01110 10001 10001 01110',
    '9': '01110 10001 10001 01111 00001 00001 01110',
    '.': '00000 00000 00000 00000 00000 01100 01100',
    ',': '00000 00000 00000 00000 01100 00100 01000',
    '-': '00000 00000 00000 11111 00000 00000 00000',
    '/': '00001 00010 00010 00100 01000 01000 10000',
    ':': '00000 01100 01100 00000 01100 01100 00000',
}.items():
    FONT[_k] = _v.split(' ')


def text_width(s, scale, track=0):
    return len(s) * (6 * scale + track) - track if s else 0


def fit_scale(s, maxw, track=2, cap=40):
    for sc in range(cap, 0, -1):
        if text_width(s, sc, track) <= maxw:
            return sc
    return 1


def text(b, x, y, s, scale, rgba, track=0):
    cx = x
    for ch in s.upper():
        if ch == ' ':
            cx += 6 * scale + track
            continue
        for r, row in enumerate(FONT.get(ch, FONT['-'])):
            for c, bit in enumerate(row):
                if bit == '1':
                    rect(b, cx + c * scale, y + r * scale, cx + (c + 1) * scale,
                         y + (r + 1) * scale, rgba)
        cx += 6 * scale + track
    return cx - x


def car(b, x, y, w, h, body, hero=False, facing='down', cell=40.0):
    """Top-down car, same recipe as js/view.js drawCar: body, inset cabin, glass at the nose."""
    short = min(w, h)
    round_rect(b, x, y, w, h, short * 0.22, tuple(body) + (255,))
    hi = tuple(min(255, int(c * 1.22)) for c in body)
    lo = tuple(max(0, int(c * 0.62)) for c in body)
    inset = int(short * 0.16)
    round_rect(b, x + inset, y + inset, w - inset * 2, h - inset * 2,
               max(2, short * 0.15), lo + (200,) if hero else (12, 16, 22, 120))
    roof = int(short * 0.09)
    if facing == 'right':
        round_rect(b, x + int(w * 0.30), y + inset + roof, int(w * 0.34),
                   h - inset * 2 - roof * 2, max(2, short * 0.10), hi + (150,))
    else:
        round_rect(b, x + inset + roof, y + int(h * 0.30), w - inset * 2 - roof * 2,
                   int(h * 0.34), max(2, short * 0.10), hi + (150,))
    glass = (190, 214, 236, 90) if not hero else (255, 244, 214, 120)
    t = max(2, int(short * 0.13))
    if facing == 'right':
        round_rect(b, x + int(w * 0.70), y + inset, t, h - inset * 2, 3, glass)
    else:
        round_rect(b, x + inset, y + int(h * 0.70), w - inset * 2, t, 3, glass)
    if hero:
        lw = max(3, int(short * 0.07))
        lamp = (255, 240, 205, 245)
        round_rect(b, x + w - lw, y + int(h * 0.20), lw, int(h * 0.20), lw // 2, lamp)
        round_rect(b, x + w - lw, y + int(h * 0.60), lw, int(h * 0.20), lw // 2, lamp)


def lot_motif(b, m, tex, con):
    """Curb ring -> asphalt -> painted bays -> jammed cars -> amber hero at the gate."""
    pad = int(m * 0.115)
    aw = m - pad * 2
    cols, rows = 5, 4
    cw = aw / cols
    hero_h = int(m * 0.205)
    gap = int(m * 0.05)
    ch = (aw - hero_h - gap) / rows
    b.tile_rows(con, 0, 0, m, m)
    inner = int(m * 0.085)
    iw = m - inner * 2
    lot = Buf(iw, iw, (0, 0, 0, 255))
    lot.tile_rows(tex, 0, 0, iw, iw)
    lotmask = rrect_alpha(iw, iw, int(m * 0.13))
    px, lpx = b.px, lot.px
    for y in range(iw):
        bo = ((y + inner) * m + inner) * 4
        mo = y * iw
        for x in range(iw):
            a = lotmask[mo + x]
            if a == 0:
                continue
            so = (mo + x) * 4
            k = a / 255.0
            o = bo + x * 4
            px[o] = int(lpx[so] * k + px[o] * (1 - k) + 0.5)
            px[o + 1] = int(lpx[so + 1] * k + px[o + 1] * (1 - k) + 0.5)
            px[o + 2] = int(lpx[so + 2] * k + px[o + 2] * (1 - k) + 0.5)

    paint = (226, 232, 240, 44)
    dash = int(cw * 0.30)
    tick = max(2, int(ch * 0.055))
    for r in range(1, rows + 1):
        y = int(pad + r * ch)
        for c in range(cols):
            round_rect(b, int(pad + c * cw + cw * 0.12), y - tick // 2, dash, tick, 2, paint)
    for cx, ry, col in [(0, 0, STEEL[0]), (2, 0, STEEL[1]), (4, 0, STEEL[2]),
                        (1, 1, STEEL[3]), (3, 1, STEEL[4])]:
        g = max(3, cw * 0.11)
        car(b, pad + cx * cw + g, pad + ry * ch + g, cw - g * 2, ch * 3 - g * 2,
            col, facing='down', cell=cw)

    hy = int(pad + rows * ch + gap * 0.55)
    hh = hero_h
    lane_x0 = int(pad + hh * 2.15 + m * 0.015)
    lane_x1 = m - pad
    round_rect(b, lane_x0, hy - 3, lane_x1 - lane_x0, hh + 6, hh * 0.18,
               (224, 166, 60, 26))
    car(b, pad, hy, int(hh * 2.15), hh, AMBER, hero=True, facing='right', cell=cw)
    my = hy + hh // 2
    s = int(hh * 0.24)
    for k in range(2):
        ax = int(lane_x0 + (lane_x1 - lane_x0) * (0.16 + 0.34 * k))
        poly(b, [(ax, my - s), (ax + s * 0.8, my), (ax, my + s),
                 (ax + s * 0.3, my + s), (ax + s * 1.12, my), (ax + s * 0.3, my - s)],
             (224, 166, 60, 225))
    glow(b, int(m * 0.93), my, int(m * 0.40), (224, 166, 60, 80), power=0.8)
    glow(b, int(m * 0.08), int(m * 0.05), int(m * 0.45), (120, 220, 255, 30), power=0.5)
    for y in range(m):
        dy = (y - m / 2) / (m / 2.0)
        for x in range(m):
            o = (y * m + x) * 4
            if px[o + 3] == 0:
                continue
            dx = (x - m / 2) / (m / 2.0)
            d = math.hypot(dx, dy)
            k = max(0.0, min(0.40, (d - 0.74) * 0.52))
            if k:
                px[o] = int(px[o] * (1 - k))
                px[o + 1] = int(px[o + 1] * (1 - k))
                px[o + 2] = int(px[o + 2] * (1 - k))


def badge(size, tile, con, maskable=False):
    b = Buf(size, size, (0, 0, 0, 255))
    if maskable:
        lot_motif(b, size, tile, con)
        small = badge(int(size * 0.78), tile, con)
        off = (size - small.w) // 2
        b.paste(small, off, off)
        return b
    lot_motif(b, size, tile, con)
    apply_alpha(b, badge_alpha(size), 'cut')
    return b


def resize(b, w, h):
    if (b.w, b.h) == (w, h):
        return b
    out = Buf(w, h)
    sx, sy = b.w / w, b.h / h
    for y in range(h):
        y0 = int(y * sy)
        y1 = max(y0 + 1, int((y + 1) * sy))
        for x in range(w):
            x0 = int(x * sx)
            x1 = max(x0 + 1, int((x + 1) * sx))
            ar = ag = ab = aa = n = 0
            for j in range(y0, min(b.h, y1)):
                ro = j * b.w
                for i in range(x0, min(b.w, x1)):
                    o = (ro + i) * 4
                    a = b.px[o + 3]
                    ar += b.px[o]
                    ag += b.px[o + 1]
                    ab += b.px[o + 2]
                    aa += a
                    n += 1
            o = (y * w + x) * 4
            out.px[o] = ar // n
            out.px[o + 1] = ag // n
            out.px[o + 2] = ab // n
            out.px[o + 3] = aa // n
    return out


def og_card(tile):
    w, h = 1200, 630
    b = Buf(w, h, ASPHALT + (255,))
    b.tile_rows(tile, 0, 0, w, h)
    rect(b, 0, 0, w, 8, AMBER + (255,))
    rect(b, 0, h - 8, w, h, AMBER_DARK + (255,))
    art = resize(badge(512, tile, texture(256, 256, CONCRETE, 13, seed=17,
                                          aggregate=0.06, speckle=5)), 460, 460)
    b.paste(art, 62, (h - 460) // 2)
    glow(b, 292, h // 2, 420, (224, 166, 60, 26), power=0.7)
    tx, maxw = 596, 556
    lines = [('GRIDLOCK', 6, INK, 255), ('DEADLOCK GARAGE', 4, AMBER, 235),
             ('DRIVE THE AMBER CAR OUT', 2, INK, 205),
             ('PARS MEASURED BY SEARCH', 2, DIM, 215),
             ('TWO LAWS / ONE ROUTE', 2, DIM, 215)]
    y = 132
    for i, (line, track, col, alpha) in enumerate(lines):
        sc = fit_scale(line, maxw, track)
        text(b, tx, y, line, sc, col + (alpha,), track=track)
        y += 6 * sc + (34 if i == 0 else 22)
        if i == 1:
            rect(b, tx, y - 8, tx + maxw, y - 6, (226, 232, 240, 44))
            y += 16
    chip = 'INSTALL / OFFLINE'
    csc = fit_scale(chip, maxw - 40, 2)
    round_rect(b, tx, y + 6, text_width(chip, csc, 2) + 36, 6 * csc + 26, 10,
               (120, 220, 255, 22))
    text(b, tx + 18, y + 19, chip, csc, CYAN + (205,), track=2)
    return b


def main():
    os.makedirs(OUT, exist_ok=True)
    tile = texture(256, 256, ASPHALT_LOT, 15, seed=4, aggregate=0.045, speckle=6)
    con = texture(256, 256, CONCRETE, 13, seed=17, aggregate=0.06, speckle=5)
    jobs = [('tex-asphalt-256.png', tile), ('tex-concrete-256.png', con)]
    master = badge(1024, tile, con)
    jobs.append(('icon-master-1024.png', master))
    for size, name in ((512, 'icon-512.png'), (192, 'icon-192.png'),
                       (180, 'apple-touch-icon.png'), (48, 'favicon.png'),
                       (32, 'favicon-32.png'), (16, 'favicon-16.png')):
        jobs.append((name, resize(master, size, size)))
    jobs.append(('icon-maskable-512.png', badge(512, tile, con, maskable=True)))
    jobs.append(('og-gridlock.png', og_card(tile)))
    for name, buf in jobs:
        n = write_png(os.path.join(OUT, name), buf.w, buf.h, buf.px)
        print('%-26s %4dx%-4d %8d bytes' % (name, buf.w, buf.h, n))
    print('-> %s' % OUT)


if __name__ == '__main__':
    main()
