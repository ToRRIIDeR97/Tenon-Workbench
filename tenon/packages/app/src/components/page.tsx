import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { LoaderV2 } from "@tenon/ui/v2/loader-v2"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { children, Show, type JSX, type ParentProps } from "solid-js"

/** The rounded surface every page sits on, next to the nav rail and projects panel. */
export const pagePanelClass = "rounded-[24px] bg-v2-background-bg-base shadow-[0_0_0_1px_var(--v2-border-border-muted)]"

/**
 * Full-height page: one rounded panel that scrolls. `scroll={false}` keeps the panel fixed for pages whose
 * columns scroll on their own. Pages with their own layout use `pagePanelClass`.
 */
export function PageFrame(
  props: ParentProps<{ labelledBy?: string; label?: string; scroll?: boolean; class?: string }>,
) {
  return (
    <section
      class="flex size-full min-h-0 flex-col p-2 pl-0"
      aria-labelledby={props.labelledBy}
      aria-label={props.label}
    >
      <div
        class={`min-h-0 flex-1 ${props.scroll === false ? "flex flex-col overflow-hidden" : "overflow-y-auto"} ${pagePanelClass} ${props.class ?? ""}`}
      >
        {props.children}
      </div>
    </section>
  )
}

/** The page's content column: 720px for lists and forms, 1040px for overviews and notes. */
export const pageColumnClass = "mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 pt-6 pb-10 sm:px-10"
export const pageWideColumnClass = "mx-auto flex w-full max-w-[1040px] flex-col gap-6 px-6 pt-6 pb-10 sm:px-10"

/**
 * Page title with optional back button and trailing actions. Pages carry no subtitle: the title names the page.
 * `crumb` shows the title as a muted breadcrumb instead of the h1, for pages whose heading sits in the body.
 */
export function PageHeader(props: {
  id?: string
  title: string
  crumb?: boolean
  back?: { label: string; onClick: () => void }
  actions?: JSX.Element
}) {
  return (
    <header class="flex min-h-14 shrink-0 flex-wrap items-center gap-2 px-6 pt-3">
      <Show when={props.back}>
        {(back) => (
          <TooltipV2 value={back().label}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              class="-ml-2"
              aria-label={back().label}
              icon={<Icon name="arrow-left" />}
              onClick={() => back().onClick()}
            />
          </TooltipV2>
        )}
      </Show>
      <Show
        when={!props.crumb}
        fallback={
          <p id={props.id} class="min-w-0 flex-1 truncate type-control text-v2-text-text-muted">
            {props.title}
          </p>
        }
      >
        <h1 id={props.id} class="max-w-full min-w-0 flex-1 shrink-0 truncate type-page-title text-v2-text-text-base">
          {props.title}
        </h1>
      </Show>
      <Show when={props.actions}>
        <div class="flex flex-wrap items-center gap-1.5">{props.actions}</div>
      </Show>
    </header>
  )
}

/** A titled group of rows. A title with `onTitle` doubles as the link to the full view. */
export function PageSection(
  props: ParentProps<{ id?: string; title: string; onTitle?: () => void; actions?: JSX.Element; class?: string }>,
) {
  return (
    <section class={`flex flex-col gap-1 ${props.class ?? ""}`} aria-labelledby={props.id}>
      <div class="flex h-8 items-center gap-1 pl-3">
        <h2 id={props.id} class="flex min-w-0 flex-1 type-section text-v2-text-text-base">
          <Show when={props.onTitle} fallback={<span class="truncate">{props.title}</span>}>
            <button
              type="button"
              class="-ml-2 flex h-7 min-w-0 items-center gap-0.5 rounded-full pr-1 pl-2 text-left transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover active:bg-v2-overlay-simple-overlay-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
              onClick={() => props.onTitle?.()}
            >
              <span class="truncate">{props.title}</span>
              <Icon name="chevron-right" size="small" class="shrink-0 text-v2-icon-icon-muted" />
            </button>
          </Show>
        </h2>
        {props.actions}
      </div>
      {props.children}
    </section>
  )
}

/**
 * The one empty, loading and error block: centred near the top of the space the view would fill, with a title
 * (type-row-title, 600), a muted body (type-body) and at most one pill action. `loading` puts a spinner before the title; `error` marks it
 * as an alert and pairs with a plain-language body and an outline "Try again" action, never a raw error code.
 */
export function PageEmpty(
  props: ParentProps<{ title?: string; loading?: boolean; error?: boolean; action?: JSX.Element; class?: string }>,
) {
  const body = children(() => props.children)
  return (
    <div
      role={props.error ? "alert" : props.loading ? "status" : undefined}
      class={`flex flex-1 flex-col items-center px-6 pt-24 pb-16 text-center ${props.class ?? ""}`}
    >
      <Show when={props.title}>
        <div class="flex max-w-sm items-center gap-2">
          <Show when={props.loading}>
            <LoaderV2 class="shrink-0 text-v2-icon-icon-muted" />
          </Show>
          <p class="type-row-title text-v2-text-text-base [font-weight:600]">{props.title}</p>
        </div>
      </Show>
      <Show when={body()}>
        <p classList={{ "max-w-sm type-body text-v2-text-text-muted": true, "mt-1": !!props.title }}>{body()}</p>
      </Show>
      <Show when={props.action}>
        <div class="mt-4">{props.action}</div>
      </Show>
    </div>
  )
}

/** Shared list-row look: an 8px-radius row with hover, pressed and focus states. */
export const pageRowClass =
  "flex w-full min-w-0 items-center gap-3 rounded-[8px] px-3 py-2 text-left transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover active:bg-v2-overlay-simple-overlay-pressed focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
