import { createSignal, onCleanup, onMount, type Accessor } from "solid-js"

export type SlidingIndicatorOptions = {
  /** The positioned element the indicator is absolutely placed in. */
  container: () => HTMLElement | undefined
  /** The element the indicator covers, found inside the container. */
  target: (container: HTMLElement) => HTMLElement | null | undefined
  /** Prefix of the custom properties written on the container: `<prefix>-x`, `-y`, `-width`, `-height`. */
  property: string
  /** Attributes whose change can move the selection. */
  attributes: string[]
  /** Skips measuring for containers that keep a static highlight. */
  enabled?: (container: HTMLElement) => boolean
}

/**
 * One highlight that slides between the items of a group (tabs, segmented controls): the container measures
 * the selected item and writes its box as custom properties for CSS to place the indicator. Returns whether
 * the indicator is placed; until then, or while nothing is selected, the selected item draws its own fill.
 */
export function createSlidingIndicator(options: SlidingIndicatorOptions): Accessor<boolean> {
  const [placed, setPlaced] = createSignal(false)

  onMount(() => {
    const element = options.container()
    if (!element || (options.enabled && !options.enabled(element))) return
    if (typeof MutationObserver === "undefined" || typeof ResizeObserver === "undefined") return

    const measure = () => {
      const target = options.target(element)
      if (!target || target.offsetParent !== element) {
        setPlaced(false)
        return
      }
      element.style.setProperty(`${options.property}-x`, `${target.offsetLeft}px`)
      element.style.setProperty(`${options.property}-y`, `${target.offsetTop}px`)
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
