// Browser side of the tests: a CPU reference in doubles for every cell, and pixel probes over gl.readPixels
import Spectrogram, { scales } from '../index.js'

// Seeded PRNG (mulberry32), so failures reproduce
export const random = seed => () => {
  seed = seed + 0x6D2B79F5 | 0
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
  return ((t ^ t >>> 14) >>> 0) / 4294967296
}

export function canvas(w, h) {
  let c = document.createElement('canvas')
  c.width = w; c.height = h
  document.body.append(c)
  return c
}

const tone = (n, f, rate, amp = 1, at = 0) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * f * (i + at) / rate))
// the same, faded in and out over 4096 samples: a cut sine piles its onset's energy into one column, 2 dB over the sine
const faded = (n, f, rate, amp) => tone(n, f, rate, amp).map((v, i) => v * Math.min(1, i / 4096, (n - 1 - i) / 4096))

// ── reference ───────────────────────────────────────────────────────────

// The frequency axes as the REPL's scale.js has them: log from 20 Hz, mel = 2595 · log10(1 + f / 700) (O'Shaughnessy
// 1987, HTK), lin from 0
const WARP = { log: Math.log2, mel: f => 2595 * Math.log10(1 + f / 700), lin: f => f }
const LOW = { log: 20, mel: 0, lin: 0 }
export const at = (scale, f, lo, hi) => (WARP[scale](f) - WARP[scale](lo)) / (WARP[scale](hi) - WARP[scale](lo))

// Textbook radix-2 FFT in doubles, in place, twiddles computed per butterfly
export function fft(re, im) {
  let n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1
    for (; j & b; b >>= 1) j ^= b
    j ^= b
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
    let a = -2 * Math.PI * k / len, c = Math.cos(a), s = Math.sin(a), p = i + k, q = p + len / 2
    let vr = re[q] * c - im[q] * s, vi = re[q] * s + im[q] * c
    re[q] = re[p] - vr; im[q] = im[p] - vi; re[p] += vr; im[p] += vi
  }
}

// The FFT above against the DFT's definition
export function checkFft() {
  let r = random(3), worst = 0
  for (let n of [2, 8, 64, 512]) {
    let x = Float64Array.from({ length: n }, () => r() * 2 - 1), y = Float64Array.from({ length: n }, () => r() * 2 - 1)
    let re = Float64Array.from(x), im = Float64Array.from(y)
    fft(re, im)
    for (let k = 0; k < n; k++) {
      let sr = 0, si = 0
      for (let t = 0; t < n; t++) { let a = -2 * Math.PI * k * t / n; sr += x[t] * Math.cos(a) - y[t] * Math.sin(a); si += x[t] * Math.sin(a) + y[t] * Math.cos(a) }
      worst = Math.max(worst, Math.hypot(sr - re[k], si - im[k]))
    }
  }
  return worst
}

