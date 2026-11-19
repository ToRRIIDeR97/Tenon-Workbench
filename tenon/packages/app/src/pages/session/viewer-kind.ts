/** File types the Workbench panel renders instead of showing their source or bytes. */
export type ViewerKind = "markdown" | "csv" | "json" | "pdf" | "video" | "sheet" | "doc"

const kinds: Record<string, ViewerKind> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  csv: "csv",
  tsv: "csv",
  json: "json",
  pdf: "pdf",
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  ogv: "video",
  xlsx: "sheet",
  xls: "sheet",
  ods: "sheet",
  docx: "doc",
}

export function viewerKind(path: string | undefined): ViewerKind | undefined {
  const ext = path?.split(".").pop()?.toLowerCase()
  return ext ? kinds[ext] : undefined
}
