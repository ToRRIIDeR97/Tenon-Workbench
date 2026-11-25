import { createContext, useContext, type ParentProps } from "solid-js"
import type { ViewItem, ViewSpace } from "../components/view-window"

const Context = createContext<ViewSpace>()

export function ViewSpaceProvider(props: ParentProps<ViewSpace>) {
  const value: ViewSpace = {
    render: (host: HTMLElement, item: ViewItem) => props.render(host, item),
    get available() {
      return props.available
    },
    get open() {
      return props.open
    },
    get pin() {
      return props.pin
    },
    get pinned() {
      return props.pinned
    },
    get watchPinned() {
      return props.watchPinned
    },
  }
  return <Context.Provider value={value}>{props.children}</Context.Provider>
}

export function useViewSpace() {
  return useContext(Context)
}
