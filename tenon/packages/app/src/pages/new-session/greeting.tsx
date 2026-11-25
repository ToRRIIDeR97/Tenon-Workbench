import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { useLanguage } from "@/context/language"
import "./greeting.css"

const userName = "Nat"
const PROMPTS = 5
export const TYPE_MS = 750

export function greetingPrompt(random: number) {
  return Math.min(PROMPTS, Math.floor(random * PROMPTS) + 1)
}

export function typedCount(elapsed: number, length: number) {
  return Math.min(length, Math.max(0, Math.ceil((elapsed / TYPE_MS) * length)))
}

export const SWAP_MS = 3200

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