// The reassigned spectrogram of get(i) (samples; NaN, ±Infinity and out of range read 0) for a view of W × H, in
// doubles, by the definitions: Hann h, its derivative dh and time-weighted th = (n - N/2)·h, three FFTs a frame
// (Kodera, Gendrin & de Villedary 1976; Auger & Flandrin 1995; as the REPL's reassign.js):
//   k̂ = k − N/2π · Im(X_dh X̄_h) / |X_h|²,  t̂ = t + Re(X_th X̄_h) / |X_h|²
// Power is normalized so a full-scale sine sums to 1: Hann's coherent gain is 1/2 and its equivalent noise bandwidth
// 1.5 bins (Harris 1978, "On the use of windows for harmonic analysis with the DFT", Proc. IEEE 66(1), table 1).
// Conventions as index.js promises them: column q spans samples [q·cw − .5, (q+1)·cw − .5), cw = max(samples per px, 1);
// energy placed outside its frame's window or outside 0..Nyquist is dropped. A column has `sub` frames, the fewest odd
// number with hops of at most N/2, frame i centered on round((q + (i + .5) / sub)·cw − .5); a cell sums what each frame
// index gives it and keeps the largest of those sums. Returns the column under each pixel and their cells.
export function reference(get, n, { range: [from, to], W, H, band, scale, rate, N }) {
  let spp = (to - from) / W, cw = Math.max(spp, 1), s = (from + .5) / cw, q0 = Math.floor(s), f0 = s - q0, ratio = spp / cw
  let cols = Array.from({ length: W }, (_, px) => q0 + Math.floor(f0 + (px + .5) * ratio))
  let qa = cols[0], qb = cols[W - 1] + 1, m = Math.ceil((N / 2 + 1) / cw) + 1, w = WARP[scale]
  let b0 = w(band[0]), bk = H / (w(band[1]) - w(band[0])), norm = 1 / (1.5 * (N / 4) ** 2)
  let cells = new Float64Array((qb - qa) * H), hops = Math.ceil(2 * cw / N), sub = hops > 1 ? hops | 1 : 1, sums = new Float64Array(cells.length)
  let win = [n => .5 - .5 * Math.cos(2 * Math.PI * n / N), n => Math.PI / N * Math.sin(2 * Math.PI * n / N), n => (n - N / 2) * (.5 - .5 * Math.cos(2 * Math.PI * n / N))]
  let wins = win.map(f => Float64Array.from({ length: N }, (_, i) => f(i)))
  let re = wins.map(() => new Float64Array(N)), im = wins.map(() => new Float64Array(N))
  let last = Math.ceil(n / cw)
  for (let f = 0; f < sub; f++) {
    sums.fill(0)
    for (let q = Math.max(qa, 0) - m; q < Math.min(qb, last) + m; q++) {
      let t = Math.round((q + (f + .5) / sub) * cw - .5), start = t - N / 2
      for (let i = 0; i < N; i++) {
        let k = start + i, v = k >= 0 && k < n ? get(k) : 0
        if (!Number.isFinite(v)) v = 0
        for (let j = 0; j < 3; j++) { re[j][i] = v * wins[j][i]; im[j][i] = 0 }
      }
      for (let j = 0; j < 3; j++) fft(re[j], im[j])
      for (let k = 0; k < N / 2; k++) {
        let hr = re[0][k], hi = im[0][k], P = hr * hr + hi * hi, p = P * norm
        if (!(p > 1e-20)) continue
        let kf = k - N / (2 * Math.PI) * (im[1][k] * hr - re[1][k] * hi) / P, dt = (re[2][k] * hr + im[2][k] * hi) / P
        let fz = kf * rate / N
        if (Math.abs(dt) > N / 2 || (scale === 'log' ? fz <= 0 : fz < 0)) continue
        let row = Math.floor((w(fz) - b0) * bk), col = Math.floor((t + dt + .5) / cw)
        if (row < 0 || row >= H || col < qa || col >= qb) continue
        sums[(col - qa) * H + row] += p
      }
    }
    for (let c = 0; c < cells.length; c++) cells[c] = Math.max(cells[c], sums[c])
  }
  return { cols, qa, last, cells, cw, sub }
}

// Every pixel column of sg against the reference: cells within 0.01 dB where the reference is within 60 dB of the view's
// loudest cell (they agree to 1e-4 dB but where a point moved). A point that float32 puts across a cell edge moves its
// energy one cell over: such a cell passes when the 3 × 3 sums around it agree within 0.1 dB, and is counted as moved.
export function compare(sg, get, view, pr = 1) {
  let { range, W, H } = view, ref = reference(get, sg.length, view), bad = [], cells = 0, moved = 0
  let got = new Float64Array(ref.cells.length), have = new Uint8Array(ref.cells.length / H)
  for (let px = 0; px < W; px++) {
    let q = ref.cols[px], c = sg.pick((px + .5) / pr)
    if (q < 0 || q >= ref.last) { if (c) bad.push({ px, q, got: 'a column off the data' }); continue }
    if (!c) { bad.push({ px, q, got: null }); continue }
    let from = Math.max(0, Math.ceil(q * ref.cw - .5)), to = Math.min(sg.length, Math.ceil((q + 1) * ref.cw - .5))
    if (c.from !== from || c.to !== to) bad.push({ px, q, span: [c.from, c.to], want: [from, to] })
    for (let r = 0; r < H; r++) got[(q - ref.qa) * H + r] = 10 ** (c.levels[r] / 10)
    have[q - ref.qa] = 1
  }
  let peak = ref.cells.reduce((a, b) => Math.max(a, b)), box = (a, i, r) => {
    let s = 0
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) { let j = i + dc, k = r + dr; if (j >= 0 && j < have.length && have[j] && k >= 0 && k < H) s += a[j * H + k] }
    return s
  }
  let db = (a, b) => Math.abs(10 * Math.log10(a / b))
  for (let i = 0; i < have.length; i++) if (have[i]) for (let r = 0; r < H; r++) {
    let want = ref.cells[i * H + r], g = got[i * H + r]
    if (!(want >= peak * 1e-6)) continue
    cells++
    if (db(g, want) <= .01) continue
    moved++
    if (!(db(box(got, i, r), box(ref.cells, i, r)) <= .1)) bad.push({ col: i + ref.qa, row: r, got: 10 * Math.log10(g), want: 10 * Math.log10(want), range })
  }
  return { cells, moved, bad }
}

