import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
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

/** How long each verb stays before the next one rolls in. */
export const SWAP_MS = 3200

/**
 * "Welcome back" over one headline picked for the visit. It types in once when the page opens; the full line is laid
 * out invisibly underneath, so the typing never moves the composer below it.
 *
 * With `swap`, the headline is "What should we <verb> today?": after typing in, its verb keeps rolling to the next
 * one, pausing while `swap.paused()` is true (e.g. while the user is writing).
 */
export function Greeting(props: { swap?: { paused: () => boolean } }) {
  const language = useLanguage()
  const prompt = greetingPrompt(Math.random())
  const verbs = () => language.t("secondBrain.newThread.slot.verbs").split("|")
  const before = () => language.t("secondBrain.newThread.slot.before")
  const after = () => language.t("secondBrain.newThread.slot.after")
  const text = () =>
    props.swap
      ? `${before()} ${verbs()[0]} ${after()}`
      : language.t(`secondBrain.newThread.prompt.${prompt}` as "secondBrain.newThread.prompt.1")
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
        <Show
          when={props.swap && !reduced && count() >= text().length ? props.swap : undefined}
          fallback={
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
          }
        >
          {(swap) => <VerbSwap before={before()} after={after()} verbs={verbs()} paused={swap().paused} />}
        </Show>
      </div>
    </div>
  )
}

/**
 * The typed line with its verb in a window that rolls up to the next verb every SWAP_MS. The stack ends with a copy
 * of the first verb, so the loop always rolls forward: on reaching the copy it snaps back to the first without a
 * transition. The window's width follows the current verb.
 */
function VerbSwap(props: { before: string; after: string; verbs: string[]; paused: () => boolean }) {
  const stack = () => [...props.verbs, props.verbs[0]]
  const [index, setIndex] = createSignal(0)
  const [snap, setSnap] = createSignal(false)
  const [width, setWidth] = createSignal<number>()
  const spans: HTMLSpanElement[] = []
  const measure = () => setWidth(spans[index()]?.offsetWidth)
  onMount(measure)
  createEffect(() => {
    if (props.paused()) return
    const timer = setInterval(() => {
      setSnap(false)
      setIndex((value) => value + 1)
      measure()
    }, SWAP_MS)
    onCleanup(() => clearInterval(timer))
  })
  const settle = () => {
    if (index() < props.verbs.length) return
    setSnap(true)
    setIndex(0)
  }

  return (
    <h1 class="greeting-line" aria-label={`${props.before} ${stack()[index()]} ${props.after}`}>
      <span aria-hidden="true">{props.before}</span>{" "}
      <span aria-hidden="true" class="greeting-slot-window" style={{ width: width() ? `${width()}px` : undefined }}>
        <span
          class="greeting-slot-stack"
          classList={{ "greeting-slot-snap": snap() }}
          style={{ transform: `translateY(${-index() * 1.3}em)` }}
          onTransitionEnd={settle}
        >
          <For each={stack()}>{(word, at) => <span ref={(element) => (spans[at()] = element)}>{word}</span>}</For>
        </span>
      </span>{" "}
      <span aria-hidden="true">{props.after}</span>
    </h1>
  )
}
