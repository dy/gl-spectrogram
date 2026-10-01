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
      else if (source === 'ensemble') {
        // A repeating four-bar phrase: plucked harmonics, bass, kick and brushed hats.
        const beat = t * 2, tick = Math.floor(beat * 2), age = (beat * 2 % 1) / 4
        const chords = [[48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59]]
        const chord = chords[Math.floor(beat / 4) % 4], midi = chord[[0, 2, 1, 3, 2, 1, 3, 1][tick % 8]] + 12
        const f = 440 * 2 ** ((midi - 69) / 12)
        for (let h = 1; h <= 8; h++) if (f * h < rate / 2) data[i] += .32 / h * Math.exp(-age * (5 + h * 3)) * Math.sin(2 * Math.PI * f * h * age)
        const bass = 440 * 2 ** ((chord[0] - 69) / 12), b = (beat % 2) / 2
        data[i] += .22 * Math.exp(-b * 4) * Math.sin(2 * Math.PI * bass * b)
        const k = beat % 1 / 2
        data[i] += .28 * Math.exp(-k * 30) * Math.sin(2 * Math.PI * (48 * k + 2 * (1 - Math.exp(-k * 35))))
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
        data[i] += seed / 2 ** 31 * .1 * Math.exp(-age * 90)
        data[i] *= Math.min(1, age * 1200)
      } else if (source === 'birds') {
        const phrase = Math.floor(t / 2.4), u = t % 2.4, call = u % .32
        const f = (1800 + 450 * Math.sin(phrase * 2.3)) + 3000 * (call / .32) ** 2 + 300 * Math.sin(u * 75)
        phase += Math.PI * 2 * f / rate
        const env = u < 1.5 && call < .22 ? Math.sin(Math.PI * call / .22) ** 2 : 0
        data[i] = .3 * env * (Math.sin(phase) + .2 * Math.sin(phase * 2))
      } else if (source === 'sweep') { phase += Math.PI * 2 * 30 * (rate / 2 / 30) ** ((t % 6) / 6) / rate; data[i] = Math.sin(phase) * .6 }
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
