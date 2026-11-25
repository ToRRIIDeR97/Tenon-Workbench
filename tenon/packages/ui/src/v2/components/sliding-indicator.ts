import { createSignal, onCleanup, onMount, type Accessor } from "solid-js"

export type SlidingIndicatorOptions = {
  container: () => HTMLElement | undefined
  target: (container: HTMLElement) => HTMLElement | null | undefined
  property: string
  attributes: string[]
  enabled?: (container: HTMLElement) => boolean
}

export function createSlidingIndicator(options: SlidingIndicatorOptions): Accessor<boolean> {
  const [placed, setPlaced] = createSignal(false)

  onMount(() => {
    const element = options.container()
    if (!element || (options.enabled && !options.enabled(element))) return
    if (typeof MutationObserver === "undefined" || typeof ResizeObserver === "undefined") return

    const measure = () => {
      const target = options.target(element)
      let x = 0
      let y = 0
      let node: HTMLElement | null = target ?? null
      while (node && node !== element) {
        x += node.offsetLeft
        y += node.offsetTop
        node = node.offsetParent as HTMLElement | null
      }
      if (!target || node !== element) {
        setPlaced(false)
        return
      }
      element.style.setProperty(`${options.property}-x`, `${x}px`)
      element.style.setProperty(`${options.property}-y`, `${y}px`)
      element.style.setProperty(`${options.property}-width`, `${target.offsetWidth}px`)
      element.style.setProperty(`${options.property}-height`, `${target.offsetHeight}px`)
      setPlaced(true)
    }

    const mutations = new MutationObserver(measure)
    mutations.observe(element, {
      subtree: true,
      childList: true,
      characterData: true,
      attributeFilter: options.attributes,
    })
    const resize = new ResizeObserver(measure)
    resize.observe(element)
    measure()
    onCleanup(() => {
      mutations.disconnect()
      resize.disconnect()
    })
  })

  return placed
}
