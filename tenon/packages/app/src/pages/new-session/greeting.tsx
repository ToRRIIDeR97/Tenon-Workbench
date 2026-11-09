import { Show, createSignal, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"
import "./greeting.css"

// Local, single-user app for now; replace with the signed-in profile name when there is one.
const userName = "Nat"
const PROMPTS = 5
/** How long the headline takes to type in, whatever its length. */
export const TYPE_MS = 750

/** The prompt a visit shows (1 to PROMPTS), from a number in [0, 1) such as `Math.random()`. */
export function greetingPrompt(random: number) {
  return Math.min(PROMPTS, Math.floor(random * PROMPTS) + 1)
}

/** How many characters of a `length`-long line show `elapsed` ms into the type-in. */
export function typedCount(elapsed: number, length: number) {
  return Math.min(length, Math.max(0, Math.ceil((elapsed / TYPE_MS) * length)))
}

/**
 * "Welcome back" over one headline picked for the visit. It types in once when the page opens, then stays put.
 * The full line is laid out invisibly underneath, so the typing never moves the composer below it.
 */
export function Greeting() {
  const language = useLanguage()
  const prompt = greetingPrompt(Math.random())
  const text = () => language.t(`secondBrain.newThread.prompt.${prompt}` as "secondBrain.newThread.prompt.1")
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  const [elapsed, setElapsed] = createSignal(reduced ? TYPE_MS : 0)
  if (!reduced) {
    let start: number | undefined
    const tick = (now: number) => {
      start ??= now
      setElapsed(now - start)
      if (now - start < TYPE_MS) frame = requestAnimationFrame(tick)
    }
    let frame = requestAnimationFrame(tick)
    onCleanup(() => cancelAnimationFrame(frame))
  }
  const count = () => typedCount(elapsed(), text().length)

  return (
    <div data-component="new-thread-greeting" class="flex flex-col items-center gap-[clamp(2px,0.6vh,8px)] text-center">
      <p class="new-thread-welcome text-[clamp(13px,0.25cqw+11px,16px)] text-v2-text-text-muted">
        {language.t("secondBrain.newThread.welcome", { name: userName })}
      </p>
      <div class="relative h-[1.3em] w-full text-[clamp(24px,2.2cqw+10px,44px)] leading-[1.3] tracking-[-0.018em] text-v2-text-text-base [font-weight:500]">
        <h1 class="greeting-line" aria-label={text()}>
          <span aria-hidden="true" class="greeting-type">
            <span class="greeting-type-full">{text()}</span>
            <span class="greeting-type-shown">
              {text().slice(0, count())}
              <Show when={count() < text().length}>
                <span class="greeting-caret" />
              </Show>
            </span>
          </span>
        </h1>
      </div>
    </div>
  )
}
