import Spectrogram, { scales } from '../index.js'
import { palettes, generator } from './data.js'
import { recordings, streams, download, listen as radio, record } from './sources.js'
import { $, css, num, clamp, error, frame, step, label, setup, decode } from './ui.js'

const canvas = $('chart'), ax = $('axes').getContext('2d'), grid = $('grid').getContext('2d'), player = $('player')
const LEFT = 52, TOP = 30, GAP = 24
let frames = [], reported = 0
let lanes = [], range = [0, 1], band = [20, 24000], levels = null, scale = 'log', rate = 48000, title = ''
let w = 1, h = 1, pw = 1, lh = 1, pr = 1, dirty = true, paint = true, first = true, task = 0, url
let live = null, taken = [] // the live capture and its chunks per channel, to play back once stopped
const cache = new Map() // recordings already decoded
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
const time = s => s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
function status() { $('status').value = `${title}  ${live ? 'live  ' : ''}${time(length() / rate)}  ${rate / 1000} kHz  ${lanes.length === 1 ? 'mono' : lanes.length + ' channels'}` }
function notice(text = '') { $('note').value = text; $('note').hidden = !text }
function credit(info) {
  $('credit').hidden = !info
  if (!info) return
  $('credit').href = info.page; $('credit').textContent = info.credit ? `${info.credit} · ${info.license}` : new URL(info.page).hostname
}
function releaseAudio() { $('play').textContent = 'Play'; $('play').setAttribute('aria-label', 'Play sample'); $('play').disabled = true; $('seek').disabled = true; player.pause(); player.removeAttribute('src'); player.load(); player.hidden = true; $('playhead').hidden = true; if (url) URL.revokeObjectURL(url); url = null }
function audio(blob) { releaseAudio(); url = URL.createObjectURL(blob); player.src = url; $('play').disabled = false; $('seek').disabled = false; $('seek').value = 0 }
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
function install(data, sr, heading, info) {
  const fresh = []
  try { data.forEach(d => fresh.push(new Spectrogram(canvas, { data: d, sampleRate: sr }))) }
  catch (e) { fresh.forEach(s => s.destroy()); throw e }
  lanes.forEach(s => s.destroy()); lanes = fresh; rate = sr; title = heading
  const gl = lanes[0].gl; gl.disable(gl.SCISSOR_TEST); gl.clear(gl.COLOR_BUFFER_BIT)
  fit(); layout(); paint = first = true; credit(info); notice(); status(); error('')
  $('duration-row').hidden = !$('source').selectedOptions[0]?.closest('[label="Test signals"]')
}
// Live chunks onto the lanes, the view following the end
function take(chunk) {
  if (!live) return
  if (length() + chunk[0].length > rate * 300) { stopLive(); return error('Five minutes recorded. Choose a source to start again.') }
  lanes.forEach((s, i) => { const c = chunk[Math.min(i, chunk.length - 1)]; s.push(c); taken[i].push(c) })
  if ($('follow').checked) { const n = length(), span = range[1] - range[0]; range = n > span ? [n - span, n] : [0, span] }
  dirty = true
}
// Stopped, the take plays back like a recording
function stopLive() {
  if (!live) return
  live.stop(); live = null
  const n = lanes[0].length, mix = new Float32Array(n)
  taken.forEach(chunks => { let at = 0; for (const c of chunks) { for (let i = 0; i < c.length; i++) mix[at + i] += c[i] / taken.length; at += c.length } })
  taken = []
  if (n) audio(wav(mix, rate)); else releaseAudio()
  status()
}
// Channels within -30 dB of the first, as a mono recording published as stereo (an MP3's joint stereo leaves them -40 dB
// apart), draw as one
const distinct = data => data.filter((d, c) => {
  if (!c) return true
  let diff = 0, sum = 0
  for (let i = 0; i < d.length; i++) { diff += (d[i] - data[0][i]) ** 2; sum += data[0][i] ** 2 }
  return diff > sum * 1e-3
})
// A recording (downloaded once), live radio, the microphone or a test signal
async function choose() {
  const id = ++task, value = $('source').value, rec = recordings.find(r => r.id === value), station = streams.find(s => s.id === value)
  if (value === 'file') return
  const name = $('source').selectedOptions[0].textContent
  stopLive(); releaseAudio(); error('')
  try {
    if (rec) {
      let got = cache.get(value)
      if (!got) {
        notice(`Downloading ${name}…`)
        const blob = await download(rec.url, p => { if (id === task) notice(`Downloading ${name}  ${Math.round(p * 100)}%`) })
        if (id !== task) return
        notice(`Decoding ${name}…`)
        cache.set(value, got = { ...await decode(blob), blob })
      }
      if (id !== task) return
      install(distinct(got.data), got.rate, name, rec); audio(got.blob)
    } else if (station || value === 'mic') {
      notice(station ? `Tuning in to ${name}…` : 'Waiting for the microphone…')
      const tap = await (station ? radio(station.url, take) : record(take))
      if (id !== task) return tap.stop()
      install(Array.from({ length: station ? 2 : 1 }, () => new Float32Array(0)), tap.rate, name, station)
      live = tap; taken = lanes.map(() => []); range = [0, tap.rate * 8]
      $('play').disabled = false; $('play').textContent = 'Stop'; $('play').setAttribute('aria-label', 'Stop recording')
    } else {
      notice('Generating…')
      const sr = 48000, n = num('duration') * sr, gen = generator(value, sr), data = new Float32Array(n)
      for (let a = 0; a < n; a += 262144) {
        data.set(gen(Math.min(262144, n - a)), a)
        await frame(); if (id !== task) return
      }
      install([data], sr, name); audio(wav(data, sr))
    }
    $('source').querySelector('[value=file]').hidden = true
  } catch (e) { if (id === task) { notice(); error(`${name}: ${e.message}`); status() } }
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
  $('readout').value = p ? `${label(p.from / rate)} s  ${label(p.low)}–${label(p.high)} Hz  ${Number.isFinite(p.level) ? p.level.toFixed(1) + ' dB' : 'silence'}` : ''
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
$('source').prepend(...[['Recordings', recordings], ['Live', [...streams, { id: 'mic', name: 'Microphone' }]]].map(([label, list]) => {
  const group = document.createElement('optgroup')
  group.label = label
  group.append(...list.map(s => new Option(s.name, s.id)))
  return group
}))
$('source').onchange = choose
$('duration').onchange = choose
$('voice-band').onclick = () => { scale = $('scale').value = 'log'; setBand(80, Math.min(4000, rate / 2)); view(range[0], range[0] + Math.min(length(), rate * 3)) }
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
$('controls').onreset = () => queueMicrotask(() => { $('source').value = initial; scale = 'log'; levels = null; choose() })
$('file').onchange = async () => {
  const file = $('file').files[0]; if (!file) return
  const id = ++task; $('status').value = `Opening ${file.name}…`
  try {
    const { data, rate: sr } = await decode(file)
    if (id !== task) return
    if (data.length > 8) throw Error('Open audio with at most 8 channels.')
    stopLive(); $('source').value = 'file'; $('source').querySelector('[value=file]').hidden = false
    install(distinct(data), sr, file.name); audio(file)
  } catch (e) { if (id === task) { error(`Cannot open ${file.name}: ${e.message}`); status() } }
  finally { $('file').value = '' }
}
player.addEventListener('error', () => { if (player.getAttribute('src')) error('The browser cannot play this audio file.') })
$('play').onclick = () => live ? stopLive() : player.paused ? player.play().catch(e => error(e.message)) : player.pause()
for (const event of ['play', 'pause', 'ended']) player.addEventListener(event, () => {
  $('play').textContent = player.paused ? 'Play' : 'Pause'
  $('play').setAttribute('aria-label', player.paused ? 'Play sample' : 'Pause sample')
})
player.addEventListener('timeupdate', () => { if (Number.isFinite(player.duration)) $('seek').value = player.currentTime / player.duration * 1000 })
$('seek').oninput = () => { if (Number.isFinite(player.duration)) player.currentTime = num('seek') / 1000 * player.duration }
window.addEventListener('pagehide', () => { stopLive(); releaseAudio() })
requestAnimationFrame(function draw(now) {
  requestAnimationFrame(draw)
  if (url && lanes.length) {
    const pos = player.currentTime * rate, span = range[1] - range[0]
    if (!player.paused && $('follow').checked && (pos > range[1] || pos < range[0])) view(pos, pos + span)
    const x = LEFT + (pos - range[0]) / span * pw
    $('playhead').hidden = player.paused || x < LEFT || x > LEFT + pw; $('playhead').style.left = x + 'px'
  }
  if (!lanes.length || (!dirty && !lanes.some(s => s.pending))) return
  dirty = false; const start = performance.now()
  try {
    if (paint) { appearance(); paint = false }
    for (const s of lanes) s.update({ range, band, scale }).clear().render()
    axes()
    frames.push(now); while (frames[0] < now - 1000) frames.shift()
    if (!live || now - reported >= 250) {
      const levels = lanes[0].levels
      $('floor-label').value = `${Math.round(levels[0])} dB`; $('top-label').value = `${Math.round(levels[1])} dB`
      const fps = frames.length > 1 ? Math.round((frames.length - 1) * 1000 / (now - frames[0])) : 0
      // The first render of new data uploads it and levels the whole data, compiling shaders once: not a frame's cost
      const cost = (performance.now() - start).toFixed(1)
      $('perf').value = `${live ? `${fps} fps  ` : ''}${first ? `first render ${cost} ms` : `${cost} ms/frame`}  FFT ${lanes[0].size}${lanes.some(s => s.pending) ? '  refining' : ''}`
      $('perf').title = 'CPU render time; excludes GPU completion.'
      status(); reported = now
    }
    first = false
  } catch (e) { stopLive(); error(e.message) }
})
// ?source= picks the first source: a recording, a stream, mic or a test signal
const asked = new URLSearchParams(location.search).get('source'), initial = $('source').querySelector(`option[value="${CSS.escape(asked ?? '')}"]`) ? asked : 'blackbird'
$('source').value = initial
await choose()
