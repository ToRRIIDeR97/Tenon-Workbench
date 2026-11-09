import { For, Match, Switch, createSignal, onCleanup, onMount } from "solid-js"
import { useLanguage } from "@/context/language"
import "./greeting.css"

// Local, single-user app for now; replace with the signed-in profile name when there is one.
const userName = "Nat"
const PROMPTS = 5
const STEP_MS = 6000
const STYLES = ["rise", "type", "blur", "slot"] as const

/**
 * The greeting at step `n`: the effects take turns (words rising, typing, a blur crossfade, a rolling verb) while
 * the prompts cycle on their own count, so the pairs keep changing.
 */
export function greetingStep(n: number) {
  return { style: STYLES[n % STYLES.length], prompt: (n % PROMPTS) + 1 }
}

/** "Welcome back" over a headline that changes every six seconds, each change with the next effect in turn. */
export function Greeting() {
  const language = useLanguage()
  const [step, setStep] = createSignal(Math.floor(Math.random() * PROMPTS) * STYLES.length)
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  const timer = setInterval(() => setStep((value) => value + 1), STEP_MS)
  onCleanup(() => clearInterval(timer))
  const current = () => greetingStep(step())
  const text = () => language.t(`secondBrain.newThread.prompt.${current().prompt}` as "secondBrain.newThread.prompt.1")
  const verbs = () => language.t("secondBrain.newThread.slot.verbs").split("|")
  // Reduced motion swaps plain lines; the rolling verb would only read as a prompt mid-roll, so it sits out.
  const style = () => (reduced ? "plain" : current().style)

  return (
    <div data-component="new-thread-greeting" class="flex flex-col items-center gap-[clamp(2px,0.6vh,8px)] text-center">
      <p class="new-thread-welcome text-[clamp(13px,0.25cqw+11px,16px)] text-v2-text-text-muted">
        {language.t("secondBrain.newThread.welcome", { name: userName })}
      </p>
      <div
        class="relative h-[1.3em] w-full text-[clamp(24px,2.2cqw+10px,44px)] leading-[1.3] tracking-[-0.018em] text-v2-text-text-base [font-weight:500]"
        aria-live="polite"
      >
        {/* Keyed on the step, so every change mounts a fresh line and its effect plays from the start. */}
        <For each={[step()]}>
          {() => (
            <Switch fallback={<h1 class="greeting-line">{text()}</h1>}>
              <Match when={style() === "rise"}>
                <h1 class="greeting-line" aria-label={text()}>
                  <For each={text().split(" ")}>
                    {(word, index) => (
                      <>
                        <span aria-hidden="true" class="greeting-word" style={{ "--delay": `${index() * 140}ms` }}>
                          {word}
                        </span>{" "}
                      </>
                    )}
                  </For>
                </h1>
              </Match>
              <Match when={style() === "type"}>
                <Typewriter text={text()} />
              </Match>
              <Match when={style() === "blur"}>
                <h1 class="greeting-line greeting-blur">{text()}</h1>
              </Match>
              <Match when={style() === "slot"}>
                <SlotRoll
                  before={language.t("secondBrain.newThread.slot.before")}
                  after={language.t("secondBrain.newThread.slot.after")}
                  verbs={verbs()}
                  start={step() % verbs().length}
                />
              </Match>
            </Switch>
          )}
        </For>
      </div>
    </div>
  )
}

/** Types the line out with a caret that blinks once the line is complete. */
function Typewriter(props: { text: string }) {
  const [count, setCount] = createSignal(0)
  const timer = setInterval(() => {
    if (count() >= props.text.length) return clearInterval(timer)
    setCount((value) => value + 1)
  }, 45)
  onCleanup(() => clearInterval(timer))
  return (
    <h1 class="greeting-line" aria-label={props.text}>
      <span aria-hidden="true">{props.text.slice(0, count())}</span>
      <span aria-hidden="true" class="greeting-caret" data-typing={count() < props.text.length ? "" : undefined} />
    </h1>
  )
}

/** A fixed frame whose verb rolls twice through the list; the slot's width follows the verb. */
function SlotRoll(props: { before: string; after: string; verbs: string[]; start: number }) {
  const words = () => [0, 1, 2].map((offset) => props.verbs[(props.start + offset) % props.verbs.length])
  const [index, setIndex] = createSignal(0)
  const [width, setWidth] = createSignal<number>()
  const spans: HTMLSpanElement[] = []
  const measure = () => setWidth(spans[index()]?.offsetWidth)
  onMount(() => {
    measure()
    const timers = [2200, 4200].map((delay, at) =>
      setTimeout(() => {
        setIndex(at + 1)
        measure()
      }, delay),
    )
    onCleanup(() => timers.forEach(clearTimeout))
  })
  return (
    <h1 class="greeting-line greeting-slot" aria-label={`${props.before} ${words()[index()]} ${props.after}`}>
      <span aria-hidden="true" class="text-v2-text-text-muted">
        {props.before}
      </span>{" "}
      <span aria-hidden="true" class="greeting-slot-window" style={{ width: width() ? `${width()}px` : undefined }}>
        <span class="greeting-slot-stack" style={{ transform: `translateY(${-index() * 1.3}em)` }}>
          <For each={words()}>{(word, at) => <span ref={(element) => (spans[at()] = element)}>{word}</span>}</For>
        </span>
      </span>{" "}
      <span aria-hidden="true" class="text-v2-text-text-muted">
        {props.after}
      </span>
    </h1>
  )
}
