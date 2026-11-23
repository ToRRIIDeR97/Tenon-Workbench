import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { motionDuration, prefersReducedMotion } from "@tenon/ui/v2/motion"
import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
  type JSX,
} from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { getRelativeTime } from "@/utils/time"
import type {
  MilestoneRoad as Road,
  ProjectNumbers as Numbers,
  RoadStop,
  StoryDay,
  StoryEntry,
} from "./project-home-model"

/**
 * The Project page's own parts (#project-home): the cover band and the Project's tile, the milestone road under the
 * title, the numbers row, Story (threads and log on one spine), and the section index beside the column.
 */

// Interlocking tenon joints in the muted border colour, faded to the right. The mask's white is luminance, not a
// visible colour: it sets how much of the pattern shows, so it stays a literal rather than a theme token.
export function ProjectCover() {
  const id = createUniqueId()
  return (
    <div
      aria-hidden="true"
      data-project-cover
      class="relative h-[132px] overflow-hidden rounded-[20px] bg-v2-background-bg-layer-01 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)] animate-enter"
    >
      <svg class="absolute inset-0 size-full">
        <defs>
          <pattern id={`${id}-joint`} width="56" height="56" patternUnits="userSpaceOnUse">
            <path
              d="M0 28h18v-10h20v10h18M28 0v10M28 46v10"
              fill="none"
              stroke="var(--v2-border-border-muted)"
              stroke-width="1.5"
            />
          </pattern>
          <linearGradient id={`${id}-fade`} x1="0" x2="1">
            <stop offset="0" stop-color="white" stop-opacity="0.9" />
            <stop offset="1" stop-color="white" stop-opacity="0.15" />
          </linearGradient>
          <mask id={`${id}-mask`}>
            <rect width="100%" height="100%" fill={`url(#${id}-fade)`} />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id}-joint)`} mask={`url(#${id}-mask)`} />
      </svg>
    </div>
  )
}

/** The Project's tile: its first letter on the accent container, ringed in the page colour where it meets the cover. */
export function ProjectTile(props: { name: string }) {
  return (
    <span
      aria-hidden="true"
      class="relative flex size-16 items-center justify-center rounded-[18px] bg-v2-background-bg-accent-container type-display text-v2-text-text-on-accent-container shadow-[0_0_0_4px_var(--v2-background-bg-base)]"
    >
      <Show when={Array.from(props.name.trim())[0]} fallback={<Icon name="folder" size="large" />}>
        {(letter) => letter().toUpperCase()}
      </Show>
    </span>
  )
}

/**
 * The fill waits two frames after mount, so its empty start is painted before it moves to the fill and the
 * transition draws it in (at once under reduced motion).
 */
function useDrawn() {
  const [drawn, setDrawn] = createSignal(false)
  onMount(() => {
    if (prefersReducedMotion()) {
      setDrawn(true)
      return
    }
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => setDrawn(true))))
    onCleanup(() => cancelAnimationFrame(frame))
  })
  return drawn
}

/**
 * Milestones as stops along a road: done ones filled, the current one ringed (`aria-current="step"`), the rest
 * hollow, with the accent fill through finished milestones and on toward the current one. The first and last stops
 * and the current one always keep their labels; the others show once the road is 480px wide (and, past five
 * milestones, only next to the current one). Hidden labels stay readable to screen readers, and every stop says
 * whether it is done, current or ahead.
 */
export function MilestoneRoad(props: { road: Road; dateLabel: (value: string) => string; onAdd: () => void }) {
  const language = useLanguage()
  return (
    <Show
      when={props.road.stops.length > 0}
      fallback={
        <div data-project-road="empty" class="relative mx-1.5 mt-2 h-[76px]">
          <span class="absolute inset-x-0 top-4 border-t-2 border-dashed border-v2-border-border-base" />
          <For each={[0, 50, 100]}>
            {(left) => (
              <span
                class="absolute top-[11px] size-3 -translate-x-1/2 rounded-full bg-v2-background-bg-base shadow-[inset_0_0_0_2px_var(--v2-border-border-base)]"
                style={{ left: `${left}%` }}
              />
            )}
          </For>
          <div class="absolute left-0 top-9 flex flex-wrap items-center gap-2">
            <span class="type-meta text-v2-text-text-muted">{language.t("secondBrain.project.road.empty")}</span>
            <ButtonV2 size="small" variant="outline" icon="plus" onClick={() => props.onAdd()}>
              {language.t("secondBrain.project.road.add")}
            </ButtonV2>
          </div>
        </div>
      }
    >
      <RoadTrack road={props.road} dateLabel={props.dateLabel} />
    </Show>
  )
}

