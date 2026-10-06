// gl-spectrogram's demo, on gl-spectrum's v3 page: sound comes in from the right as it plays, as on a recorder; drag or
// scroll back through it, wheel or pinch across to zoom time, Shift+wheel or a vertical pinch to zoom frequency
import Spectrogram, { scales } from '../index.js'
import { $, clamp, css, alpha, palette, picker, sound, gestures, timeline, glide, rules, pretty, step } from './app.js'

const SPAN = 20, KEEP = 2 ** 24 // seconds in view at first; samples kept (5.8 min at 48 kHz), past that the oldest go
const canvas = $('chart'), sg = new Spectrogram(canvas)
let rate = 48000, buf = null, length = 0, origin = 0, view = timeline(rate * SPAN)
let look = null, scale = 'log', band = null, w = 0, h = 0, pr = 0, dirty = true
const newest = glide()

const ui = picker(start)
const audio = sound({ chunk: take, state: on => { ui.playing(on); if (on) $('hint').hidden = true } })

// ── data ──────────────────────────────────────────────────────────────────

// Chunks as they sound, mixed to one channel. Past KEEP samples the take keeps what is in view and goes on from there
function take(chunk) {
  const n = chunk[0].length
  buf ??= new Float32Array(KEEP)
  if (length + n > KEEP) {
    const keep = Math.min(length, Math.ceil(view.span * 2))
    buf.copyWithin(0, length - keep, length); origin += length - keep; view.end -= length - keep; length = keep
    sg.update({ data: buf.subarray(0, length) })
  }
  for (let i = 0; i < n; i++) {
    let s = 0
    for (const c of chunk) s += c[i]
    buf[length + i] = s / chunk.length
  }
  sg.push(buf.subarray(length, length + n)); length += n; dirty = true
}
function reset(sr) {
  rate = sr; length = origin = 0; view = timeline(rate * SPAN)
  sg.update({ data: new Float32Array(0), sampleRate: rate })
  setBand(); dirty = true
}

// ── view ──────────────────────────────────────────────────────────────────

function layout() {
  w = innerWidth; h = innerHeight; pr = devicePixelRatio
  for (const c of [canvas, $('grid')]) { c.width = Math.round(w * pr); c.height = Math.round(h * pr) }
  sg.update({ viewport: [0, 0, w, h], pixelRatio: pr }); dirty = true
}
function setBand(lo = scales[scale].low, hi = rate / 2) {
  band = [clamp(lo, scales[scale].low, rate / 2 - 1), clamp(hi, scales[scale].low + 1, rate / 2)]; dirty = true
}
// frequency zoom and drag in the scale's own units, so the frequency under the pointer stays put
function bandView(fn) {
  const S = scales[scale], lo = S.low, hi = rate / 2, [a, b] = band.map(f => S.at(f, lo, hi))
  let [start, span] = fn(a, b)
  span = clamp(span, 1 / 128, 1); start = clamp(start, 0, 1 - span)
  setBand(S.of(start, lo, hi), S.of(start + span, lo, hi))
}
gestures(canvas, {
  pan(dx, dy) {
    view.pan(-dx / w * view.span, newest(length, rate, audio.playing))
    if (dy) bandView((a, b) => [a + dy / h * (b - a), b - a])
    dirty = true
  },
  zoom(x, y, kx, ky) {
    if (x < 40) [kx, ky] = [1, kx * ky] // over the frequency labels, any zoom is in frequency
    if (kx !== 1) view.zoom(x / w, kx, length, Math.max(length, rate * SPAN) * 1.25)
    if (ky !== 1) bandView((a, b) => { const u = clamp(1 - y / h, 0, 1), m = a + u * (b - a), s = (b - a) * ky; return [m - u * s, s] })
    dirty = true
  },
  fit() { view.fit(Math.max(length, rate * SPAN)); setBand() }
})

// ── look ──────────────────────────────────────────────────────────────────

// The palette from the page's color to the ink: silence shows the page through
palette(l => {
  look = l
  sg.update({ color: Array.from({ length: 9 }, (_, i) => css(look.color(i / 8))), background: css(look.color(0)) })
  dirty = true
})
$('scale').onchange = () => { scale = $('scale').value; setBand() }
for (const id of ['method', 'fft', 'depth']) $(id).onchange = () => {
  sg.update({ method: $('method').value, size: +$('fft').value || null, depth: +$('depth').value }); dirty = true
}
$('grid-on').onchange = () => dirty = true
addEventListener('resize', layout)

const clock = s => s < 60 ? `${pretty(s)} s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
// plot-grid over the picture: seconds along the bottom, hertz along the left edge
function rule([from, to]) {
  const { g, px } = rules($('grid'))
  if (!$('grid-on').checked || !look) return
  const ink = look.color(.75), [a, b] = [(from + origin) / rate, (to + origin) / rate], dt = step(b - a, w, 90)
  for (let t = Math.max(0, Math.ceil(a / dt)) * dt; t <= b; t += dt) {
    const x = Math.round((t - a) / (b - a) * w / px) * px
    g.fillStyle = css(alpha(ink, .1)); g.fillRect(x, 0, px, h)
    g.fillStyle = css(ink); g.fillRect(x, h - 4, px, 4); g.fillText(clock(+t.toFixed(6)), x + 3.5, h)
  }
  const S = scales[scale], [lo, hi] = band, df = step(hi - lo, h, 40), marks = []
  if (scale === 'log') for (let d = 10; d <= hi; d *= 10) marks.push(d, 2 * d, 5 * d)
  else for (let f = Math.ceil(lo / df) * df; f <= hi; f += df) marks.push(f)
  let prev = Infinity
  for (const f of marks) {
    if (f < lo || f > hi) continue
    const y = Math.round((1 - S.at(f, lo, hi)) * h / px) * px
    if (prev - y < 24 || y < 64 || y > h - 24) continue // clear of each other, the header and the time labels
    prev = y
    g.fillStyle = css(alpha(ink, .1)); g.fillRect(0, y, w, px)
    g.fillStyle = css(ink); g.fillRect(0, y, 4, px); g.fillText(f >= 1000 ? `${pretty(f / 1000)}k` : pretty(f), 6, y + 4.5)
  }
}

// ── sound ─────────────────────────────────────────────────────────────────

// ?source= picks the first: a recording, a stream or mic
let current = ui.items[new URLSearchParams(location.search).get('source')] ?? ui.items.blackbird
async function start(it) {
  current = it; ui.show(it)
  try {
    reset(audio.context?.sampleRate ?? rate)
    await audio.start(it)
    if (audio.context.sampleRate !== rate) reset(audio.context.sampleRate)
  } catch (e) { audio.stop(); ui.show(it, e.message) }
}
$('play').onclick = () => audio.element || audio.playing ? audio.toggle() : start(current)

requestAnimationFrame(function frame() {
  requestAnimationFrame(frame)
  if (!dirty && !sg.pending && !audio.playing) return
  dirty = false
  const range = view.range(newest(length, rate, audio.playing))
  sg.update({ range, band, scale }).clear().render()
  rule(range)
  const el = audio.element
  ui.progress(el && isFinite(el.duration) ? el.currentTime / el.duration : 0)
})

ui.show(current)
layout(); setBand()
document.fonts?.ready.then(() => dirty = true)
