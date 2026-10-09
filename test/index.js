// npm test: headless Chromium (SwiftShader WebGL2, deterministic), node:test runner
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { open } from './browser.js'

let browser, page
before(async () => ({ browser, page } = await open()))
after(() => browser?.close())

// Run an export of test/page.js in the browser
const run = (name, arg) => page.evaluate(async ([name, arg]) => (await import('/test/page.js'))[name](arg), [name, arg])

// No cell off; under 3% moved a cell over by float32 (a uniform error, as a slip in normalization, moves them all)
const clean = res => {
  assert.equal(res.nbad, 0, `${res.nbad} cells of ${res.cells} differ from the reference, e.g. ${JSON.stringify(res.bad)}`)
  assert.ok(res.moved / res.cells < .03, `${res.moved} of ${res.cells} cells moved`)
}

// ── cells: every pixel column against the CPU reference in doubles ─────

test('reference: its FFT matches the DFT definition', async () => {
  assert.ok(await run('checkFft') < 1e-9)
})

test('cells: log scale, 0.2 to 450 samples per px, frames refined past 128, within 0.01 dB of the reference in doubles', async () => {
  let spans = [32, 160, 1100, 6000, 24000], list = spans.map((s, i) => ({ range: [1000 + i * 1777.3, 1000 + i * 1777.3 + s] }))
  let res = await run('views', { seed: 1, list: [...list, { range: [0, 24000] }, { range: [-3000, 30000] }, { range: [-24000, 48000], size: 256 }] })
  clean(res)
  assert.ok(res.cells > 10000, `cells compared: ${res.cells}`)
})

test('cells: combine max, refined columns the loudest of their frames, within 0.01 dB of the reference in doubles', async () => {
  let spans = [1100, 6000, 24000], list = spans.map((s, i) => ({ range: [1000 + i * 1777.3, 1000 + i * 1777.3 + s] }))
  for (let method of [null, 'frames']) clean(await run('views', { seed: 1, method, combine: 'max', list: [...list, { range: [-24000, 48000], size: 256 }] }))
})

test('cells: mel, erb and lin scales, zoomed bands, other FFT sizes', async () => {
  let list = [
    { range: [2000, 8000], scale: 'mel' },
    { range: [2000, 8000], scale: 'erb' },
    { range: [2000, 8000], scale: 'lin' },
    { range: [4000, 12000], band: [700, 1500] },
    { range: [4000, 12000], scale: 'lin', band: [2500, 4500] },
    { range: [100, 23900], scale: 'mel', band: [0, 5000], size: 2048 },
    { range: [9000, 9600], size: 256 },
    { range: [0, 24000], size: 1024 }
  ]
  clean(await run('views', { seed: 2, list }))
})

test('cells: samples at offset 1e9 draw as they do at 0', async () => {
  clean(await run('views', { seed: 3, far: 1e9, list: [{ range: [1000, 1160] }, { range: [3000, 9000] }, { range: [0, 24000] }] }))
})

test('cells: device pixel ratio 2', async () => {
  clean(await run('views', { seed: 4, pr: 2, list: [{ range: [5000, 7000] }, { range: [0, 24000], scale: 'mel' }] }))
})

// The other methods, each against its own reference: zoomed in to a sample a column, on every scale, zoomed bands, the
// whole, and refined zoomed out (450 samples a column, 5 frames each)
const methodViews = [
  { range: [1000, 1160] },
  { range: [2000, 8000] },
  { range: [2000, 8000], scale: 'mel' },
  { range: [4000, 12000], scale: 'erb', band: [700, 1500] },
  { range: [100, 23900], scale: 'lin', band: [0, 5000] },
  { range: [0, 24000], scale: 'erb' },
  { range: [-24000, 48000], size: 256 }
]
for (let method of ['frames', 'synchrosqueezed', 'bands', 'tapers'])
  test(`cells: ${method}, within 0.01 dB of the reference in doubles`, async () => {
    let res = await run('views', { seed: 6, method, list: methodViews })
    clean(res)
    assert.ok(res.cells > 20000, `cells compared: ${res.cells}`)
  })

