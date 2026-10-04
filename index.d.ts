/** CSS color string (any syntax the browser parses, oklch included) or [r, g, b, a?] with channels 0..1 */
export type Color = string | ArrayLike<number>

export type Scale = 'log' | 'mel' | 'erb' | 'lin'
/** How a column draws its frames: the spectrum as it is, reassigned in time and frequency, squeezed in frequency, of a
 *  length by band, through several tapers, or as the Wigner–Ville distribution */
export type Method = 'frames' | 'reassigned' | 'synchrosqueezed' | 'bands' | 'tapers' | 'wigner'

export interface Options {
  /** Mono samples; replaces all data. A Float32Array is referenced, not copied; other array-likes are converted. */
  data?: ArrayLike<number> | null
  /** Hz. null: 44100. */
  sampleRate?: number | null
  /** Visible [from, to] in samples; fractional, may extend past the data. null: [0, length]. */
  range?: [number, number] | null
  /** Frequency axis: log (from 20 Hz), mel, erb or lin (from 0 Hz). null: log. */
  scale?: Scale | null
  /** How a column draws its frames. null: reassigned. */
  method?: Method | null
  /** Visible [low, high] in Hz, bottom to top. null: the scale's floor to Nyquist. */
  band?: [number, number] | null
  /** [x, y, width, height] in CSS px, top-left origin. null: the whole canvas. */
  viewport?: [number, number, number, number] | null
  /** Device px per CSS px. null: devicePixelRatio. */
  pixelRatio?: number | null
  /** [floor, top] in dB (0 dB: a full-scale sine). null: the top is the whole data's loudest cell, at least -60 dB. */
  levels?: [number, number] | null
  /** dB from the top to the floor with automatic levels. null: 80. */
  depth?: number | null
  /** Amplitude factor on the picture: power × gain². null: 1. */
  gain?: number | null
  /** FFT size, a power of two from 16 to 16384. null: fits the view (40 ms, more on a zoomed band, up to 4096). */
  size?: number | null
  /** One color: the loudest level's, drawn with the coverage that steps lightness evenly over `background`. Several:
   *  a colormap from the floor to the top. null: white. */
  color?: Color | Color[] | null
  /** What is under the canvas, where one color's ramp starts. null: black. */
  background?: Color | null
}

export interface Cell {
  /** Samples [from, to) of the column */
  from: number
  to: number
  /** Frequencies [low, high) of the row, Hz */
  low: number
  high: number
  /** dB, gain included; -Infinity for silence */
  level: number
}

export interface Column {
  /** Samples [from, to) of the column */
  from: number
  to: number
  /** dB per row, bottom to top, gain included */
  levels: Float32Array
}

export interface Axis {
  /** Lowest frequency of the whole axis, Hz */
  low: number
  /** Where f sits between lo and hi, 0..1 */
  at(f: number, lo: number, hi: number): number
  /** The frequency at u, 0..1 between lo and hi */
  of(u: number, lo: number, hi: number): number
}

/** The frequency axes rows are spaced on: log2, mel (2595 · log10(1 + f / 700)), linear */
export const scales: Record<Scale, Axis>

export default class Spectrogram {
  /** A canvas (its WebGL2 context is created or reused) or a WebGL2 context shared with other spectrograms or waveforms */
  constructor(target: HTMLCanvasElement | OffscreenCanvas | WebGL2RenderingContext, options?: Options)
  readonly gl: WebGL2RenderingContext
  readonly canvas: HTMLCanvasElement | OffscreenCanvas
  /** Number of samples */
  readonly length: number
  /** Resolved visible range */
  readonly range: [number, number]
  /** Resolved visible band, Hz */
  readonly band: [number, number]
  /** Resolved [floor, top], dB */
  readonly levels: [number, number]
  /** FFT size of the current view */
  readonly size: number | null
  /** The last render drew some columns from fewer frames than they will have: render again to draw them whole */
  readonly pending: boolean
  /** Change any option; undefined keeps, null restores the default */
  update(options: Options): this
  /** Append samples */
  push(samples: ArrayLike<number>): this
  /** Write samples at offset, extending the data if needed; a gap before offset reads as silence */
  set(samples: ArrayLike<number>, offset?: number): this
  /** Draw into the viewport, over what is there */
  render(): this
  /** Clear the viewport to transparent */
  clear(): this
  /** The cell at x, y CSS px from the viewport's top-left; null off the data */
  pick(x: number, y: number): Cell | null
  /** The column at x CSS px from the viewport's left; null off the data */
  pick(x: number): Column | null
  /** Release the GPU textures, the data and the event listeners */
  destroy(): void
}
