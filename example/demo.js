import Spectrogram, { scales } from '../index.js'
import { palettes, generator } from './data.js'
import { $, css, num, clamp, error, frame, step, label, setup, decode } from './ui.js'

const canvas = $('chart'), ax = $('axes').getContext('2d'), grid = $('grid').getContext('2d'), player = $('player')
const LEFT = 52, TOP = 30, GAP = 24
let lanes = [], range = [0, 1], band = [20, 24000], levels = null, scale = 'log', rate = 48000, title = '', gen
let w = 1, h = 1, pw = 1, lh = 1, pr = 1, dirty = true, paint = true, running = false, last = 0, task = 0, url
const length = () => lanes[0]?.length || 1
function view(a, b, manual = false) {
  const span = clamp(b - a, 48, length() * 1.5), start = clamp(a, -span / 4, length() - span * .75)
  range = [start, start + span]; dirty = true
  if (manual) $('follow').checked = false
}
function zoom(x, factor) {
  const u = clamp((x - LEFT) / pw, 0, 1), s = range[0] + u * (range[1] - range[0])
  view(s - (s - range[0]) * factor, s + (range[1] - s) * factor, true)
}
function setBand(lo = scales[scale].low, hi = rate / 2) {
  band = [lo, hi]; $('low').value = Number(lo.toPrecision(7)); $('high').value = Number(hi.toPrecision(7))
  $('low').min = scales[scale].low; $('low').max = rate / 2 - 1; $('high').min = scales[scale].low + 1; $('high').max = rate / 2
  dirty = true
}
function fit() { setBand(); view(0, length()) }
function layout() {
  pw = Math.max(1, w - LEFT - 12); lh = Math.max(1, (h - TOP - GAP * (lanes.length - 1)) / Math.max(1, lanes.length))
  lanes.forEach((s, i) => s.update({ viewport: [LEFT, TOP + i * (lh + GAP), pw, lh], pixelRatio: pr }))
  dirty = true
}
function stop() { running = false; $('stream').textContent = 'Stream'; $('stream').setAttribute('aria-pressed', 'false') }
function status() { $('status').value = `${title} · ${label(length() / rate)} s · ${rate / 1000} kHz · ${lanes.length === 1 ? 'mono' : lanes.length + ' channels'}` }
function releaseAudio() { player.pause(); player.removeAttribute('src'); player.load(); player.hidden = true; $('playhead').hidden = true; if (url) URL.revokeObjectURL(url); url = null }
function audio(blob) { releaseAudio(); url = URL.createObjectURL(blob); player.src = url; player.hidden = false }
function wav(data, sr) {
  const bytes = new ArrayBuffer(44 + data.length * 2), v = new DataView(bytes)
  const str = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  str(0, 'RIFF'); v.setUint32(4, bytes.byteLength - 8, true); str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, data.length * 2, true)
  for (let i = 0; i < data.length; i++) v.setInt16(44 + i * 2, clamp(data[i], -1, 1) * 32767, true)
  return new Blob([bytes], { type: 'audio/wav' })
}
function install(data, sr, heading) {
  stop()
  const fresh = []
  try { data.forEach(d => fresh.push(new Spectrogram(canvas, { data: d, sampleRate: sr }))) }
  catch (e) { fresh.forEach(s => s.destroy()); throw e }
  lanes.forEach(s => s.destroy()); lanes = fresh; rate = sr; title = heading
  const gl = lanes[0].gl; gl.disable(gl.SCISSOR_TEST); gl.clear(gl.COLOR_BUFFER_BIT)
  fit(); layout(); paint = true; status(); error('')
  const file = $('source').value === 'file'
  $('stream').disabled = file; $('duration-row').hidden = file; $('speed-row').hidden = file
}
async function generate() {
  const id = ++task, source = $('source').value
  if (source === 'file') return
  stop(); releaseAudio(); $('status').value = 'Generating…'
  try {
    const sr = 48000, n = num('duration') * sr, nextGen = generator(source, sr), data = new Float32Array(n)
    for (let a = 0; a < n; a += 262144) {
      data.set(nextGen(Math.min(262144, n - a)), a)
      await frame(); if (id !== task) return
    }
    gen = nextGen; install([data], sr, $('source').selectedOptions[0].textContent); audio(wav(data, sr))
    $('source').querySelector('[value=file]').hidden = true
  } catch (e) { if (id === task) { error(e.message); status() } }
}
function appearance() {
  const bg = $('background').value, custom = $('palette').value === 'custom'
  const stops = custom ? [bg, $('tint').value] : [...palettes[$('palette').value]]
  if ($('reverse').checked) stops.reverse()
  const color = custom && !$('reverse').checked ? $('tint').value : stops
  lanes.forEach(s => s.update({ color, background: bg, size: num('fft') || null,
    gain: 10 ** (num('gain') / 20), depth: num('depth'), levels }))
  document.documentElement.style.setProperty('--plot-bg', bg)
  $('legend').style.background = `linear-gradient(90deg in oklab, ${stops.join(',')})`
  $('tint-row').hidden = !custom; $('depth-row').hidden = !$('auto').checked; $('manual').hidden = $('auto').checked
  $('depth-value').value = `${num('depth')} dB`; $('gain-value').value = `${num('gain')} dB`
}
function axes() {
  for (const ctx of [ax, grid]) { ctx.setTransform(pr, 0, 0, pr, 0, 0); ctx.clearRect(0, 0, w, h) }
  ax.font = `11px ${css('--font')}`; ax.fillStyle = css('--fg'); grid.fillStyle = css('--grid'); grid.globalAlpha = .4
  const [a, b] = range.map(v => v / rate), inc = step(b - a, pw), on = $('grid-on').checked
  for (let n = Math.ceil(a / inc); n * inc <= b; n++) {
    const t = n * inc, x = LEFT + (t - a) / (b - a) * pw
    const text = label(t) + ' s'
    if (x + ax.measureText(text).width + 3 < w) ax.fillText(text, x + 3, 12)
    if (on) grid.fillRect(Math.round(x), TOP, 1, h - TOP)
  }
  const marks = scale === 'log' ? [20, 30, 50, 80, 100, 150, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 5000, 8000, 10000, 15000, 20000] : []
  if (scale !== 'log') { const d = step(band[1] - band[0], lh); for (let v = Math.ceil(band[0] / d) * d; v <= band[1]; v += d) marks.push(v) }
  for (let i = 0; i < lanes.length; i++) {
    const top = TOP + i * (lh + GAP); let prev = -Infinity
    for (const f of [...marks].reverse()) {
      if (f < band[0] || f > band[1]) continue
      const y = top + (1 - scales[scale].at(f, ...band)) * lh
      if (y - prev < 24) continue
      prev = y; ax.textAlign = 'right'; ax.fillText(f >= 1000 ? label(f / 1000) + 'k' : label(f), LEFT - 8, clamp(y + 4, top + 10, top + lh)); ax.textAlign = 'left'
      if (on) grid.fillRect(LEFT, Math.round(y), pw, 1)
    }
    if (lanes.length > 1) ax.fillText(`Ch ${i + 1}`, LEFT + 8, top + 14)
  }
  ax.fillText('Hz', 8, 12); $('view').value = `${label(a)} → ${label(b)} s`
}
function inspect(x, y) {
  const i = Math.floor((y - TOP) / (lh + GAP)), local = y - TOP - i * (lh + GAP)
  const p = i >= 0 && i < lanes.length && x >= LEFT && x < LEFT + pw && local <= lh ? lanes[i].pick(x - LEFT, local) : null
  $('readout').value = p ? `${label(p.from / rate)} s · ${label(p.low)}–${label(p.high)} Hz · ${Number.isFinite(p.level) ? p.level.toFixed(1) + ' dB' : 'silence'}` : 'Move over the spectrum to inspect a frequency.'
}
setup({ resize: (width, height, ratio) => { w = width; h = height; pr = ratio; layout() }, zoom,
  pan: dx => { const d = dx / pw * (range[1] - range[0]); view(range[0] + d, range[1] + d, true) }, fit, inspect,
  wheel: (e, delta) => {
    if (!e.shiftKey && e.offsetX >= LEFT) return false
    const i = Math.floor((e.offsetY - TOP) / (lh + GAP)), y = e.offsetY - TOP - i * (lh + GAP)
    if (i < 0 || i >= lanes.length || y > lh) return true
    const S = scales[scale], lo = S.low, hi = rate / 2, [a, b] = band.map(f => S.at(f, lo, hi)), u = clamp(1 - y / lh, 0, 1)
    const span = clamp((b - a) * Math.exp(clamp((e.deltaY || e.deltaX) * delta * .003, -2, 2)), 1 / 128, 1)
    const start = clamp(a + u * (b - a) - u * span, 0, 1 - span)
    setBand(S.of(start, lo, hi), S.of(start + span, lo, hi)); return true
  } })