// Many views of fixed data, each against the reference
export function views({ seed, W = 160, H = 96, list, pr = 1, far = 0 }) {
  let r = random(seed), rate = 48000, n = rate / 2, d = new Float32Array(n)
  // two tones, a chirp, clicks, noise at -40 dB
  for (let i = 0; i < n; i++) {
    let t = i / rate
    d[i] = .5 * Math.sin(2 * Math.PI * 1000 * t) + .1 * Math.sin(2 * Math.PI * 3150.7 * t + 1) + .2 * Math.sin(2 * Math.PI * (200 * t + 7800 * t * t)) + .01 * (r() * 2 - 1)
  }
  for (let k of [3000, 9001, 17777]) d[k] += .8
  let c = canvas(W, H), sg = new Spectrogram(c, { pixelRatio: pr, sampleRate: rate })
  if (far) sg.set(d, far); else sg.update({ data: d })
  let get = i => i >= far && i < far + n ? d[i - far] : NaN
  let out = { views: 0, cells: 0, moved: 0, bad: [] }
  for (let v of list) {
    let scale = v.scale ?? 'log', band = v.band ?? [LOW[scale], rate / 2], range = v.range.map(x => x + far)
    sg.update({ range, band: v.band ?? null, scale, size: v.size ?? 512 }).render()
    while (sg.pending) sg.render()
    let res = compare(sg, get, { range, W, H, band, scale, rate, N: sg.size }, pr)
    out.views++; out.cells += res.cells; out.moved += res.moved; out.bad.push(...res.bad)
  }
  c.remove()
  return { ...out, bad: out.bad.slice(0, 4), nbad: out.bad.length }
}

// ── placement ─────────────────────────────────────────────────────────

// A full-scale 1 kHz sine at 48 kHz on each scale: the loudest row per column, and its level
export function sine({ scale, band, W = 64, H = 200, amp = 1, f = 1000, size = null }) {
  let rate = 48000, c = canvas(W, H), sg = new Spectrogram(c, { pixelRatio: 1, sampleRate: rate, scale, band, size, data: tone(rate, f, rate, amp) })
  sg.render()
  let rows = [], levels = [], next = [], [lo, hi] = sg.band
  for (let x = 4; x < W - 4; x++) {
    let col = sg.pick(x + .5).levels, top = 0
    for (let r = 1; r < H; r++) if (col[r] > col[top]) top = r
    rows.push(top); levels.push(col[top]); next.push(Math.max(col[top - 1] ?? -Infinity, col[top + 1] ?? -Infinity))
  }
  let cell = sg.pick(W / 2, H - 1 - rows[0] + .5)
  c.remove()
  return { rows, levels, next, u: at(scale, f, lo, hi) * H, cell, size: sg.size }
}

// One click, at several zooms: the column holding its sample is the loudest by far
export function click({ k, spans, W = 200, H = 64 }) {
  let rate = 48000, n = 96000, d = new Float32Array(n), out = []
  d[k] = 1
  let c = canvas(W, H), sg = new Spectrogram(c, { pixelRatio: 1, sampleRate: rate, data: d, size: 512 })
  for (let span of spans) {
    let from = k - span * .37, renders = 1
    sg.update({ range: [from, from + span] }).render()
    while (sg.pending) sg.render(), renders++
    let energy = []
    for (let x = 0; x < W; x++) energy.push(sg.pick(x + .5)?.levels.reduce((s, v) => s + 10 ** (v / 10), 0) ?? 0)
    let best = energy.indexOf(Math.max(...energy)), p = sg.pick(best + .5)
    // other columns: those not showing the click's sample
    let rest = energy.filter((_, x) => { let c = sg.pick(x + .5); return c && !(c.from <= k && k < c.to) })
    out.push({ span, renders, holds: p.from <= k && k < p.to, from: p.from, to: p.to, peak: 10 * Math.log10(energy[best]), others: 10 * Math.log10(Math.max(0, ...rest)) })
  }
  c.remove()
  return out
}

// ── consistency ───────────────────────────────────────────────────────

const levelsOf = (sg, W) => Array.from({ length: W }, (_, x) => sg.pick(x + .5)?.levels)

