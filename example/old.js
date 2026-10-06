// The v1 demo (2016) on v2: start-app's header and settings over a page-wide spectrogram that fills from the left and
// scrolls as the sound plays, a column per 1/speed s. v1 pushed analyser frames; v2 takes the samples and draws the
// last innerWidth/speed seconds of them. v2 has no temporal smoothing or frequency weighting: v1's smoothing and
// weighting settings are left out rather than faked.
import Spectrogram, { scales } from '../index.js'
import { recordings, streams, capture, listen, record } from './sources.js'

const $ = id => document.getElementById(id)
// nice-color-palettes/200 with ends 128 apart in YIQ lightness, as v1 filtered them: the one v1's preview shows
const PALETTE = ['#594f4f', '#547980', '#45ada8', '#9de0ad', '#e5fcc2']
const HIDDEN = ['alpha', 'hsv', 'rainbow', 'rainbow-soft', 'phase']  // colormaps v1's fill left out
const LOW = 40, HIGH = 20000  // v1's minFrequency, maxFrequency

const sources = [
  ...recordings.map(s => ({ ...s, icon: 'url' })),
  ...streams.map(s => ({ ...s, icon: 'url', live: true })),
  { id: 'mic', name: 'Microphone', icon: 'mic', live: true }
]
const sg = new Spectrogram($('spectrogram')), lines = $('lines').getContext('2d')
let source = sources.find(s => s.id === 'blackbird'), audio = null, tap = null, turn = 0, playing = false, status = ''
let rate = 44100, speed = 100, color = PALETTE.at(-1), colormap = null, edge = 0, chunk = 2048, held = [], heldLength = 0, dirty = true

