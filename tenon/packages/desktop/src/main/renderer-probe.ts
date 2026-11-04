/** Whether `probe` settles successfully within `ms`. A renderer stuck in a real hang never answers it. */
export function answersWithin(probe: () => Promise<unknown>, ms: number) {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    const finish = (answered: boolean) => {
      clearTimeout(timer)
      resolve(answered)
    }
    probe().then(
      () => finish(true),
      () => finish(false),
    )
  })
}