// Largest level difference between two sets of columns, dB, over cells above `floor` in either
function worst(a, b, floor = -100) {
  let d = 0
  for (let x = 0; x < a.length; x++) {
    if (!a[x] !== !b[x]) return Infinity
    if (a[x]) for (let r = 0; r < a[x].length; r++) if (a[x][r] > floor || b[x][r] > floor) d = Math.max(d, Math.abs(a[x][r] - b[x][r]))
  }
  return d
}

// Pans that reuse cached columns give what a fresh view gives
export function pans() {
  let rate = 48000, r = random(5), d = Float32Array.from({ length: rate }, (_, i) => Math.sin(i * .07) * .3 + (r() - .5) * .05 + (i % 9001 === 0 ? 1 : 0))
  let W = 180, H = 80, a = new Spectrogram(canvas(W, H), { pixelRatio: 1, sampleRate: rate, data: d, size: 512 })
  let b = new Spectrogram(canvas(W, H), { pixelRatio: 1, sampleRate: rate, size: 512 }), out = 0, runs = 0
  let spp = 37.3, from = 5000.4
  a.update({ range: [from, from + spp * W] }).render()
  let draws = 0, draw = a.gl.drawArrays.bind(a.gl)
  a.gl.drawArrays = (...args) => { draws++; draw(...args) }
  for (let k = 0; k < 12; k++) {
    from += (r() - .3) * spp * 40
    let range = [from, from + spp * W]
    draws = 0
    a.update({ range }).render()
    runs += draws > 1
    b.update({ data: d, range }).render() // new data: no column kept
    out = Math.max(out, worst(levelsOf(a, W), levelsOf(b, W)))
  }
  a.gl.drawArrays = draw
  // a view already computed draws once, computing nothing
  draws = 0
  a.gl.drawArrays = (...args) => { draws++; draw(...args) }
  a.render()
  let again = draws
  for (let el of document.querySelectorAll('canvas')) el.remove()
  return { worst: out, runs, again }
}

// Zoomed out, a render transforms about a frame per pixel column: the first one frame per column, pending; later ones add
// frames to columns till every sample is in one. Pans of a refined view match a fresh view refined.
export function refine() {
  let rate = 48000, r = random(12), n = rate * 20, d = Float32Array.from({ length: n }, () => (r() - .5) * .02), W = 200, H = 64, N = 512
  for (let k = 0; k < 40; k++) d[Math.floor(r() * n)] = .9
  let a = new Spectrogram(canvas(W, H), { pixelRatio: 1, sampleRate: rate, data: d, size: N, levels: [-100, 0] }), frames = 0, draw = a.gl.drawArrays.bind(a.gl)
  a.gl.drawArrays = (mode, first, count) => { if (mode === a.gl.POINTS) frames += count / (N / 2); draw(mode, first, count) }
  let spent = [], pending = []
  a.render()
  do { spent.push(frames); pending.push(a.pending); frames = 0; a.render() } while (pending.at(-1) && spent.length < 100)
  let still = frames
  frames = 0; a.render()
  let out = { spent, pending, still, after: frames }
  // pans at 1500 samples a column, 7 frames each
  let b = new Spectrogram(canvas(W, H), { pixelRatio: 1, sampleRate: rate, size: N }), from = 1e5, worstPan = 0
  for (let k = 0; k < 6; k++) {
    from += (r() - .3) * 1500 * 60
    let range = [from, from + 1500 * W]
    a.update({ range }).render()
    b.update({ data: d, range }).render()
    while (a.pending || b.pending) a.render(), b.render()
    worstPan = Math.max(worstPan, worst(levelsOf(a, W), levelsOf(b, W)))
  }
  out.pans = worstPan
  // columns of a sample or less have one frame: never pending
  a.update({ range: [1000, 1100] }).render()
  out.near = a.pending
  // a viewport of 4 px, too narrow for a column's frames in half a frame per px, still settles
  let t = new Spectrogram(canvas(4, 16), { pixelRatio: 1, sampleRate: rate, data: d, size: N, levels: [-100, 0] }), renders = 1
  t.render()
  while (t.pending && renders < 1000) t.render(), renders++
  out.narrow = { renders, pending: t.pending }
  for (let el of document.querySelectorAll('canvas')) el.remove()
  return out
}