// Wigner–Ville is bilinear: its level is the FFT's value itself, not a square of it, so float32's error, about 1e-7 of
// the loudest cell, reaches 0.01 dB 30 dB below it, where the other methods' reaches it 60 dB below
test('cells: wigner, within 0.01 dB of the reference in doubles where within 30 dB of the loudest', async () => {
  let res = await run('views', { seed: 6, method: 'wigner', depth: 30, list: methodViews })
  clean(res)
  assert.equal(res.moved, 0, 'nothing moves: a row reads its spectrum')
})

// ── placement ─────────────────────────────────────────────────────────

// Reference level: a full-scale sine is 0 dB (Hann coherent gain 1/2, equivalent noise bandwidth 1.5 bins: Harris 1978,
// table 1; reassignment gathers its lobe into one cell). Reference row: the scale's formula, as the REPL's scale.js.
test('sine: a full-scale 1 kHz sine is one row thin, on the row the scale gives, at 0 dB ± 1', async () => {
  for (let scale of ['log', 'mel', 'lin']) {
    let r = await run('sine', { scale })
    let want = Math.floor(r.u), near = Math.abs(r.u - Math.round(r.u)) < .01
    for (let row of r.rows) assert.ok(row === want || near && Math.abs(row - r.u) < 1, `${scale}: row ${row}, the formula gives ${r.u}`)
    for (let v of r.levels) assert.ok(Math.abs(v) < 1, `${scale}: ${v} dB`)
    for (let v of r.next) assert.ok(v < -40, `${scale}: a neighbouring row reads ${v} dB`)
    assert.ok(r.cell.low <= 1000 && 1000 < r.cell.high, `${scale}: pick() puts 1 kHz in [${r.cell.low}, ${r.cell.high})`)
  }
})

test('sine: amplitude 0.1 reads -20 dB, also at 440 Hz and 15 kHz, on a zoomed band, at every FFT size', async () => {
  for (let [f, band, size] of [[440, null, null], [15000, null, null], [1000, [800, 1250], null], [1000, null, 256], [1000, null, 8192]]) {
    let r = await run('sine', { scale: 'log', amp: .1, f, band, size })
    for (let v of r.levels) assert.ok(Math.abs(v + 20) < 1, `${f} Hz, band ${band}, size ${r.size}: ${v} dB`)
    for (let row of r.rows) assert.ok(Math.abs(row - r.u) < 1.01, `${f} Hz: row ${row}, the formula gives ${r.u}`)
  }
})

// A sine on a bin of every method's grid, 1007.8125 Hz (bin 43 of 2048 at 48 kHz, 86 of the 4096 that tapers pad to and
// that Wigner–Ville's analytic signal spans): at 0 dB within 0.01 for the methods that read a spectrum, within 1 where
// reassignment gathers it; on the row each scale's formula gives. Between bins, Hann frames lose up to 1.42 dB (its
// scalloping loss, Harris 1978, table 1), tapers' flat top under 0.2.
test('sine: every method on every scale, a full-scale sine on its row at 0 dB', async () => {
  for (let method of ['frames', 'reassigned', 'synchrosqueezed', 'bands', 'tapers', 'wigner']) for (let scale of ['log', 'mel', 'erb', 'lin']) {
    let r = await run('sine', { scale, method, f: 1007.8125 }), want = Math.floor(r.u), near = Math.abs(r.u - Math.round(r.u)) < .01
    let gathers = !['reassigned', 'synchrosqueezed'].includes(method), off = gathers ? .01 : 1
    assert.equal(r.size, 2048, `${method}, ${scale}: FFT size`)
    for (let row of r.rows) assert.ok(row === want || near && Math.abs(row - r.u) < 1, `${method}, ${scale}: row ${row}, the formula gives ${r.u}`)
    for (let v of r.levels) assert.ok(Math.abs(v) < off, `${method}, ${scale}: ${v} dB`)
    if (!gathers) for (let v of r.next) assert.ok(v < -40, `${method}, ${scale}: a neighbouring row reads ${v} dB`)
  }
  for (let [method, low] of [['frames', -1.43], ['bands', -1.43], ['tapers', -.2]]) {
    let r = await run('sine', { scale: 'lin', method, f: 1000 + 23.4375 / 2 })
    for (let v of r.levels) assert.ok(v > low && v < .01, `${method}, half a bin off: ${v} dB`)
  }
})

