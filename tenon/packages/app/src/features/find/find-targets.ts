export type FindTargetInfo = {
  id: string
  layer: number
  contains: (node: unknown) => boolean
  enabled?: () => boolean
}

export function pickFindTarget<T extends FindTargetInfo>(targets: ReadonlyArray<T>, focused: unknown): T | undefined {
  const usable = targets
    .map((target, order) => ({ target, order }))
    .filter(({ target }) => target.enabled?.() !== false)
  const best = (list: typeof usable) =>
    list.reduce<(typeof usable)[number] | undefined>(
      (chosen, item) =>
        !chosen ||
        item.target.layer > chosen.target.layer ||
        (item.target.layer === chosen.target.layer && item.order > chosen.order)
          ? item
          : chosen,
      undefined,
    )?.target
  const holding =
    focused === undefined || focused === null ? [] : usable.filter(({ target }) => target.contains(focused))
  return best(holding) ?? best(usable)
}