// Data built by push() and set() gives what the same data given at once gives
export function edits() {
  let rate = 48000, r = random(9), n = 150000, ref = new Float32Array(n).fill(NaN), W = 200, H = 80
  let a = new Spectrogram(canvas(W, H), { pixelRatio: 1, sampleRate: rate, size: 512 }), out = 0
  let b = new Spectrogram(canvas(W, H), { pixelRatio: 1, sampleRate: rate, size: 512 }), len = 0
  for (let k = 0; k < 30; k++) {
    let m = Math.floor(r() * 9000) + 1, s = Float32Array.from({ length: m }, (_, i) => Math.sin((len + i) * .05) * .5 + (r() - .5) * .1)
    if (r() < .6 || !len) { a.push(s); ref.set(s, len); len += m }
    else { let at = Math.floor(r() * len); a.set(s, at); ref.set(s.subarray(0, Math.min(m, n - at)), at); len = Math.max(len, at + m) }
    if (len > n - 10000) break
    // view the whole and a zoom, while it grows
    for (let range of [null, [len * .5, len * .5 + 30 * W]]) {
      a.update({ range }).render()
      b.update({ data: ref.slice(0, len), range }).render()
      while (a.pending || b.pending) a.render(), b.render()
      out = Math.max(out, worst(levelsOf(a, W), levelsOf(b, W)))
    }
  }
  a.canvas.remove(); b.canvas.remove()
  return { worst: out, length: a.length }
}

// ── pixels ──────────────────────────────────────────────────────────────

// Drawing buffer as rows from the top: [r, g, b, a] at (x, y) is at 4·(y·w + x)
export function read(gl) {
  let w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, raw = new Uint8Array(w * h * 4), img = new Uint8Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw)
  for (let y = 0; y < h; y++) img.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4)
  return { w, h, img, a: (x, y) => img[4 * (y * w + x) + 3], px: (x, y) => [...img.subarray(4 * (y * w + x), 4 * (y * w + x) + 4)] }
}
const ink = (p, x0, y0, x1, y1) => { let s = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += p.a(x, y) > 0; return s }

// Two lanes on one context: neither draws or clears outside its viewport; the programs are made once
export function lanes() {
  let c = canvas(300, 200), gl = c.getContext('webgl2', { preserveDrawingBuffer: true }), programs = 0, create = gl.createProgram
  gl.createProgram = () => (programs++, create.call(gl))
  let d = tone(48000, 1000, 48000, .5)
  let a = new Spectrogram(c, { pixelRatio: 1, sampleRate: 48000, viewport: [0, 0, 300, 100], data: d })
  let made = programs
  let b = new Spectrogram(a.gl, { pixelRatio: 1, sampleRate: 48000, viewport: [0, 100, 300, 100], data: d })
  let eq = (p, q, y0, y1) => p.img.subarray(y0 * 1200, y1 * 1200).every((v, i) => v === q.img[y0 * 1200 + i])
  a.render()
  let p1 = read(gl)
  b.render()
  let p2 = read(gl)
  a.clear()
  let p3 = read(gl)
  let res = { aInk: ink(p1, 0, 0, 300, 100), bleed: ink(p1, 0, 100, 300, 200), bInk: ink(p2, 0, 100, 300, 200), aKept: eq(p1, p2, 0, 100), aCleared: ink(p3, 0, 0, 300, 100), bKept: eq(p2, p3, 100, 200), made, more: programs - made }
  c.remove()
  return res
}

// The ramp: over its background, lightness steps evenly with level. Sines at known levels (the one-pixel line reads
// the sine's level) against fixed levels [-80, 0], composited over the background by hand.
export function ramp({ background, color }) {
  let rate = 48000, W = 8, H = 200, out = []
  let lin = c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4
  let L = rgb => Math.cbrt(.2126729 * lin(rgb[0]) + .7151522 * lin(rgb[1]) + .072175 * lin(rgb[2])) // OKLab L of a grey
  let ctx = document.createElement('canvas').getContext('2d')
  ctx.fillStyle = background; ctx.fillRect(0, 0, 1, 1)
  let bg = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => v / 255)
  for (let db of [-80, -60, -40, -20, 0]) {
    let c = canvas(W, H), sg = new Spectrogram(c, { pixelRatio: 1, sampleRate: rate, levels: [-80, 0], background, color, data: tone(rate, 1000, rate, 10 ** (db / 20)), size: 2048 })
    sg.render()
    let row = Math.floor(at('log', 1000, 20, rate / 2) * H), [r, g, b, a] = read(sg.gl).px(4, H - 1 - row).map(v => v / 255)
    out.push({ db, alpha: a, L: L([r + (1 - a) * bg[0], g + (1 - a) * bg[1], b + (1 - a) * bg[2]]) })
    c.remove()
  }
  return { steps: out, L0: L(bg) }
}

