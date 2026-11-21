import { createContext, useContext, type ParentProps } from "solid-js"
import type { ViewItem, ViewSpace } from "../components/view-window"

const Context = createContext<ViewSpace>()

/** Lets the app draw ```view windows: it reads the thread's files, so only it can render them. */
export function ViewSpaceProvider(props: ParentProps<ViewSpace>) {
  // Getters, so the app can offer an action only where it works.
  const value: ViewSpace = {
    render: (host: HTMLElement, item: ViewItem) => props.render(host, item),
    get open() {
      return props.open
    },
    get pin() {
      return props.pin
    },
    get pinned() {
      return props.pinned
    },
  }
  return <Context.Provider value={value}>{props.children}</Context.Provider>
}

/** Undefined outside a provider: a ```view block then stays a code block. */
export function useViewSpace() {
  return useContext(Context)
}