test('click: one sample lands on the column holding it, at 0.3 to 2880 samples per px', async () => {
  // past 256 samples a column, frames of 512 sample it at first; renders while pending add frames till all are in one
  let res = await run('click', { k: 48000 + 777, spans: [60, 200, 2000, 30000, 51200, 96000 * 6] })
  assert.ok(res.at(-1).renders > 1, 'the widest columns took more than one render')
  for (let r of res) {
    assert.ok(r.holds, `span ${r.span}: the loudest column holds samples [${r.from}, ${r.to})`)
    assert.ok(r.others < r.peak - 30, `span ${r.span}: other columns ${r.others} dB, the click ${r.peak} dB`)
  }
})

// The click on its column by every other method too, each frame in its own column: the loudest the one centered
// nearest it under Hann or the lag window. Three sine tapers squared sum to 3/2 − ½ Σ cos(2πjn/L), 2 at the frame's
// center and 2.16 at n = .21 L: a click reads 0.33 dB louder through frames holding it off center, so its own column is
// within half a dB of the loudest.
// 2880 samples a column take 13 frames of 512: their mean holds the click in one of them, the loudest holds it whole
test('click: with combine max, on the column holding it, at the level of the frame that holds it', async () => {
  let [max] = await run('click', { k: 48000 + 777, spans: [96000 * 6], combine: 'max' }), [mean] = await run('click', { k: 48000 + 777, spans: [96000 * 6] })
  for (let r of [max, mean]) assert.ok(r.holds && r.others < r.peak - 30, `[${r.from}, ${r.to}), ${r.peak} dB, others ${r.others}`)
  assert.ok(max.peak - mean.peak > 8, `the loudest ${max.peak.toFixed(1)} dB, the mean ${mean.peak.toFixed(1)}`)
})

test('click: by every method, on the column holding it', async () => {
  for (let method of ['frames', 'synchrosqueezed', 'bands', 'tapers', 'wigner']) {
    let res = await run('click', { k: 48000 + 777, spans: [60, 200, 2000, 30000], method })
    for (let r of res) {
      if (method === 'tapers') assert.ok(r.own > r.peak - .5, `tapers, span ${r.span}: its column ${r.own} dB, the loudest ${r.peak} dB`)
      else assert.ok(r.holds, `${method}, span ${r.span}: the loudest column holds samples [${r.from}, ${r.to})`)
    }
  }
})

test('scales: the exported axes are the REPL\'s', async () => {
  let r = await page.evaluate(async () => {
    let { scales, at } = await import('/test/page.js'), out = []
    for (let s of ['log', 'mel', 'erb', 'lin']) for (let f of [20, 100, 1000, 5000, 20000]) {
      let lo = s === 'log' ? 20 : 0
      out.push([s, f, scales[s].at(f, lo, 24000), at(s, f, lo, 24000), scales[s].of(scales[s].at(f, lo, 24000), lo, 24000)])
    }
    return { out, low: [scales.log.low, scales.mel.low, scales.erb.low, scales.lin.low] }
  })
  assert.deepEqual(r.low, [20, 0, 0, 0])
  for (let [s, f, got, want, back] of r.out) {
    assert.ok(Math.abs(got - want) < 1e-12, `${s} ${f} Hz: ${got} vs ${want}`)
    assert.ok(Math.abs(back - f) < 1e-9 * f + 1e-9, `${s}: of(at(${f})) = ${back}`)
  }
})