// A colormap: its first stop at the floor, its last at the top, stops between at even steps of level
export function colormap() {
  let rate = 48000, W = 8, H = 200, stops = ['#000', 'oklch(60% .2 30)', '#fff'], out = []
  for (let db of [-80, -40, 0]) {
    let c = canvas(W, H), sg = new Spectrogram(c, { pixelRatio: 1, sampleRate: rate, levels: [-80, 0], color: stops, data: tone(rate, 1000, rate, 10 ** (db / 20)), size: 2048 })
    sg.render()
    let row = Math.floor(at('log', 1000, 20, rate / 2) * H)
    out.push(read(sg.gl).px(4, H - 1 - row))
    c.remove()
  }
  let ctx = document.createElement('canvas').getContext('2d'), css = s => { ctx.fillStyle = s; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data] }
  return { got: out, want: stops.map(css) }
}

// Auto levels: the top is the whole data's loudest cell, never under -60 dB; depth below it; gain scales the picture
export function levels() {
  let rate = 48000, c = canvas(64, 100), out = {}
  let sg = new Spectrogram(c, { pixelRatio: 1, sampleRate: rate, data: faded(rate, 1000, rate, .5) })
  out.half = sg.levels
  sg.update({ data: tone(rate, 1000, rate, 1e-4) })
  out.quiet = sg.levels
  sg.update({ data: faded(rate, 1000, rate, 1), depth: 50 })
  out.depth = sg.levels
  sg.update({ levels: [-90, -10] })
  out.fixed = sg.levels
  sg.update({ levels: null, depth: null, size: 2048 }).render()
  let row = Math.floor(at('log', 1000, 20, rate / 2) * 100)
  out.full = sg.pick(32, 99 - row + .5).level
  sg.update({ gain: .5 })
  out.gained = sg.pick(32, 99 - row + .5).level
  c.remove()
  // the top is the loudest cell of the whole data drawn 1024 × 512 on columns of a power of two samples, which a sine
  // fades onto: reassignment gathers the energy of a changing envelope, so its edges read above the steady sine
  let d = faded(rate, 1000, rate, .5), cw = 2 ** Math.ceil(Math.log2(rate / 1024)), view = { range: [0, 1024 * cw], W: 1024, H: 512, band: [20, rate / 2], scale: 'log', rate, N: 2048 }
  let ref = reference(i => d[i], rate, view)
  out.loudest = 10 * Math.log10(ref.cells.reduce((a, b) => Math.max(a, b)))
  // drawn on that grid, the loudest cell is white
  let w = canvas(1024, 512), wide = new Spectrogram(w, { pixelRatio: 1, sampleRate: rate, data: d, range: view.range }).render(), p = read(wide.gl), top = 0
  for (let i = 0; i < p.img.length; i += 4) top = Math.max(top, p.img[i])
  out.white = top
  out.wide = wide.levels
  w.remove()
  return out
}

// NaN and ±Infinity read as silence: nothing leaks into their neighbours
export function gaps() {
  let rate = 48000, d = tone(rate, 1000, rate, .5)
  d.fill(NaN, 20000, 30000); d[5000] = Infinity; d[40000] = -Infinity
  let W = 96, H = 80, sg = new Spectrogram(canvas(W, H), { pixelRatio: 1, sampleRate: rate, data: d, size: 1024 }).render()
  let ref = new Spectrogram(canvas(W, H), { pixelRatio: 1, sampleRate: rate, size: 1024, data: d.map(v => Number.isFinite(v) ? v : 0) }).render()
  let cols = levelsOf(sg, W), finite = cols.every(c => c.every(v => !Number.isNaN(v))), res = { finite, worst: worst(cols, levelsOf(ref, W)) }
  for (let el of document.querySelectorAll('canvas')) el.remove()
  return res
}

