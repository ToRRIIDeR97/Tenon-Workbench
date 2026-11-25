import { createContext, useContext, type ParentProps } from "solid-js"
import type { Design } from "../components/design-fence"

export type DesignSpace = {
  use?: (design: Design) => void
  open?: (design: Design) => void
  reveal?: (design: Design) => void
}

const Context = createContext<DesignSpace>()

export function DesignSpaceProvider(props: ParentProps<DesignSpace>) {
  const value: DesignSpace = {
    get use() {
      return props.use
    },
    get open() {
      return props.open
    },
    get reveal() {
      return props.reveal
    },
  }
  return <Context.Provider value={value}>{props.children}</Context.Provider>
}

export function useDesignSpace() {
  return useContext(Context)
}
