import voice from './voice.js'

export const palettes = {
  lagoon: ['#544e4c', '#376867', '#429b9c', '#89d3c8', '#edf4bc'],
  inferno: ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4'],
  viridis: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'],
  gray: ['#141414', '#fafafa']
}
export function generator(source, rate = 48000) {
  let pos = 0, phase = 0, seed = 1
  const fill = voice(1, rate)
  return n => {
    const data = new Float32Array(n)
    if (source === 'voice') { fill(data, 0, n); return data }
    for (let i = 0; i < n; i++, pos++) {
      const t = pos / rate
      if (source === 'noise') { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; data[i] = seed / 2 ** 31 * .2 }
      else if (source === 'sweep') { phase += Math.PI * 2 * 30 * (rate / 2 / 30) ** ((t % 6) / 6) / rate; data[i] = Math.sin(phase) * .6 }
      else if (source === 'clicks') data[i] = pos % Math.round(rate / 4) === 0 ? 1 : 0
      else if (source === 'chord') {
        const notes = Math.floor(t / 3) % 2 ? [220, 261.63, 329.63] : [261.63, 329.63, 392]
        for (const f of notes) for (let h = 1; h <= 8; h++) data[i] += .1 / h * Math.exp(-(t % 3) * (.4 + h * .2)) * Math.sin(Math.PI * 2 * f * h * t)
      } else {
        const f = [110, 146.83, 164.81, 130.81][Math.floor(t / 1.5) % 4] * (1 + .025 * Math.sin(t * 5))
        phase += Math.PI * 2 * f / rate
        const env = .25 + .75 * Math.sin(Math.PI * (t % .5) / .5) ** 2
        for (let h = 1; h <= 16; h++) data[i] += .3 / h * Math.sin(phase * h) * env
      }
    }
    return data
  }
}
