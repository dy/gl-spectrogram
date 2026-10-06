import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { open, origin } from './browser.js'

// The page captures through an AudioWorklet, which only a secure context has: the repo served on https too
const root = fileURLToPath(new URL('..', import.meta.url)), secure = origin.replace('http:', 'https:')

// Two seconds of a 1 kHz tone, a 16-bit mono WAV
function wav(rate = 44100, seconds = 2) {
  const n = rate * seconds, bytes = Buffer.alloc(44 + n * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24)
  bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 1000 * i / rate) * 16000), 44 + i * 2)
  return bytes
}

// Pixels a canvas has drawn, opaque or not
const drawn = (page, id) => page.evaluate(id => {
  const c = document.getElementById(id), t = Object.assign(document.createElement('canvas'), { width: c.width, height: c.height }), g = t.getContext('2d')
  g.drawImage(c, 0, 0)
  return g.getImageData(0, 0, t.width, t.height).data.filter((v, i) => i % 4 === 3 && v).length
}, id)

test('old demo: the v1 header and settings, a file played scrolls in, pause holds it', async () => {
  const { browser, page } = await open({ width: 800, height: 500 }), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route(url => !url.href.startsWith(origin) && !url.href.startsWith(secure), route => route.abort())  // offline: no CDN colormaps
  await page.route(secure + '/**', route => route.fulfill({ path: root + decodeURIComponent(new URL(route.request().url()).pathname).slice(1) }))
  try {
    await page.goto(secure + '/example/old.html')
    await page.waitForFunction(() => document.getElementById('title').textContent === 'Blackbird singing')
    assert.equal(await page.locator('#license').textContent(), 'CC BY 4.0')
    assert.equal(await page.locator('#play').getAttribute('aria-label'), 'Play')
    assert.equal(await drawn(page, 'spectrogram'), 0)
    assert.ok(await drawn(page, 'lines') > 0, 'grid lines')

    await page.locator('#file').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav() })
    await page.waitForFunction(() => document.getElementById('title').textContent === 'tone.wav')
    if (await page.locator('#play').getAttribute('aria-label') === 'Play') await page.locator('#play').click()
    for (let t = 0; t < 100 && !await drawn(page, 'spectrogram'); t++) await page.waitForTimeout(100)
    assert.ok(await drawn(page, 'spectrogram') > 0, 'the tone scrolls in')
    assert.equal(await page.locator('#credit').isHidden(), true)

    await page.locator('#play').click()
    assert.equal(await page.locator('#play').getAttribute('aria-label'), 'Play')
    await page.waitForTimeout(300)
    const held = await page.locator('#spectrogram').evaluate(c => c.toDataURL())
    await page.waitForTimeout(500)
    assert.equal(await page.locator('#spectrogram').evaluate(c => c.toDataURL()), held, 'paused, the picture holds')

    await page.locator('#menu').click()
    assert.equal(await page.locator('#params').isVisible(), true)
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    assert.equal(await bg(), 'rgb(89, 79, 79)')
    await page.locator('#inversed').check(); assert.equal(await bg(), 'rgb(229, 252, 194)')
    await page.locator('#grid').uncheck(); assert.equal(await drawn(page, 'lines'), 0)
    await page.locator('#grid').check(); await page.locator('#logarithmic').uncheck(); assert.ok(await drawn(page, 'lines') > 0)
    for (const id of ['speed', 'minDecibels', 'maxDecibels']) await page.locator('#' + id).fill(id === 'speed' ? '20' : '-50')
    await page.waitForTimeout(100)
    assert.notEqual(await page.locator('#spectrogram').evaluate(c => c.toDataURL()), held)
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#params').isHidden(), true)

    for (const width of [320, 375, 768]) {
      await page.setViewportSize({ width, height: 600 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `fits ${width} px`)
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