// Its own component so the fill draws in whenever the road appears, including when the first milestone is added.
function RoadTrack(props: { road: Road; dateLabel: (value: string) => string }) {
  const language = useLanguage()
  const drawn = useDrawn()
  // The road's width decides which labels fit, in one place for both what shows and how wide each label is.
  const [width, setWidth] = createSignal(0)
  let track: HTMLDivElement | undefined
  onMount(() => {
    if (!track || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((records) => setWidth(records[0]?.contentRect.width ?? 0))
    observer.observe(track)
    onCleanup(() => observer.disconnect())
  })
  const count = () => props.road.stops.length
  const currentIndex = () => props.road.stops.findIndex((stop) => stop.state === "current")
  const label = (index: number) => {
    const current = currentIndex()
    if (index === 0 || index === count() - 1 || index === current) return "always"
    if (width() >= 480 && (count() <= 5 || (current >= 0 && Math.abs(index - current) <= 1))) return "shown"
    return "hidden"
  }
  const caption = (stop: RoadStop) => {
    const date = stop.date ? props.dateLabel(stop.date) : ""
    // No completion date is stored, so a done stop's date is marked as the planned one.
    if (stop.state === "done")
      return date
        ? language.t("secondBrain.project.road.donePlanned", { date })
        : language.t("secondBrain.project.road.done")
    if (stop.state === "current" && date) return language.t("secondBrain.project.road.due", { date })
    return date
  }
  // Each label gets two thirds of the gap to its nearest labelled neighbour (at most 180px; a hidden label lends
  // its room) and is centred on its stop, clamped inside the road, so neighbours never overlap and the last label
  // never runs past the column.
  const place = (index: number): JSX.CSSProperties => {
    const positions = props.road.positions
    const position = (positions[index] ?? 0) * 100
    const shown = positions.flatMap((at, other) => (other !== index && label(other) !== "hidden" ? [at] : []))
    const gap = Math.min(positions[index] ?? 1, ...shown.map((at) => Math.abs(at - (positions[index] ?? 0))))
    const width = `min(180px, ${66 * gap}%)`
    return {
      width,
      left: `clamp(0px, calc(${position}% - ${width} / 2), calc(100% - ${width}))`,
      "text-align": position === 100 ? "right" : "center",
    }
  }
  return (
    <div ref={(element) => (track = element)} data-project-road class="relative mx-2 mt-2 h-[76px]">
      <span aria-hidden="true" class="absolute inset-x-0 top-4 h-0.5 rounded-full bg-v2-background-bg-layer-03" />
      <span
        aria-hidden="true"
        data-project-road-fill
        class="absolute inset-x-0 top-4 h-0.5 origin-left rounded-full bg-v2-background-bg-accent transition-transform duration-long ease-emphasized-decelerate motion-reduce:transition-none"
        style={{ transform: `scaleX(${drawn() ? props.road.fill : 0})` }}
      />
      <span
        aria-hidden="true"
        class="absolute left-0 top-[13px] size-2 -translate-x-1/2 rounded-full bg-v2-background-bg-accent"
      />
      <ol aria-label={language.t("secondBrain.project.road.label")} class="absolute inset-0">
        <For each={props.road.stops}>
          {(stop, index) => (
            <li data-road-stop={stop.state} aria-current={stop.state === "current" ? "step" : undefined}>
              <span
                aria-hidden="true"
                classList={{
                  "absolute -translate-x-1/2 rounded-full transition-colors duration-short ease-standard motion-reduce:transition-none": true,
                  "top-[11px] size-3 bg-v2-background-bg-accent": stop.state === "done",
                  "top-[9px] size-4 bg-v2-background-bg-base shadow-[inset_0_0_0_3px_var(--v2-background-bg-accent)]":
                    stop.state === "current",
                  "top-[11px] size-3 bg-v2-background-bg-base shadow-[inset_0_0_0_2px_var(--v2-border-border-strong)]":
                    stop.state === "ahead",
                }}
                style={{ left: `${(props.road.positions[index()] ?? 0) * 100}%` }}
              />
              <span
                classList={{
                  "absolute top-[34px] flex flex-col": label(index()) !== "hidden",
                  "sr-only": label(index()) === "hidden",
                }}
                style={label(index()) === "hidden" ? undefined : place(index())}
                title={stop.title}
              >
                <span
                  classList={{
                    "truncate type-meta": true,
                    "text-v2-text-text-muted": stop.state === "done",
                    "text-v2-text-text-base": stop.state !== "done",
                    "[font-weight:600]": stop.state === "current",
                  }}
                >
                  {stop.title}
                </span>
                <span class="truncate type-caption tabular-nums text-v2-text-text-muted">{caption(stop)}</span>
                {/* The dots are colour alone, so each stop's state is also spoken (a done stop's caption already
                    says it). */}
                <Show when={stop.state !== "done"}>
                  <span class="sr-only">
                    {stop.state === "current"
                      ? language.t("secondBrain.project.road.current", { done: stop.done, total: stop.total })
                      : language.t("secondBrain.project.road.ahead")}
                  </span>
                </Show>
              </span>
            </li>
          )}
        </For>
      </ol>
    </div>
  )
}

/**
 * A number that counts from its last value to the next over the long duration (at once under reduced motion). The
 * one place the page animates text rather than transform or opacity; docs/design.md notes the exception.
 */
function CountUp(props: { value: number }) {
  const [shown, setShown] = createSignal(0)
  let frame = 0
  createEffect(
    on(
      () => props.value,
      (to) => {
        cancelAnimationFrame(frame)
        const from = untrack(shown)
        if (prefersReducedMotion() || from === to) {
          setShown(to)
          return
        }
        const start = performance.now()
        const duration = motionDuration("long")
        const step = (now: number) => {
          const progress = Math.min(1, (now - start) / duration)
          setShown(Math.round(from + (to - from) * (1 - Math.pow(1 - progress, 3))))
          if (progress < 1) frame = requestAnimationFrame(step)
        }
        frame = requestAnimationFrame(step)
      },
    ),
  )
  onCleanup(() => cancelAnimationFrame(frame))
  return (
    <>
      <span aria-hidden="true" data-count-shown>
        {shown()}
      </span>
      <span class="sr-only" data-count-value>
        {props.value}
      </span>
    </>
  )
}

/**
 * Four numbers in one card: open and done tasks, agents working (breathing while any are) and pages. Until the
 * timeline has loaded (or when it failed) the task cells show a dash, not a misleading zero.
 */
export function ProjectNumbers(props: { numbers: Numbers; tasksKnown: boolean }) {
  const language = useLanguage()
  const cells = () => [
    { key: "open", value: props.numbers.open, label: language.t("secondBrain.project.numbers.open") },
    { key: "done", value: props.numbers.done, label: language.t("secondBrain.project.numbers.done") },
    { key: "running", value: props.numbers.running, label: language.t("secondBrain.project.numbers.running") },
    { key: "pages", value: props.numbers.pages, label: language.t("secondBrain.project.numbers.pages") },
  ]
  return (
    <div role="group" aria-label={language.t("secondBrain.project.numbers.label")} class="@container">
      <dl
        data-project-numbers
        class="grid grid-cols-2 rounded-[16px] bg-v2-background-bg-layer-01 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)] @min-[480px]:grid-cols-4"
      >
        <For each={cells()}>
          {(cell, index) => (
            <div
              data-project-number={cell.key}
              // Hairlines between cells: one row of four when wide, two rows of two when narrow.
              classList={{
                "flex min-w-0 flex-col-reverse gap-0.5 border-v2-border-border-muted px-4 py-3": true,
                "border-l": index() % 2 === 1,
                "border-t @min-[480px]:border-t-0": index() >= 2,
                "@min-[480px]:border-l": index() === 2,
              }}
            >
              <dt class="truncate type-caption text-v2-text-text-muted">{cell.label}</dt>
              <dd class="flex items-center gap-2 type-display tabular-nums text-v2-text-text-base">
                <Show
                  when={props.tasksKnown || (cell.key !== "open" && cell.key !== "done")}
                  fallback={
                    <>
                      <span aria-hidden="true">–</span>
                      <span class="sr-only">{language.t("secondBrain.project.numbers.unknown")}</span>
                    </>
                  }
                >
                  <CountUp value={cell.value} />
                </Show>
                <Show when={cell.key === "running" && cell.value > 0}>
                  <span aria-hidden="true" class="size-2 rounded-full bg-v2-icon-icon-accent running-pulse" />
                </Show>
              </dd>
            </div>
          )}
        </For>
      </dl>
    </div>
  )
}

/** A small count beside a section title. */
export function SectionCount(props: { children: JSX.Element }) {
  return (
    <span class="inline-flex h-5 items-center rounded-full bg-v2-background-bg-layer-02 px-2 type-caption tabular-nums text-v2-text-text-muted">
      {props.children}
    </span>
  )
}

const STORY_PREVIEW = 12

/**
 * Threads and the Project log on one spine, newest first: the milestone ahead at the top, then each day as its own
 * list under a heading. Running threads lead today with a breathing dot. Long stories show the newest twelve entries
 * first. Days and entries are reconciled by key, so an update (a thread starting or finishing) changes only what
 * changed, and only entries that arrive after the page opened slide in. Threads show while the log loads or fails;
 * the log's state is one line at the end.
 */
export function ProjectStory(props: {
  /** The Project this Story belongs to; the page remounts Story when it changes. */
  projectId: string
  days: ReadonlyArray<StoryDay>
  next?: RoadStop
  log: "loading" | "failed" | "ready"
  onRetryLog: () => void
  /** The page's clock, so stopped threads' "n minutes ago" moves on. */
  now: number
  threadHref: (id: string) => string
  dateLabel: (value: string) => string
}) {
  const language = useLanguage()
  // An entry slides in only if it is new to this page and newer than the page itself: a log entry or a thread
  // update stamped after the page opened. Threads or a log that load late (or after a retry) are the page as it
  // opened, and Show older reveals known keys, so neither slides in. Rows read `fresh` once, when created, and
  // clear it, so a row that re-renders later doesn't replay.
  // Exact, not the minute clock's last tick, so entries from the minute before opening don't count as new.
  const opened = Date.now()
  const known = new Set<string>()
  const fresh = new Set<string>()
  const learn = (days: ReadonlyArray<StoryDay>) => {
    for (const entry of days.flatMap((day) => day.entries)) {
      const since = entry.kind === "thread" ? entry.updated : entry.at
      if (!known.has(entry.key) && since > opened) fresh.add(entry.key)
      known.add(entry.key)
    }
  }
  learn(props.days)
  const [view, setView] = createStore({ all: false, days: structuredClone<StoryDay[]>([...props.days]) })
  createEffect(
    on(
      () => [props.days, props.log] as const,
      ([days]) => {
        learn(days)
        setView("days", reconcile(structuredClone<StoryDay[]>([...days]), { key: "key" }))
      },
      { defer: true },
    ),
  )
  const total = () => view.days.reduce((sum, day) => sum + day.entries.length, 0)
  // How many of a day's entries fit in the preview, after the days above it.
  const room = (index: number) => {
    if (view.all) return Infinity
    const before = view.days.slice(0, index).reduce((sum, day) => sum + day.entries.length, 0)
    return Math.max(0, STORY_PREVIEW - before)
  }
  const dayLabel = (day: StoryDay) => {
    if (day.daysAgo === 0) return language.t("secondBrain.project.story.today")
    if (day.daysAgo === 1) return language.t("secondBrain.project.story.yesterday")
    const [year = 0, month = 1, date = 1] = day.day.split("-").map(Number)
    const calendar = new Date(year, month - 1, date)
    return calendar.toLocaleDateString(language.intl(), {
      day: "numeric",
      month: "short",
      ...(calendar.getFullYear() === new Date(props.now).getFullYear() ? {} : { year: "numeric" }),
    })
  }
  const time = (at: number) => new Date(at).toLocaleTimeString(language.intl(), { hour: "2-digit", minute: "2-digit" })
  const node = "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full"
  // Reads the page's clock so a stopped thread's "n minutes ago" moves on with it.
  const ago = (at: number) => {
    void props.now
    return getRelativeTime(new Date(at).toISOString(), language.t)
  }
  const entry = (item: StoryEntry) => {
    const enter = fresh.delete(item.key)
    if (item.kind === "log")
      return (
        <li
          data-story-entry="log"
          data-entering={enter ? "" : undefined}
          classList={{ "flex gap-3 pb-4": true, "animate-enter": enter }}
        >
          <span class={`${node} bg-v2-background-bg-layer-02 shadow-[0_0_0_4px_var(--v2-background-bg-base)]`}>
            <Icon name="edit" size="small" class="text-v2-icon-icon-muted" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col pt-1">
            <span class="break-words type-meta text-v2-text-text-base">{item.text}</span>
            <span class="type-caption text-v2-text-text-muted">
              {item.dateOnly
                ? language.t("secondBrain.project.story.logDay", { author: item.author })
                : language.t("secondBrain.project.story.log", { author: item.author, time: time(item.at) })}
            </span>
          </span>
        </li>
      )
    return (
      <li
        data-story-entry="thread"
        data-entering={enter ? "" : undefined}
        classList={{ "pb-4": true, "animate-enter": enter }}
      >
        <a
          href={props.threadHref(item.id)}
          class="-mx-1.5 flex gap-3 rounded-[10px] px-1.5 py-0.5 transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
        >
          <span class={`${node} bg-v2-background-bg-layer-02 shadow-[0_0_0_4px_var(--v2-background-bg-base)]`}>
            <Icon name="terminal" size="small" class="text-v2-icon-icon-base" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col pt-1">
            <span classList={{ "truncate type-meta text-v2-text-text-base": true, "[font-weight:600]": item.running }}>
              {item.title}
            </span>
            <span class="type-caption text-v2-text-text-muted">
              {item.running
                ? language.t("secondBrain.project.story.working")
                : language.t("secondBrain.project.story.thread", {
                    time: ago(item.at),
                  })}
            </span>
          </span>
          <Show when={item.running}>
            <span
              aria-hidden="true"
              class="mt-2.5 size-1.5 shrink-0 rounded-full bg-v2-icon-icon-accent running-pulse"
            />
          </Show>
        </a>
      </li>
    )
  }
  return (
    <div data-story-project={props.projectId} class="flex flex-col gap-1">
      <Show
        when={view.days.length > 0 || props.next}
        fallback={
          <Show when={props.log === "ready"}>
            <p class="type-meta text-v2-text-text-muted">{language.t("secondBrain.project.storyEmpty")}</p>
          </Show>
        }
      >
        <div class="relative" data-project-story>
          <span aria-hidden="true" class="absolute bottom-4 left-[13px] top-2 w-0.5 bg-v2-border-border-muted" />
          <Show when={props.next}>
            {(next) => (
              <div data-story-entry="milestone" class="relative flex gap-3 pb-4">
                <span
                  aria-hidden="true"
                  class={`${node} bg-v2-background-bg-base type-caption text-v2-icon-icon-accent shadow-[inset_0_0_0_1.5px_var(--v2-border-border-strong)]`}
                >
                  ◆
                </span>
                <span class="flex min-w-0 flex-1 flex-col pt-1">
                  <span class="truncate type-meta text-v2-text-text-muted">{next().title}</span>
                  <span class="type-caption text-v2-text-text-muted">
                    {next().date
                      ? language.t("secondBrain.project.story.aheadDue", {
                          date: props.dateLabel(next().date!),
                          done: next().done,
                          total: next().total,
                        })
                      : language.t("secondBrain.project.story.ahead", { done: next().done, total: next().total })}
                  </span>
                </span>
              </div>
            )}
          </Show>
          <ol class="relative flex flex-col">
            <For each={view.days}>
              {(day, index) => (
                <Show when={room(index()) > 0}>
                  <li data-story-day={day.day}>
                    <h3 class="relative z-10 -ml-1 pb-3 pt-1">
                      <span class="rounded-full bg-v2-background-bg-base px-1 type-caption text-v2-text-text-muted [font-weight:600]">
                        {dayLabel(day)}
                      </span>
                    </h3>
                    <ol class="flex flex-col">
                      <For each={day.entries.slice(0, room(index()))}>{(item) => entry(item)}</For>
                    </ol>
                  </li>
                </Show>
              )}
            </For>
          </ol>
        </div>
      </Show>
      <Show when={total() > STORY_PREVIEW}>
        <ButtonV2
          size="small"
          variant="ghost"
          class="ml-8 w-fit"
          onClick={() => {
            fresh.clear()
            setView("all", (value) => !value)
          }}
        >
          {view.all ? language.t("secondBrain.project.story.less") : language.t("secondBrain.project.story.older")}
        </ButtonV2>
      </Show>
      <Show when={props.log === "loading"}>
        <p class="pl-10 type-meta text-v2-text-text-muted">{language.t("secondBrain.project.story.logLoading")}</p>
      </Show>
      <Show when={props.log === "failed"}>
        <div role="alert" data-story-log-failed class="flex flex-wrap items-center gap-2 pl-10">
          <span class="type-meta text-v2-text-text-critical">{language.t("secondBrain.project.story.logFailed")}</span>
          <ButtonV2 size="small" variant="outline" onClick={() => props.onRetryLog()}>
            {language.t("secondBrain.state.retry")}
          </ButtonV2>
        </div>
      </Show>
    </div>
  )
}

/**
 * The column's section index: one pill per section that scrolls to it, the section in view held in the pressed
 * overlay. It sticks beside the column while the page scrolls. On each scroll (one read per frame) the current
 * section is the last whose top has passed a line 30% down the view, else the first. `endId` names an element after
 * the last section: once you've scrolled and it is in view, the last section is current, since a short last section
 * never reaches the line. On a page short enough to fit, nothing has scrolled, so the first section stays current.
 */
export function SectionIndex(props: {
  /** The Project whose page this indexes; the page remounts the index when it changes. */
  projectId: string
  sections: ReadonlyArray<{ id: string; label: string }>
  endId: string
  class?: string
}) {
  const language = useLanguage()
  const [active, setActive] = createSignal(props.sections[0]?.id ?? "")
  let nav: HTMLElement | undefined
  let held = 0
  let release: ReturnType<typeof setTimeout> | undefined
  let repick = () => {}
  onCleanup(() => clearTimeout(release))
  onMount(() => {
    let scrolled = false
    let frame = 0
    const pick = () => {
      frame = 0
      // A clicked section holds while its own smooth scroll runs.
      if (performance.now() < held || !scrolled) return
      const line = window.innerHeight * 0.3
      const end = document.getElementById(props.endId)?.getBoundingClientRect()
      if (scrolled && end && end.top <= window.innerHeight) {
        setActive(props.sections.at(-1)?.id ?? "")
        return
      }
      const passed = props.sections.filter(
        (section) =>
          (document.getElementById(`project-${section.id}`)?.getBoundingClientRect().top ?? Infinity) <= line,
      )
      setActive((passed.at(-1) ?? props.sections[0])?.id ?? "")
    }
    // Only the page's own scroller counts, not a list or grid scrolling inside it.
    repick = pick
    const onScroll = (event: Event) => {
      const target = event.target
      if (target !== document && !(target instanceof Element && nav?.isConnected && target.contains(nav))) return
      scrolled = true
      if (!frame) frame = requestAnimationFrame(pick)
    }
    document.addEventListener("scroll", onScroll, { capture: true, passive: true })
    onCleanup(() => {
      document.removeEventListener("scroll", onScroll, { capture: true })
      cancelAnimationFrame(frame)
    })
  })
  return (
    <nav
      ref={(element) => (nav = element)}
      data-project-index={props.projectId}
      aria-label={language.t("secondBrain.project.sections")}
      class={`flex-col gap-0.5 ${props.class ?? ""}`}
    >
      <For each={props.sections}>
        {(section) => (
          <a
            href={`#project-${section.id}`}
            aria-current={active() === section.id ? "location" : undefined}
            class="flex h-7 items-center rounded-full px-3 type-control text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base aria-[current]:bg-v2-overlay-simple-overlay-pressed aria-[current]:text-v2-text-text-base focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
            onClick={(event) => {
              event.preventDefault()
              setActive(section.id)
              const hold = prefersReducedMotion() ? 50 : motionDuration("long") * 3
              held = performance.now() + hold
              clearTimeout(release)
              release = setTimeout(() => repick(), hold + 50)
              scrollToSection(section.id)
            }}
          >
            {section.label}
          </a>
        )}
      </For>
    </nav>
  )
}

/** Scrolls a section of the Project page into view (at once under reduced motion). */
export function scrollToSection(id: string) {
  document
    .getElementById(`project-${id}`)
    ?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" })
}