// ── consistency ───────────────────────────────────────────────────────

test('pans: cached columns plus new ones draw what a fresh view draws; an unchanged view computes nothing', async () => {
  for (let method of [null, 'synchrosqueezed', 'bands', 'wigner']) {
    let r = await run('pans', { method })
    assert.ok(r.worst < .01, `${method}: largest difference ${r.worst} dB`)
    assert.ok(r.runs > 0, `${method}: pans computed new columns`)
    assert.equal(r.again, 1, `${method}: a view already computed is one draw`)
  }
})

// Zoomed in, a frame gives to columns far either side of its own: each is transformed once, given to every column it
// reaches, so a pan of a few columns transforms a few frames, and the picture is what a fresh view draws
test('sweeps: zoomed in, a pan transforms the frames it uncovers; turns, jumps and edits draw what a fresh view draws', async () => {
  let r = await run('sweeps')
  assert.ok(r.worst < .01, `largest difference ${r.worst} dB`)
  assert.ok(r.step < .1, `a pan of 5 columns scatters ${(r.step * 100).toFixed(1)}% of the points the whole view does`)
})

// Noise zoomed out as frames come, by the median cell: their mean keeps the mean power, so the frames' picture (each
// cell the highest across its row's bins) holds within half a dB, at any zoom; reassigned cells, sparser, rise only as
// their speckle averages out (a noise bin's median is ln 2, 1.6 dB, under its mean), well under what the loudest of the
// frames adds, which grows with their number (frames of 512: 15 at 4800 samples a column)
test('steady: zoomed out, noise reads as it does at the first render and at other zooms', async () => {
  let frames = await run('steady', { method: 'frames' })
  for (let r of frames) assert.ok(Math.abs(r.settled - r.first) < .5 && Math.abs(r.settled - frames[0].settled) < .5, `frames, ${r.spp} samples a column: ${r.first.toFixed(1)} dB first, ${r.settled.toFixed(1)} settled, ${frames[0].settled.toFixed(1)} at 64`)
  for (let method of [null, 'frames', 'synchrosqueezed']) {
    let mean = (await run('steady', { method })).at(-1), max = (await run('steady', { method, combine: 'max' })).at(-1)
    let rise = mean.settled - mean.first, most = max.settled - max.first
    assert.ok(rise < 3.5 && most > 4 && rise < most / 2.5, `${method}: the mean rises ${rise.toFixed(1)} dB as frames come, the loudest ${most.toFixed(1)}`)
  }
})

// A render transforms a frame per new column, then adds frames to columns while it has spent under a frame per 2 px or
// 256 frames, whichever is more, each run with its margin frames
test('refining: zoomed out, a render costs about a frame per pixel column; pending until every sample is in a frame', async () => {
  let r = await run('refine')
  assert.ok(r.pending[0], 'the first render of 4800 samples a column is pending')
  assert.ok(r.spent.every(f => f <= 256 + 16), `frames a render: ${r.spent}`)
  assert.equal(r.pending.at(-1), false, 'it settles')
  assert.ok(r.spent.length >= 200 * 19 / 256, `19 frames a column take ${r.spent.length} renders`)
  assert.equal(r.after, 0, 'a settled view computes nothing')
  assert.ok(r.pans < .01, `refined pans vs fresh views: ${r.pans} dB`)
  assert.equal(r.near, false, 'a column of one sample has its one frame')
  assert.equal(r.narrow.pending, false, `a 4 px viewport settles too, in ${r.narrow.renders} renders`)
})