$('source').onchange = generate
$('duration').onchange = generate
$('voice-band').onclick = () => { scale = $('scale').value = 'log'; setBand(80, Math.min(4000, rate / 2)); view(range[0], range[0] + Math.min(length(), rate * 3)) }
$('stream').onclick = () => {
  if (running) return stop()
  releaseAudio(); running = true; last = performance.now(); $('stream').textContent = 'Pause'; $('stream').setAttribute('aria-pressed', 'true')
  if ($('follow').checked) view(Math.max(0, length() - rate * 8), length())
}
$('controls').oninput = e => {
  if (!e.target.validity.valid || (e.target.type === 'number' && !e.target.value)) return
  if (e.target.id === 'scale') { scale = $('scale').value; setBand() }
  if (['low', 'high'].includes(e.target.id)) {
    if (num('low') >= num('high')) return error('Low frequency must be below high frequency.')
    setBand(num('low'), num('high'))
  }
  if (!$('auto').checked && num('floor') >= num('ceiling')) return error('Level floor must be below the ceiling.')
  levels = $('auto').checked ? null : [num('floor'), num('ceiling')]
  error(''); paint = dirty = true
}
$('controls').onreset = () => queueMicrotask(() => { $('source').value = 'tones'; scale = 'log'; levels = null; generate() })
$('file').onchange = async () => {
  const file = $('file').files[0]; if (!file) return
  const id = ++task; stop(); player.pause(); $('status').value = `Opening ${file.name}…`
  try {
    const { data, rate: sr } = await decode(file)
    if (id !== task) return
    if (data.length > 8) throw Error('Open audio with at most 8 channels.')
    $('source').value = 'file'; $('source').querySelector('[value=file]').hidden = false
    install(data, sr, file.name); audio(file)
  } catch (e) { if (id === task) { error(`Cannot open ${file.name}: ${e.message}`); status() } }
  finally { $('file').value = '' }
}
player.addEventListener('error', () => { if (player.getAttribute('src')) error('The browser cannot play this audio file.') })
window.addEventListener('pagehide', releaseAudio)
requestAnimationFrame(function draw(now) {
  requestAnimationFrame(draw)
  if (running && now - last >= 50) {
    const n = Math.round(rate * Math.min((now - last) / 1000, .2) * num('speed')); last = now
    if (length() + n > rate * 300) { stop(); error('Five minutes captured. Choose a source to start a new stream.') }
    else { lanes[0].push(gen(n)); if ($('follow').checked) range = range.map(v => v + n); dirty = true; status() }
  }
  if (!player.hidden && lanes.length) {
    const pos = player.currentTime * rate, span = range[1] - range[0]
    if (!player.paused && $('follow').checked && (pos > range[1] || pos < range[0])) view(pos, pos + span)
    const x = LEFT + (pos - range[0]) / span * pw
    $('playhead').hidden = x < LEFT || x > LEFT + pw; $('playhead').style.left = x + 'px'
  }
  if (!lanes.length || (!dirty && !lanes.some(s => s.pending))) return
  dirty = false; const start = performance.now()
  try {
    if (paint) { appearance(); paint = false }
    for (const s of lanes) s.update({ range, band, scale }).clear().render()
    axes(); const levels = lanes[0].levels
    $('floor-label').value = `${Math.round(levels[0])} dB`; $('top-label').value = `${Math.round(levels[1])} dB`
    $('perf').value = `${(performance.now() - start).toFixed(1)} ms/frame (CPU) · FFT ${lanes[0].size}${lanes.some(s => s.pending) ? ' · refining' : ''}`
  } catch (e) { stop(); error(e.message) }
})
await generate()
