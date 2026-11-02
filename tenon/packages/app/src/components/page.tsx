import { LoaderV2 } from "@tenon/ui/v2/loader-v2"
import { children, Show, type JSX, type ParentProps } from "solid-js"

/** The rounded surface every page sits on, next to the nav rail and projects panel. */
export const pagePanelClass =
  "rounded-[24px] bg-v2-background-bg-base shadow-[0_0_0_0.5px_var(--v2-border-border-muted)]"

/** Full-height page: one rounded panel that scrolls. Pages with their own layout use `pagePanelClass`. */
export function PageFrame(props: ParentProps<{ labelledBy?: string; class?: string }>) {
  return (
    <section class="flex size-full min-h-0 flex-col p-2 pl-0" aria-labelledby={props.labelledBy}>
      <div class={`min-h-0 flex-1 overflow-y-auto ${pagePanelClass} ${props.class ?? ""}`}>{props.children}</div>
    </section>
  )
}

/** Page title with optional trailing actions. Pages carry no subtitle: the title names the page. */
export function PageHeader(props: { id?: string; title: string; actions?: JSX.Element }) {
  return (
    <header class="flex min-h-14 shrink-0 flex-wrap items-center gap-2 px-6 pt-3">
      <h1
        id={props.id}
        class="max-w-full flex-1 shrink-0 truncate text-[17px] leading-6 text-v2-text-text-base [font-weight:600]"
      >
        {props.title}
      </h1>
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
        <h2
          id={props.id}
          class="min-w-0 flex-1 truncate text-[12px] leading-4 text-v2-text-text-muted [font-weight:500]"
        >
          <Show when={props.onTitle} fallback={props.title}>
            <button
              type="button"
              class="rounded-full text-left transition-colors duration-short ease-standard hover:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
              onClick={() => props.onTitle?.()}
            >
              {props.title}
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
 * The one empty, loading and error block: centred in the space the view would fill, with a title (15/22 600),
 * a muted body (13/20) and at most one pill action. `loading` puts a spinner before the title; `error` marks it
 * as an alert and pairs with a plain-language body and an outline "Try again" action, never a raw error code.
 */
export function PageEmpty(
  props: ParentProps<{ title?: string; loading?: boolean; error?: boolean; action?: JSX.Element; class?: string }>,
) {
  const body = children(() => props.children)
  return (
    <div
      role={props.error ? "alert" : props.loading ? "status" : undefined}
      class={`flex flex-1 flex-col items-center px-6 pt-[15vh] pb-16 text-center ${props.class ?? ""}`}
    >
      <Show when={props.title}>
        <div class="flex max-w-sm items-center gap-2">
          <Show when={props.loading}>
            <LoaderV2 class="shrink-0 text-v2-icon-icon-muted" />
          </Show>
          <p class="text-[15px] leading-[22px] text-v2-text-text-base [font-weight:600]">{props.title}</p>
        </div>
      </Show>
      <Show when={body()}>
        <p classList={{ "max-w-sm text-[13px] leading-5 text-v2-text-text-muted": true, "mt-1": !!props.title }}>
          {body()}
        </p>
      </Show>
      <Show when={props.action}>
        <div class="mt-4">{props.action}</div>
      </Show>
    </div>
  )
}

/** Shared list-row look: a pill-shaped hover target. */
export const pageRowClass =
  "flex w-full min-w-0 items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition-[background-color,border-radius] duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover active:rounded-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