// Texture layers are reused across data: a gap in a block written later reads silence, not what the layer held before
export function stale() {
  let rate = 48000, B = 1 << 20, W = 100, H = 40, c = canvas(W, H), sg = new Spectrogram(c, { pixelRatio: 1, sampleRate: rate, levels: [-200, 0], size: 512 })
  sg.update({ data: tone(3 * B, 1000, rate, .5) })
  for (let k = 0; k < 3; k++) sg.update({ range: [k * B, (k + 1) * B] }).render()
  let before = sg.pick(50).levels.some(v => v > -20)
  // short data: the texture stays; block 1 has no layer, its rows read as silence
  sg.update({ data: new Float32Array(1000) })
  sg.set([0], 2 * B)
  sg.update({ range: [B + 100000, B + 100000 + 400 * W] }).render()
  // a write gives block 1 the layer that held the first data's block 1; the rows read before must go up again
  sg.set([1], B + 500000)
  sg.update({ range: [B + 100000, B + 100000 + 300 * W] }).render()
  let loud = Math.max(...Array.from({ length: W }, (_, x) => Math.max(...sg.pick(x + .5).levels)))
  c.remove()
  return { before, loud }
}

// Ranges past the data draw nothing there; the default viewport follows a resized canvas
export function edges() {
  let rate = 48000, c = canvas(200, 60), sg = new Spectrogram(c, { pixelRatio: 1, sampleRate: rate, data: tone(rate, 1000, rate, .5), levels: [-200, 0] })
  sg.update({ range: [-rate, 2 * rate] }).render()
  let p = read(sg.gl), res = { before: ink(p, 0, 0, 66, 60), inside: ink(p, 67, 0, 132, 60), after: ink(p, 134, 0, 200, 60), pickBefore: sg.pick(10), pickAfter: sg.pick(190) }
  sg.update({ range: null })
  c.width = 400
  sg.clear().render()
  p = read(sg.gl)
  res.right = ink(p, 200, 0, 400, 60)
  c.remove()
  return res
}

// Previews: pieces of other ranges at the same zoom, drawn into parts of the viewport, compute only columns not yet
// computed; a gain shows at once
export function pieces() {
  let rate = 48000, W = 200, H = 60, c = canvas(W, H), d = tone(rate * 2, 1000, rate, .5)
  let sg = new Spectrogram(c, { pixelRatio: 1, sampleRate: rate, data: d, range: [0, rate] })
  sg.render()
  let draws = 0, draw = sg.gl.drawArrays.bind(sg.gl)
  sg.gl.drawArrays = (...args) => { draws++; draw(...args) }
  let spp = rate / W, out = {}
  // a fade: ten pieces of the view as it is, each quieter
  draws = 0
  for (let i = 0; i < 10; i++) sg.update({ range: [i * 20 * spp, (i + 1) * 20 * spp], viewport: [i * 20, 0, 20, H], gain: 1 - i / 10 }).render()
  out.fade = draws
  // a move: a piece from past the view, drawn into its right half: its columns are new
  draws = 0
  sg.update({ range: [rate * 1.5, rate * 1.5 + 100 * spp], viewport: [100, 0, 100, H], gain: null }).render()
  out.move = draws > 1
  let row = H - 1 - Math.floor(at('log', 1000, 20, rate / 2) * H)
  sg.update({ range: [0, 20 * spp], viewport: [0, 0, 20, H], gain: 1 })
  out.loud = sg.pick(10, row + .5).level
  sg.update({ gain: .1 })
  out.soft = sg.pick(10, row + .5).level
  c.remove()
  return out
}

// Losing the context throws nowhere; on restore the spectrogram draws itself again
export async function lose() {
  let c = canvas(200, 50), rate = 48000, sg = new Spectrogram(c, { pixelRatio: 1, sampleRate: rate, data: tone(rate, 1000, rate, .5) })
  let ext = sg.gl.getExtension('WEBGL_lose_context'), errors = []
  sg.render()
  let on = type => new Promise((res, rej) => { c.addEventListener(type, res, { once: true }); setTimeout(() => rej(Error(type + ' never fired')), 5000) })
  let lost = on('webglcontextlost')
  ext.loseContext()
  await lost
  await new Promise(res => setTimeout(res))
  for (let call of [() => sg.update({ range: [0, 24000] }), () => sg.push([.5, .5]), () => sg.render(), () => sg.clear(), () => sg.pick(10), () => sg.pick(10, 10), () => sg.levels, () => sg.set([1], 3)])
    try { call() } catch (e) { errors.push(e.message) }
  let restored = on('webglcontextrestored')
  ext.restoreContext()
  await restored
  await new Promise(res => setTimeout(res))
  let p = read(sg.gl), after = sg.pick(100)
  c.remove()
  return { errors, ink: ink(p, 0, 0, 200, 50), length: sg.length, picked: !!after }
}

