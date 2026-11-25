const FALL = 0.85

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

function spread(bands: ReadonlyArray<number>, index: number, count: number) {
  const from = (index * bands.length) / count
  const to = ((index + 1) * bands.length) / count
  if (to - from < 1) return bands[Math.floor(from)] ?? 0
  const slice = bands.slice(Math.floor(from), Math.ceil(to))
  return slice.reduce((sum, value) => sum + value, 0) / slice.length
}

const NOISE = 0.12
const PEAK_FALL = 0.995
const MIN_PEAK = 0.35

export function voiceGain(readings: ReadonlyArray<number>, peak: number) {
  const loudest = readings.reduce((max, value) => Math.max(max, value), 0)
  const next = Math.max(loudest, peak * PEAK_FALL, MIN_PEAK)
  return {
    values: readings.map((value) => Math.min(1, Math.max(0, (value - NOISE) / (next - NOISE)))),
    peak: next,
  }
}

export function levelReading(rms: number) {
  if (!(rms > 0)) return 0
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 60) / 60))
}