const svg = name => `<svg viewBox="0 0 ${name === 'github' ? 784 : 819} 1024" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const span = () => innerWidth * rate / speed
const band = () => [LOW, Math.min(HIGH, rate / 2)]

// Samples as they play: mono like v1's analyser, a view's span kept to restart the data from when it grows long
function feed(channels) {
  if (audio && (audio.paused || audio.readyState < 3)) return  // v1 pushed from the play event on, not while loading
  const x = channels.length > 1 ? channels[0].map((v, i) => (v + channels[1][i]) / 2) : channels[0]
  chunk = x.length; sg.push(x); held.push(x); heldLength += x.length
  while (heldLength - held[0].length >= span()) heldLength -= held.shift().length
  if (sg.length > Math.max(2 * heldLength, 1 << 23)) {  // a stream left playing would fill the GPU: keep the view's span
    const data = new Float32Array(heldLength), cut = sg.length - heldLength
    held.reduce((at, c) => (data.set(c, at), at + c.length), 0)
    sg.update({ data }); edge = Math.max(0, edge - cut)
  }
}
function begin(t) {
  if (t.rate !== rate) { rate = t.rate; sg.update({ data: null, sampleRate: rate }); held = []; heldLength = 0; edge = 0; apply() }
}

async function play() {
  const id = ++turn
  playing = true; status = 'loading'; show()
  try {
    if (source.live) {
      const t = await (source.id === 'mic' ? record(feed) : listen(source.url, feed))
      if (id !== turn) return t.stop()
      tap = t; begin(t); status = ''
    } else {
      const a = audio ??= Object.assign(new Audio(), { crossOrigin: 'anonymous', loop: true, src: source.url })
      a.onwaiting = () => { status = 'loading'; show() }
      a.onplaying = () => { status = ''; show() }
      if (!tap) { const t = await capture(a, feed); if (a !== audio) return t.stop(); tap = t; begin(t) }
      if (id === turn) await a.play()
    }
  } catch (e) { if (id === turn) { playing = false; status = e.message || 'cannot play'; console.warn(e) } }
  show()
}
function pause() {
  ++turn; playing = false; status = ''
  if (audio) audio.pause()
  else tap?.stop(), tap = null
  show()
}
function choose(s) {
  pause(); tap?.stop(); tap = null
  if (audio) { audio.removeAttribute('src'); audio.load(); audio = null }
  if (source.id === 'file') URL.revokeObjectURL(source.url)
  source = s; $('source').value = s.id === 'file' ? '' : s.id
  show()
}
function open(file) {
  if (!file || file.type && !/^(audio|video)\//.test(file.type)) {
    status = 'not an audio'; show()
    return setTimeout(() => status === 'not an audio' && (status = '', show()), 1500)  // as start-app did, then the source again
  }
  choose({ id: 'file', name: file.name, url: URL.createObjectURL(file), icon: 'record' }); play()
}

function show() {
  $('icon').innerHTML = svg(status === 'loading' ? 'loading' : status ? 'error' : source.icon)
  $('title').textContent = status && status !== 'loading' ? status : source.name
  $('title').title = source.name
  const { credit = '', license = '', page = '' } = source
  $('credit').hidden = !credit
  $('who').textContent = $('author').title = credit
  $('author').href = $('license').href = page
  $('license').textContent = license
  $('play').innerHTML = `<i>${svg(playing ? 'pause' : 'play')}</i>`
  $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play')
}

// v1's fill: the palette or a named colormap of 128 shades, inversed reversed; its floor is the page, its top the text
function apply() {
  const fill = $('fill').value, min = +$('minDecibels').value, max = +$('maxDecibels').value
  let stops = fill === 'palette' || !colormap ? PALETTE : colormap({ colormap: fill, nshades: 128, format: 'hex' })
  if ($('inversed').checked) stops = stops.toReversed()
  color = stops.at(-1); speed = +$('speed').value
  sg.update({ color: stops, scale: $('logarithmic').checked ? 'log' : 'lin', levels: [min, Math.max(max, min + 1)], band: band() })
  const c = rgb(color), dark = (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 < 128
  const inverse = c.map(v => Math.min(Math.max((255 - v) * (dark ? 1.8 : .2), 0), 255)).map(v => dark ? 255 * .8 + v * .2 : v * .2)
  document.body.style.setProperty('--bg', stops[0])
  document.body.style.setProperty('--c', c.join())
  document.body.style.setProperty('--i', inverse.map(Math.round).join())
  grid(); dirty = true
}

// v1's plot-grid lines, in the top color: dotted at 13.5%, the powers of ten again at 8%; on a linear axis one per 50 px
function grid() {
  const w = innerWidth, h = innerHeight, r = devicePixelRatio, [lo, hi] = band()
  const scale = $('logarithmic').checked ? 'log' : 'lin'
  lines.setTransform(r, 0, 0, r, 0, 0); lines.clearRect(0, 0, w, h)
  if (!$('grid').checked) return
  let values = []
  if (scale === 'log') for (const base of [1, 2, 3, 4, 5, 6, 7, 8, 9]) for (let v = base * 10 ** Math.floor(Math.log10(lo)); v <= hi; v *= 10) v >= lo && values.push(v)
  else {
    const raw = (hi - lo) / Math.floor(h / 50), order = 10 ** Math.floor(Math.log10(raw) + 1e-9)
    const step = [1, 2, 2.5, 5, 10].map(v => v * order).reduce((a, b) => Math.abs(b - raw) < Math.abs(a - raw) ? b : a)
    for (let v = step * Math.round(lo / step); v <= hi; v += step) v >= lo && values.push(v)
  }
  lines.strokeStyle = color; lines.lineWidth = 1; lines.setLineDash([1, 1])
  const draw = (vs, alpha) => {
    lines.globalAlpha = alpha; lines.beginPath()
    for (const f of vs) { const y = Math.max(.5, Math.round(h * (1 - scales[scale].at(f, lo, hi))) - .5); lines.moveTo(0, y); lines.lineTo(w, y) }
    lines.stroke()
  }
  draw(values, .135)
  if (scale === 'log') draw(values.filter(v => String(v)[0] === '1'), .08)
}

function resize() {
  const r = devicePixelRatio
  for (const c of [$('spectrogram'), $('lines')]) c.width = Math.round(innerWidth * r), c.height = Math.round(innerHeight * r)
  sg.update({ pixelRatio: r }); grid(); dirty = true
}

// start-app's fps meter: a bar per second over the last 32, 100 fps full height
const meter = $('fps').getContext('2d'), bars = Array(32).fill(0)
let frames = 0, since = performance.now(), last = since
function measure(now) {
  frames++
  if (now - since < 1000) return
  bars.push(frames * 10 / (now - since)); bars.shift(); frames = 0; since = now
  meter.clearRect(0, 0, 32, 16); meter.fillStyle = color
  bars.forEach((v, i) => meter.fillRect(i, 16 - 16 * v, 1, 16 * v))
  $('fps-value').textContent = (bars.at(-1) * 100).toFixed(1)
}

// The view's right edge follows the data at the playing rate, a chunk behind, so it scrolls smoothly between chunks
function frame(now) {
  requestAnimationFrame(frame)
  measure(now)
  const dt = Math.min(now - last, 100) / 1000, n = sg.length; last = now
  $('progress').style.width = audio?.duration ? audio.currentTime / audio.duration * 100 + '%' : 0
  const to = Math.min(n, Math.max(n - chunk, edge + dt * rate))
  if (to === edge && !dirty && !sg.pending) return
  edge = to; dirty = false
  const from = Math.max(0, edge - span())
  sg.update({ range: [from, from + span()] }).clear().render()
}

$('source').append(
  ...[['Recordings', recordings], ['Live radio', streams]].map(([label, list]) => {
    const group = Object.assign(document.createElement('optgroup'), { label })
    group.append(...list.map(s => new Option(s.name, s.id)))
    return group
  }),
  new Option('Microphone', 'mic'), new Option('Open file…', 'file'))
$('source').onchange = e => {
  if (e.target.value !== 'file') return choose(sources.find(s => s.id === e.target.value)), play()
  e.target.value = source.id === 'file' ? '' : source.id
  $('file').click()
}
$('file').onchange = e => open(e.target.files[0])
$('play').onclick = () => playing ? pause() : play()
const toggle = (on = $('params').hidden) => { $('params').hidden = !on; $('menu').setAttribute('aria-expanded', on) }
$('menu').onclick = () => toggle()
$('close').onclick = () => toggle(false)
$('params').oninput = e => { e.target.title = e.target.value; apply() }
$('params').onsubmit = e => e.preventDefault()
addEventListener('keydown', e => e.key === 'Escape' && toggle(false))
addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drop') })
addEventListener('dragleave', e => e.relatedTarget || document.body.classList.remove('drop'))
addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('drop'); open(e.dataTransfer.files[0]) })
addEventListener('resize', resize)

// Named colormaps from the CDN, as v1's fill listed them; offline the palette stays the only fill
import('https://esm.sh/colormap@2').then(async ({ default: cm }) => {
  const { default: all } = await import('https://esm.sh/colormap@2/colorScale.js')
  colormap = cm
  $('fill').append(...Object.keys(all).filter(n => !HIDDEN.includes(n)).map(n => new Option(n)))
}).catch(e => console.warn('colormaps unavailable:', e.message))

// start-app's icons (IcoMoon), rounded to whole units
const ICONS = {
  url: 'M408 122c-200 0-362 163-362 362s163 362 362 362 362-163 362-362-163-362-362-362zM408 792c-40 0-83-75-102-187 32-5 67-8 102-8s70 3 102 8c-19 112-62 187-102 187zM408 541c-38 0-74 3-109 8-2-20-3-42-3-64s1-43 3-64c35 5 71 8 109 8s74-3 109-8c2 20 3 42 3 64s-1 43-3 64c-35-5-71-8-109-8zM101 485c0-43 9-83 25-120 32 19 73 35 118 46-2 24-3 49-3 75s1 51 3 75c-45 11-86 26-118 46-16-37-25-78-25-121zM408 178c40 0 83 75 102 187-32 5-66 8-102 8s-70-3-102-8c19-112 62-187 102-187zM572 410c45-11 86-26 118-46 16 37 25 78 25 120s-9 83-25 120c-32-19-73-35-118-46 2-24 3-49 3-75s-1-50-3-74zM663 315c-26 16-60 30-99 40-11-64-29-118-53-158 62 23 115 64 152 119zM304 197c-24 40-43 94-53 158-39-10-72-23-99-40 36-54 89-96 152-119zM152 655c26-16 60-30 99-40 11 64 29 118 53 158-62-23-115-64-152-119zM511 773c24-40 43-94 53-158 39 10 72 23 99 40-36 54-89 96-152 119z',
  mic: 'M410 682c114 0 207-93 207-207v-165c0-114-93-207-207-207s-207 93-207 207v165c0 114 93 207 207 207zM368 845v85h83v-85c186-21 331-178 331-370v-83h-83v83c0 160-130 289-289 289s-289-130-289-289v-83h-83v83c0 191 145 349 331 370z',
  record: 'M758 818h-696c-29 0-53-24-53-53v-532c0-29 24-53 53-53h696c29 0 53 24 53 53v532c0 29-24 53-53 53zM75 752h669v-505h-669v505zM574 637c-70 0-128-56-128-126s56-126 128-126c70 0 128 56 128 126s-58 126-128 126zM574 451c-32 0-60 27-60 60s27 60 60 60 60-27 60-60-27-60-60-60zM241 637c-70 0-128-56-128-126s56-126 128-126c70 0 128 56 128 126s-58 126-128 126zM241 451c-32 0-60 27-60 60s27 60 60 60c32 0 60-27 60-60s-27-60-60-60zM573 450h-333c-19 0-34-15-34-33s15-33 34-33h333c19 0 34 15 34 33s-17 33-34 33z',
  loading: 'M640 412c-46 0-83 37-83 85s37 85 83 85c46 0 83-37 83-85s-37-85-83-85zM410 412c-46 0-83 37-83 85s37 85 83 85c46 0 83-37 83-85s-37-85-83-85zM179 412c-46 0-83 37-83 85s37 85 83 85c46 0 83-37 83-85s-37-85-83-85z',
  error: 'M807 757l-351-608c-10-17-27-27-46-27 0 0 0 0 0 0s0 0 0 0c-19 0-37 10-46 27l-351 608c-10 17-10 37 0 54 10 17 27 27 47 27h702c19 0 37-10 47-27 10-17 10-37 0-54zM89 766l320-554 320 554h-640zM540 663l-73-74 71-72-58-57-70 71-71-72-58 57 72 73-74 75 58 57 73-74 72 73z',
  play: 'M213 276c0-30 24-54 53-54 9 0 15 2 25 6l375 218c17 10 26 27 29 46v5c-3 19-11 36-29 46l-375 218c-10 4-16 6-25 6-30 0-53-24-53-54v-440z',
  pause: 'M147 267c0-29 24-53 53-53h112c29 0 53 24 53 53v424c0 30-24 53-53 53h-112c-29 0-53-24-53-53v-424zM453 267c0-29 24-53 53-53h112c29 0 53 24 53 53v424c0 30-24 53-53 53h-112c-29 0-53-24-53-53v-424z',
  settings: 'M196 218h453c36 0 65 29 65 64 0 35-29 64-65 64h-453c-36 0-65-28-65-64s29-64 65-64v0zM197 431h453c36 0 65 28 65 64 0 35-29 64-65 64h-453c-36 0-65-29-65-64 0-35 29-64 65-64v0zM196 644h453c36 0 65 29 65 64 0 35-29 64-65 64h-453c-36 0-65-29-65-64 0-35 29-64 65-64v0z',
  github: 'M4 480q0 107 52 194 52 90 141 142t194 52q105 0 195-52 90-52 141-142t52-195q0-107-52-195-52-90-142-141t-195-52q-107 0-194 52-90 52-142 141t-52 194zM69 480q0-65 25-125t69-104q44-44 104-69t124-25 125 25 104 69q44 44 69 104t25 125q0 69-28 133t-80 109-118 66v-114q0-42-35-66 85-8 125-43t39-113q0-60-37-101 7-22 7-42 0-30-14-55-27 0-48 9t-53 31q-38-8-78-8-46 0-85 9-30-22-52-31t-50-9q-13 25-13 55 0 21 7 42-37 40-37 100 0 77 39 112t126 43q-23 15-32 45-20 7-41 7-16 0-28-7-4-2-7-4t-6-5-5-5-5-6-4-6-5-6-4-6q-19-25-45-25-14 0-14 6 0 2 7 8 13 11 14 12 10 8 11 10 12 15 18 32 23 51 78 51 9 0 35-4v86q-66-21-118-66t-80-109-28-133z'
}

$('menu').innerHTML = `<i>${svg('settings')}</i>`
$('github').innerHTML = svg('github')
$('source').value = source.id
resize(); apply(); show(); requestAnimationFrame(frame)
