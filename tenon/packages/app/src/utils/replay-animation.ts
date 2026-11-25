import { prefersReducedMotion } from "@tenon/ui/v2/motion"

export function replayAnimation(element: HTMLElement | undefined, className = "animate-enter") {
  if (!element || prefersReducedMotion()) return
  element.classList.remove(className)
  void element.offsetWidth
  element.classList.add(className)
}
