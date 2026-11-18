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
