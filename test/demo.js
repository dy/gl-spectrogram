import test from 'node:test'
import assert from 'node:assert/strict'
import { open, origin } from './browser.js'

// A tone, a 16-bit mono WAV
export function wav(f = 1000, seconds = 3, rate = 48000) {
  const n = rate * seconds, bytes = Buffer.alloc(44 + n * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24)
  bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * f * i / rate) * 16000), 44 + i * 2)
  return bytes
}
// Pixels drawn in a canvas, in [x0, x1) of its width
const ink = (page, id, x0 = 0, x1 = 1) => page.evaluate(([id, x0, x1]) => {
  const c = document.getElementById(id), t = Object.assign(document.createElement('canvas'), { width: c.width, height: c.height }), g = t.getContext('2d')
  g.drawImage(c, 0, 0)
  const a = Math.floor(x0 * c.width), b = Math.ceil(x1 * c.width), d = g.getImageData(a, 0, b - a, c.height).data
  let s = 0
  for (let i = 3; i < d.length; i += 4) s += d[i] > 0
  return s
}, [id, x0, x1])

test('demo: sound comes in from the right as it plays; drag back, zoom time and frequency, palettes and settings', async () => {
  const { browser, page } = await open({ width: 1000, height: 700 }), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route(url => !url.href.startsWith(origin), route => route.abort()) // offline: the libraries' stand-ins
  try {
    await page.goto(origin + '/index.html')
    await page.waitForFunction(() => document.getElementById('title').textContent === 'Blackbird singing')
    assert.equal(await page.locator('#credit').textContent(), 'Diana Tudor, xeno-canto, CC BY 4.0')
    assert.equal(await ink(page, 'chart'), 0, 'nothing before a click')
    assert.ok(await ink(page, 'grid') > 0, 'the grid')
    for (const id of ['swatch', 'scale', 'method', 'fft', 'depth', 'grid-on']) assert.ok(await page.locator('#' + id).count(), id)

    await page.locator('#file').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav(1000, 4) })
    await page.waitForFunction(() => document.getElementById('play').getAttribute('aria-label') === 'Pause')
    await page.waitForTimeout(1200)
    assert.ok(await ink(page, 'chart', .8, 1) > 50, 'the newest on the right')
    assert.equal(await ink(page, 'chart', 0, .2), 0, 'nothing yet on the left')

    const box = await page.locator('#chart').boundingBox(), shot = () => page.locator('#chart').evaluate(c => c.toDataURL())
    await page.locator('#play').click(); await page.waitForFunction(() => document.getElementById('play').getAttribute('aria-label') === 'Play')
    let s = await shot(); await page.mouse.move(box.x + 500, box.y + 300); await page.mouse.wheel(0, -400); await page.waitForTimeout(100); assert.notEqual(await shot(), s, 'zoomed in time')
    s = await shot()
    await page.mouse.move(box.x + 300, box.y + 300); await page.mouse.down(); await page.mouse.move(box.x + 600, box.y + 300, { steps: 5 }); await page.mouse.up()
    await page.waitForTimeout(100); assert.notEqual(await shot(), s, 'dragged back in time')
    s = await shot(); await page.keyboard.down('Shift'); await page.mouse.wheel(0, -400); await page.keyboard.up('Shift'); await page.waitForTimeout(100)
    assert.notEqual(await shot(), s, 'zoomed in frequency')
    s = await shot(); await page.locator('#swatch').click(); await page.waitForTimeout(100); assert.notEqual(await shot(), s, 'a new palette')
    for (const [id, v] of [['scale', 'mel'], ['method', 'frames'], ['fft', '1024'], ['depth', '100']]) {
      s = await shot(); await page.locator('#' + id).selectOption(v); await page.waitForTimeout(150); assert.notEqual(await shot(), s, id)
    }
    for (const width of [375, 768]) { await page.setViewportSize({ width, height: 700 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true) }
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
