// npm run bench: timings for 1M, 10M and 172.8M samples (1 hour at 48 kHz) of synthetic speech, hardware GPU, stereo
// lanes at DPR 2. GPU time comes from EXT_disjoint_timer_query_webgl2: gl.finish() returns before the GPU is done in
// Chrome on Metal. Time to first picture is wall time to a pixel read back.
import { open } from './browser.js'

let { browser, page } = await open({ gpu: true })

let res = await page.evaluate(async () => {
  let { default: Spectrogram } = await import('/index.js'), { default: voice } = await import('/example/voice.js')
  let W = 1440, H = 200, pr = 2, rate = 48000, c = document.createElement('canvas')
  c.width = W * pr; c.height = 2 * H * pr
  document.body.append(c)
  let lanes = [0, 1].map(i => new Spectrogram(c, { pixelRatio: pr, sampleRate: rate, viewport: [0, i * H, W, H] }))
  let gl = lanes[0].gl, tq = gl.getExtension('EXT_disjoint_timer_query_webgl2'), dbg = gl.getExtension('WEBGL_debug_renderer_info')
  let gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  let now = () => performance.now(), px = new Uint8Array(4), out = []
  let stats = t => { t = [...t].sort((a, b) => a - b); return { mean: t.reduce((a, b) => a + b, 0) / t.length, p95: t[Math.floor(t.length * .95)], max: t.at(-1) } }
  let sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
  let idle = () => new Promise(r => setTimeout(r, 1))

  // frames: each fn() is a frame of work; GPU time each, from timer queries resolved after the batch
  let gpuTimes = async fns => {
    let qs = fns.map(fn => { let q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); fn(); gl.endQuery(tq.TIME_ELAPSED_EXT); return q })
    sync()
    let t = []
    for (let q of qs) { while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) await idle(); t.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q) }
    return t
  }
  let draw = o => () => { for (let s of lanes) s.update(o).clear().render() }

  await new Promise(done => { let t0 = now(); requestAnimationFrame(function f() { now() - t0 < 1000 ? requestAnimationFrame(f) : done() }) })
  // warm the shaders and the scratch on a short signal
  let warm = new Float32Array(rate); voice(9, rate)(warm, 0, rate)
  for (let s of lanes) s.update({ data: warm }).render()
  sync()

  for (let n of [1e6, 1e7, 172.8e6]) {
    let d = new Float32Array(n), row = { n }
    voice(1, rate)(d, 0, n)
    let t = now()
    for (let s of lanes) s.update({ data: d, range: null, band: null })
    row.update = now() - t
    // first picture: upload, the whole data's picture for levels, the view, drawn
    t = now()
    let first = await gpuTimes([draw({})])
    row.first = { wall: now() - t, gpu: first[0] }
    // settling the whole view: renders until nothing is pending
    let settle = []
    while (lanes.some(s => s.pending) && settle.length < 400) settle.push(...await gpuTimes([draw({})]))
    row.settle = { renders: settle.length, gpu: settle.reduce((a, b) => a + b, 0) }
    row.still = stats(await gpuTimes(Array.from({ length: 20 }, () => draw({})))).mean

    // zoom from the whole file to 0.01 samples per px and back, around a point at 40%, a new range each frame
    let zoom = [], D = W * pr
    for (let k = 0; k <= 240; k++) {
      let z = k <= 120 ? k / 120 : (240 - k) / 120, spp = (n / D) * Math.pow(.01 / (n / D), z), span = spp * D, at = n * .4
      zoom.push(draw({ range: [at - span * .4, at + span * .6] }))
    }
    row.zoom = stats(await gpuTimes(zoom))
    // pan at a 10 s view, 7 CSS px a frame
    let spp = rate * 10 / D, from = n * .3
    row.pan = stats(await gpuTimes(Array.from({ length: 120 }, (_, k) => draw({ range: [from + k * 7 * pr * spp, from + k * 7 * pr * spp + spp * D] }))))
    // frequency zoom at a 10 s view: the band from 20 Hz..24 kHz in to 1/16 of the axis around 1 kHz and out
    let band = []
    for (let k = 0; k <= 120; k++) {
      let z = k <= 60 ? k / 60 : (120 - k) / 60, u = Math.log2(1000 / 20) / Math.log2(24000 / 20), w = Math.pow(1 / 16, z)
      let lo = 20 * 1200 ** Math.max(0, u - w * .5), hi = 20 * 1200 ** Math.min(1, u + w * .5)
      band.push(draw({ range: [from, from + spp * D], band: [lo, hi] }))
    }
    row.band = stats(await gpuTimes(band))
    for (let s of lanes) s.update({ band: null })
    // streaming: 0.1 s pushed onto each lane and the view showing the end, a frame each
    let block = d.subarray(0, rate / 10)
    row.push = stats(await gpuTimes(Array.from({ length: 30 }, () => () => {
      for (let s of lanes) { s.push(block); let len = s.length; s.update({ range: [len - rate * 10, len] }).clear().render() }
    })))

    // 3 s of requestAnimationFrame zooming: the frame rate a user sees
    let frames = 0, t0 = now()
    await new Promise(done => {
      let tick = () => {
        let z = (now() - t0) / 3000, spp = (n / D) * Math.pow(.01 / (n / D), z)
        draw({ range: [n * .5 - spp * D / 2, n * .5 + spp * D / 2] })()
        frames++
        if (now() - t0 < 3000) requestAnimationFrame(tick); else done()
      }
      requestAnimationFrame(tick)
    })
    sync()
    row.fps = frames / ((now() - t0) / 1000)
    row.size = lanes[0].size
    out.push(row)
    for (let s of lanes) s.update({ data: [] })
  }
  return { gpu, ua: navigator.userAgent, out }
})

await browser.close()

let f = v => v < 10 ? v.toFixed(2) : v.toFixed(1), ms = v => f(v) + ' ms'
console.log(`GPU: ${res.gpu}\n2 lanes of 1440×200 CSS px at DPR 2 (2880×400 device px each), synthetic speech at 48 kHz; GPU time per frame (both lanes)\n`)
console.log('samples | update({ data }) | first picture, wall / GPU | settle whole view | unchanged | zoom mean / p95 / max | pan mean / p95 | band zoom mean / p95 | push 0.1 s + frame | rAF zoom fps')
console.log('--- | --- | --- | --- | --- | --- | --- | --- | --- | ---')
for (let r of res.out) console.log([
  (r.n / 1e6) + 'M', ms(r.update), `${ms(r.first.wall)} / ${ms(r.first.gpu)}`, `${r.settle.renders} renders, ${ms(r.settle.gpu)}`, ms(r.still),
  `${f(r.zoom.mean)} / ${f(r.zoom.p95)} / ${f(r.zoom.max)} ms`, `${f(r.pan.mean)} / ${f(r.pan.p95)} ms`, `${f(r.band.mean)} / ${f(r.band.p95)} ms`,
  `${f(r.push.mean)} / ${f(r.push.p95)} ms`, r.fps.toFixed(0)
].join(' | '))