test('spectra given: a sound held as its spectra draws from them, zoomed out and in; its samples set over a part draw as data does there; dropped, the spectra again', async () => {
  let max = await run('spectral', { seed: 11, combine: 'max' })
  assert.equal(max.nbad, 0, JSON.stringify(max.bad))
  assert.ok(max.alike.median < 1 && max.alike.p95 < 6, `combine max, as the samples draw it: ${JSON.stringify(max.alike)} dB`)
  let res = await run('spectral', { seed: 11 })
  assert.ok(res.cells > 1e4, `${res.cells} cells checked`)
  // zoomed out, as the samples draw it, its frames placed apart: their mean 0.2 dB the median, 0.8 the 95th percentile
  // here; the loudest of them, 0.3 and 3.8
  assert.ok(res.alike.median < .5 && res.alike.p95 < 2, `as the samples draw it: ${JSON.stringify(res.alike)} dB`)
  assert.equal(res.nbad, 0, JSON.stringify(res.bad))
})

test('streaming: push() and set() give what the data given at once gives', async () => {
  let r = await run('edits')
  assert.ok(r.worst < .01, `largest difference ${r.worst} dB`)
  assert.ok(r.length > 50000)
})

test('previews: pieces at the view\'s zoom reuse its columns; a gain shows at once', async () => {
  let r = await run('pieces')
  assert.equal(r.fade, 10, 'ten pieces of the computed view: a draw each, nothing computed')
  assert.ok(r.move, 'a piece from outside the view computes its columns')
  assert.ok(Math.abs(r.loud - r.soft - 20) < .01, `gain 0.1 is -20 dB: ${r.loud} → ${r.soft}`)
})

test('gaps: NaN and ±Infinity read as silence, nothing else changes', async () => {
  let r = await run('gaps')
  assert.ok(r.finite, 'no NaN levels')
  assert.ok(r.worst < .01, `vs zeros in their place: ${r.worst} dB`)
})

// ── pixels ───────────────────────────────────────────────────────────

test('render: lanes sharing a context stay inside their viewports, one set of programs', async () => {
  let r = await run('lanes')
  assert.ok(r.aInk > 100 && r.bInk > 100, `both lanes draw: ${r.aInk}, ${r.bInk}`)
  assert.equal(r.bleed, 0, 'lane A does not draw outside its viewport')
  assert.ok(r.aKept, 'drawing lane B leaves lane A untouched')
  assert.equal(r.aCleared, 0, 'clear() empties lane A')
  assert.ok(r.bKept, 'clearing lane A leaves lane B untouched')
  assert.equal(r.more, 0, 'the second spectrogram on a context makes no programs')
})

test('storage: a gap in a block written into later reads silence, not what its texture layer held', async () => {
  let r = await run('stale')
  assert.ok(r.before, 'the first data was drawn')
  assert.ok(r.loud < -150, `the gap reads ${r.loud} dB`)
})

test('render: nothing drawn before or after the data; the default viewport follows a resized canvas', async () => {
  let r = await run('edges')
  assert.equal(r.before, 0)
  assert.equal(r.after, 0)
  assert.ok(r.inside > 100)
  assert.equal(r.pickBefore, null)
  assert.equal(r.pickAfter, null)
  assert.ok(r.right > 100, 'drawn in the new right half')
})

test('levels: auto top is the loudest cell, at least -60 dB; depth, fixed levels, gain', async () => {
  let r = await run('levels')
  assert.ok(Math.abs(r.half[1] - r.loudest) < .1, `a sine at 0.5: top ${r.half[1]}, the reference's loudest cell ${r.loudest}`)
  assert.ok(r.loudest > -6.03 && r.loudest < -4, `the loudest cell ${r.loudest} dB, the steady sine -6.02 dB`)
  assert.ok(Math.abs(r.half[1] - r.half[0] - 80) < 1e-9, 'depth 80 by default')
  assert.deepEqual(r.quiet, [-140, -60], 'a sine at -80 dB: the top stays at -60')
  assert.ok(Math.abs(r.depth[1] - r.depth[0] - 50) < 1e-9, 'depth 50')
  assert.deepEqual(r.fixed, [-90, -10])
  assert.ok(Math.abs(r.full) < 1, `full scale ${r.full} dB`)
  assert.ok(Math.abs(r.gained - r.full + 6.0206) < .01, `gain 0.5: ${r.gained}`)
  assert.equal(r.white, 255, 'the loudest cell is white')
  assert.ok(Math.abs(r.wide[1] - r.half[1]) < 1e-9, 'levels are the whole data\'s, whatever the view')
})