// Without EXT_float_blend, cells are half floats: the picture matches the float one
export function half() {
  let rate = 48000, r = random(4), d = Float32Array.from({ length: rate }, (_, i) => .5 * Math.sin(i * .13) + .05 * (r() - .5)), W = 120, H = 80
  let a = new Spectrogram(canvas(W, H), { pixelRatio: 1, sampleRate: rate, data: d, size: 512 }).render()
  let c = canvas(W, H), gl = c.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: true }), get = gl.getExtension.bind(gl)
  gl.getExtension = name => name === 'EXT_float_blend' ? null : get(name)
  let b = new Spectrogram(c, { pixelRatio: 1, sampleRate: rate, data: d, size: 512 }).render()
  let res = { worst: worst(levelsOf(a, W), levelsOf(b, W), -80), levels: [a.levels, b.levels] }
  for (let el of document.querySelectorAll('canvas')) el.remove()
  return res
}

// An hour at 48 kHz, a click 90 s before its end and a tone in its last minute: drawn whole, then zoomed onto each
export function hour() {
  let rate = 48000, n = rate * 3600, d = new Float32Array(n), k = n - rate * 90 - 12345
  for (let i = n - rate * 60; i < n; i++) d[i] = .25 * Math.sin(2 * Math.PI * 1000 * i / rate)
  d[k] = 1
  let W = 400, H = 100, c = canvas(W, H), t = performance.now()
  let sg = new Spectrogram(c, { pixelRatio: 1, sampleRate: rate, data: d })
  sg.render()
  let p = read(sg.gl), first = performance.now() - t
  let res = { first, length: sg.length, end: ink(p, W - 8, 0, W, H), start: ink(p, 0, 0, W - 16, H) }
  // 400 samples across, the click at the center of px 120
  sg.update({ range: [k - 120.5, k + 279.5], size: 512 }).render()
  let hit = null
  for (let x = 0; x < W; x++) { let c = sg.pick(x + .5); if (c && c.from <= k && k < c.to) { hit = x; break } }
  let e = x => sg.pick(x + .5).levels.reduce((s, v) => s + 10 ** (v / 10), 0)
  res.click = { hit, at: 120, peak: 10 * Math.log10(e(hit)), beside: 10 * Math.log10(Math.max(e(hit - 2), e(hit + 2))) }
  // the tone, on its row, 400 px of a second at the very end
  sg.update({ range: [n - rate, n], size: null }).render()
  let row = Math.floor(at('log', 1000, 20, rate / 2) * H)
  res.tone = sg.pick(200, H - 1 - row + .5).level
  c.remove()
  return res
}

// Constructor and option errors, getters, null defaults, data referenced not copied, destroy()
export function api() {
  let out = { errors: {} }, c2d = canvas(10, 10)
  c2d.getContext('2d')
  try { new Spectrogram(c2d); out.ctor = 'accepted' } catch (e) { out.ctor = e.name }
  let d = new Float32Array(7e4), sg = new Spectrogram(canvas(100, 20), { pixelRatio: 1, data: d })
  for (let o of [{ range: [0, NaN] }, { band: [100, 50] }, { band: [0, 100] }, { viewport: [0, 0, 10] }, { size: 1000 }, { size: 8 }, { scale: 'bark' }, { levels: [0, -10] }, { depth: -1 }, { sampleRate: 0 }, { pixelRatio: 'x' }, { gain: 'x' }, { color: 'not-a-color' }, { color: ['#000'] }])
    try { sg.update(o); out.errors[JSON.stringify(o)] = 'accepted' } catch (e) { out.errors[JSON.stringify(o)] = e.name }
  try { sg.set([1], -1); out.offset = 'accepted' } catch (e) { out.offset = e.name }
  try { sg.set([1], 2 ** 31); out.far = 'accepted' } catch (e) { out.far = e.name }
  sg.push([1, 2, 3])
  out.length = sg.length
  out.range = sg.range
  sg.set([5], 3)
  out.shared = d[3]
  sg.update({ range: [2, 4], band: [100, 1000], sampleRate: 8000, scale: 'mel' })
  out.getters = [sg.range, sg.band]
  sg.update({ range: null, band: null, sampleRate: null, scale: null })
  out.defaults = [sg.range, sg.band]
  out.size = sg.size
  sg.destroy()
  sg.render()
  let p = read(sg.gl)
  out.afterDestroy = [sg.length, ink(p, 0, 0, p.w, p.h), sg.pick(5)]
  sg.canvas.remove(); c2d.remove()
  return out
}

export { scales }
