/** How much of a bar's height is kept each reading as it falls, so the wave settles instead of flickering. */
const FALL = 0.85

/**
 * The wave's bar heights (0–1) for one reading (#328): the engine's frequency bands spread over `count` bars, each
 * rising at once to a louder band and falling back slowly. Without bands (an older engine) the level drives every bar.
 */
export function waveBars(
  bands: ReadonlyArray<number> | undefined,
  previous: ReadonlyArray<number>,
  count: number,
  level = 0,
) {
  return Array.from({ length: count }, (_, index) => {
    const target = bands && bands.length > 0 ? spread(bands, index, count) : level
    const was = previous[index] ?? 0
    const next = target >= was ? target : was * FALL + target * (1 - FALL)
    return Math.round(next * 1000) / 1000
  })
}

// The bands under bar `index`: their average when there are more bands than bars, else the one band it falls in.
function spread(bands: ReadonlyArray<number>, index: number, count: number) {
  const from = (index * bands.length) / count
  const to = ((index + 1) * bands.length) / count
  if (to - from < 1) return bands[Math.floor(from)] ?? 0
  const slice = bands.slice(Math.floor(from), Math.ceil(to))
  return slice.reduce((sum, value) => sum + value, 0) / slice.length
}

/** Readings below this are room noise and draw a flat bar (about -53 dB on the engine's 60 dB scale). */
const NOISE = 0.12
/** How much of the loudest recent reading is kept each frame, so the gain relaxes over a couple of seconds. */
const PEAK_FALL = 0.995
/** The gain never goes above this, so a quiet room isn't blown up into a busy wave. */
const MIN_PEAK = 0.35

/**
 * Speech into a laptop mic sits far below the engine's full scale (bands around 0.1–0.4), so drawn as-is the bars
 * barely leave the line. Each reading is drawn against the loudest recent one instead, above a noise floor: talking
 * fills the wave's height and silence stays flat. Returns the values to draw and the peak to carry to the next frame.
 */
export function voiceGain(readings: ReadonlyArray<number>, peak: number) {
  const loudest = readings.reduce((max, value) => Math.max(max, value), 0)
  const next = Math.max(loudest, peak * PEAK_FALL, MIN_PEAK)
  return {
    values: readings.map((value) => Math.min(1, Math.max(0, (value - NOISE) / (next - NOISE)))),
    peak: next,
  }
}

/** An older engine's loudness (RMS, 0–1) on the bands' 60 dB scale, so the same gain applies to it. */
export function levelReading(rms: number) {
  if (!(rms > 0)) return 0
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 60) / 60))
}