// Lightness per level: OKLab L of a grey is the cube root of its linear light (Ottosson 2020); over the background it
// rises in even steps from the background's to the color's
test('colors: the ramp steps OKLab lightness evenly over its background', async () => {
  for (let [background, color, L1] of [['black', 'white', 1], ['oklch(21% 0 0)', 'white', 1], ['white', 'black', 0]]) {
    let r = await run('ramp', { background, color })
    r.steps.forEach(({ db, L }) => {
      let want = r.L0 + (db + 80) / 80 * (L1 - r.L0)
      assert.ok(Math.abs(L - want) < .006, `${color} over ${background}: at ${db} dB L = ${L}, want ${want}`)
    })
    assert.equal(r.steps[0].alpha, 0, 'the floor is transparent')
  }
})

test('colors: a colormap spans the levels, its stops evenly spaced', async () => {
  let r = await run('colormap')
  r.got.forEach((px, i) => px.forEach((v, j) => assert.ok(Math.abs(v - r.want[i][j]) <= 2, `stop ${i}: ${px} vs ${r.want[i]}`)))
})

test('half floats: without EXT_float_blend the picture matches', async () => {
  let r = await run('half')
  assert.ok(r.worst < .05, `largest difference ${r.worst} dB`)
})

test('context loss: no throws while lost, redraws on restore', async () => {
  let r = await run('lose')
  assert.deepEqual(r.errors, [])
  assert.equal(r.length, 48002, 'push while lost appends, set while lost overwrites')
  assert.ok(r.ink > 100, 'drawn again after restore')
  assert.ok(r.picked)
})

test('an hour at 48 kHz: drawn whole, a click in its last two minutes on its sample, a tone on its row', async () => {
  let r = await run('hour')
  assert.equal(r.length, 172800000)
  assert.ok(r.end >= 6 && r.start === 0, `ink in the last minute only, a line one row thin: ${r.end} px, before it ${r.start}`)
  assert.equal(r.click.hit, r.click.at, `the click sample at px ${r.click.hit}, 120 samples into the view`)
  assert.ok(r.click.beside < r.click.peak - 30, `click ${r.click.peak} dB, two px away ${r.click.beside} dB`)
  assert.ok(Math.abs(r.tone + 12.04) < 1, `a tone at 0.25 reads ${r.tone} dB`)
})

test('api: errors, getters, null defaults, data referenced, destroy', async () => {
  let r = await run('api')
  assert.equal(r.ctor, 'TypeError', 'a canvas without WebGL2 throws')
  for (let [k, v] of Object.entries(r.errors)) assert.match(v, /TypeError|RangeError/, `${k} throws, not ${v}`)
  assert.equal(r.offset, 'RangeError')
  assert.equal(r.far, 'RangeError', 'data past 2^31 samples throws')
  assert.equal(r.length, 70003)
  assert.deepEqual(r.range, [0, 70003], 'default range follows push()')
  assert.equal(r.shared, 0, 'set() changes the spectrogram, never the array given to update({ data })')
  assert.deepEqual(r.getters, [[2, 4], [100, 1000]])
  assert.deepEqual(r.defaults, [[0, 70003], [20, 22050]], 'null restores defaults')
  assert.equal(r.size, 2048, 'auto FFT size at 44.1 kHz: 40 ms')
  assert.deepEqual(r.afterDestroy, [0, 0, null], 'destroyed: no data, draws nothing')
})
