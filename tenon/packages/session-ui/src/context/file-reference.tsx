import { createContext, useContext, type Accessor } from "solid-js"
import type { FileReference } from "../components/markdown-file-reference"

export type { FileReference }

export type FileReferencePreview =
  | { status: "found"; path: string; start: number; lines: string[] }
  | { status: "folder"; path: string; count: number }
  | { status: "binary"; path: string }
  | { status: "missing"; path: string }

export type FileReferenceActions = {
  directory: string
  readFileRange: (reference: FileReference, limit: number) => Promise<FileReferencePreview>
  entryType: (path: string) => Promise<"file" | "directory" | undefined>
  onFileReference: (reference: FileReference) => void
}

const FileReferenceContext = createContext<Accessor<FileReferenceActions | undefined>>()

export const FileReferenceProvider = FileReferenceContext.Provider

export function useFileReferences(): Accessor<FileReferenceActions | undefined> {
  const actions = useContext(FileReferenceContext)
  return () => actions?.()
}
