import test from 'node:test'
import assert from 'node:assert/strict'
import { open, origin } from './browser.js'
import { generator } from '../example/data.js'

test('demo signals continue across blocks without restarting', () => {
  for (const source of ['ensemble', 'birds', 'tones', 'voice', 'sweep', 'chord', 'clicks', 'noise']) {
    const whole = generator(source)(10000), chunks = generator(source)
    assert.deepEqual([...whole], [...chunks(3333), ...chunks(6667)], source)
  }
})

test('playground: palettes, scale/band, levels, playback, streaming, files and reset', async () => {
  const { browser, page } = await open({ width: 1000, height: 850 }), errors = []
  page.on('pageerror', e => errors.push(e.message))
  const text = id => page.locator('#' + id).textContent()
  const wait = str => page.waitForFunction(s => { const status = document.getElementById('status').textContent; return !status.startsWith('Opening ') && status.includes(s) }, str)
  const pixels = () => page.locator('#chart').evaluate(c => c.toDataURL())
  const change = async (id, val) => { await page.locator('#' + id).fill(val); await page.locator('#' + id).press('Tab') }
  try {
    await page.goto(origin + '/index.html'); await page.waitForURL(origin + '/example/');
    assert.equal(new URL(page.url()).pathname, '/example/'); await wait('Plucked strings')
    await page.waitForFunction(() => document.getElementById('perf').textContent.includes('ms/frame'))
    const initial = await pixels()
    assert.equal(await page.locator('#panel').isHidden(), true)
    await page.locator('#settings').click()
    await page.locator('#palette').selectOption('inferno'); await page.waitForTimeout(100); assert.notEqual(await pixels(), initial)
    const colored = await pixels(); await page.locator('#reverse').check(); await page.waitForTimeout(100); assert.notEqual(await pixels(), colored)
    await page.locator('#palette').selectOption('custom'); await page.waitForFunction(() => !document.getElementById('tint-row').hidden); assert.equal(await page.locator('#tint').isVisible(), true)
    for (const scale of ['mel', 'lin', 'log']) { await page.locator('#scale').selectOption(scale); assert.equal(await page.locator('#low').inputValue(), scale === 'log' ? '20' : '0') }
    await page.locator('#close-settings').click(); await page.locator('#voice-band').click(); await page.locator('#settings').click(); assert.equal(await page.locator('#high').inputValue(), '4000')
    await change('low', '5000'); assert.match(await text('error'), /below high/)
    await change('low', '100'); assert.equal(await page.locator('#error').isHidden(), true)
    await page.locator('#auto').uncheck(); await change('floor', '1'); assert.match(await text('error'), /below the ceiling/)
    await change('floor', '-90'); await change('ceiling', '-10')
    await page.waitForFunction(() => document.getElementById('floor-label').textContent === '-90 dB' && document.getElementById('top-label').textContent === '-10 dB')
    assert.equal(await text('top-label'), '-10 dB')
    await page.locator('#fft').selectOption('1024'); await page.waitForFunction(() => document.getElementById('perf').textContent.includes('FFT 1024'))
    await page.locator('#close-settings').click()
    const box = await page.locator('#chart').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    assert.match(await text('readout'), /Hz.*(dB|silence)/)
    await page.locator('#chart').focus(); await page.keyboard.press('Home'); await page.keyboard.press('+')
    await page.waitForFunction(() => document.getElementById('view').textContent !== '0 → 24 s')
    await page.locator('#play').click(); await page.waitForTimeout(100)
    assert.equal(await page.locator('#player').evaluate(p => p.paused), false)
    await page.locator('#seek').fill('500'); await page.locator('#seek').dispatchEvent('input')
    assert.ok(await page.locator('#player').evaluate(p => p.currentTime >= 12))
    await page.locator('#play').click(); assert.equal(await page.locator('#player').evaluate(p => p.paused), true)
    await page.locator('#stream').click(); await page.waitForFunction(() => document.getElementById('status').textContent.includes('Plucked strings') && !document.getElementById('status').textContent.includes('· 24 s'))
    await page.locator('#stream').click(); const stopped = await text('status'); await page.waitForTimeout(150); assert.equal(await text('status'), stopped)
    assert.equal(await page.locator('#play').isDisabled(), true)
    // Decode a real mono WAV at a different rate; UI limits follow the decoded buffer.
    const bytes = Buffer.alloc(44 + 8000 * 2); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(16000, 40)
    for (let i = 0; i < 8000; i++) bytes.writeInt16LE(Math.sin(i * Math.PI / 4) * 16000, 44 + i * 2)
    await page.locator('#file').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: bytes }); await wait('tone.wav')
    assert.equal(await page.locator('#stream').isDisabled(), true)
    assert.equal(await page.locator('#play').isEnabled(), true)
    const rate = +(await text('status')).match(/([\d.]+) kHz/)[1] * 1000
    assert.equal(+(await page.locator('#high').inputValue()), rate / 2)
    await page.locator('#file').setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('not audio') })
    await page.waitForFunction(() => !document.getElementById('error').hidden); assert.match(await text('status'), /tone.wav/)
    await page.locator('#settings').click(); await page.locator('[type=reset]').click(); await wait('Plucked strings')
    assert.equal(await page.locator('#stream').isEnabled(), true); assert.equal(await page.locator('#error').isHidden(), true)
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 850 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.locator('#settings').click(); await page.locator('#settings').click()
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
