const dot = (x: number, y: number, r = 0.9) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`
const tint = (d: string) => `<path d="${d}" fill="currentColor" fill-opacity="0.18" stroke="none"/>`
const frame = `<rect x="2" y="2.75" width="12" height="10.5" rx="1.75"/>`
const folderBody = `M2.5 4.5a1 1 0 0 1 1-1h2.9l1.6 1.75h4.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1Z`
const pencilSquare = `<path d="M7.5 2.75H4.25a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5V8.5"/><path d="M11.4 2.35a1.45 1.45 0 0 1 2.05 2.05L8.4 9.45 6 10l.55-2.4Z"/>`
const bubble = `M4 3h8a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H7.25L4.5 13.5v-2H4A1.5 1.5 0 0 1 2.5 10V4.5A1.5 1.5 0 0 1 4 3Z`
const gear = `M12.49 6.61L14.01 6.97L14.01 9.03L12.49 9.39A4.7 4.7 0 0 1 12.16 10.19L12.98 11.52L11.52 12.98L10.19 12.16A4.7 4.7 0 0 1 9.39 12.49L9.03 14.01L6.97 14.01L6.61 12.49A4.7 4.7 0 0 1 5.81 12.16L4.48 12.98L3.02 11.52L3.84 10.19A4.7 4.7 0 0 1 3.51 9.39L1.99 9.03L1.99 6.97L3.51 6.61A4.7 4.7 0 0 1 3.84 5.81L3.02 4.48L4.48 3.02L5.81 3.84A4.7 4.7 0 0 1 6.61 3.51L6.97 1.99L9.03 1.99L9.39 3.51A4.7 4.7 0 0 1 10.19 3.84L11.52 3.02L12.98 4.48L12.16 5.81A4.7 4.7 0 0 1 12.49 6.61Z`
const openExternal = `<path d="M12.75 9v3a1.5 1.5 0 0 1-1.5 1.5h-6.5a1.5 1.5 0 0 1-1.5-1.5v-6.5a1.5 1.5 0 0 1 1.5-1.5h3"/><path d="M9.75 2.5h3.75v3.75M13.5 2.5 8 8"/>`
const copy = `<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>`
const share = `<path d="M5.5 6H4.5a1.5 1.5 0 0 0-1.5 1.5v4.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V7.5A1.5 1.5 0 0 0 11.5 6h-1M8 9.5v-7M5.75 4.75 8 2.5l2.25 2.25"/>`
const sliders = `<path d="M2.5 4.75h5.25M10.75 4.75h2.75M2.5 11.25h1.75M7.25 11.25h6.25"/><circle cx="9.25" cy="4.75" r="1.5"/><circle cx="5.75" cy="11.25" r="1.5"/>`
const reset = `<path d="M3.5 8a4.5 4.5 0 1 0 1.32-3.18L3.5 6.1M3.5 3.5v2.6h2.6"/>`
const grabber = `<path d="M5.5 6 8 3.5 10.5 6M5.5 10 8 12.5l2.5-2.5"/>`
const xmarkSmall = `<path d="m5.25 5.25 5.5 5.5m0-5.5-5.5 5.5"/>`
const chevronDown = `<path d="M4.5 6.25 8 9.75l3.5-3.5"/>`
const download = `<path d="M8 2.5v8M4.75 7.25 8 10.5l3.25-3.25M2.75 10.75v1.25a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-1.25"/>`
const terminal = (active: boolean) =>
  `${active ? tint("M3.75 2.75h8.5A1.75 1.75 0 0 1 14 4.5v7a1.75 1.75 0 0 1-1.75 1.75h-8.5A1.75 1.75 0 0 1 2 11.5v-7a1.75 1.75 0 0 1 1.75-1.75Z") : ""}${frame}<path d="m4.75 6.25 2 1.75-2 1.75M8.5 10h2.75"/>`
const layout = (line: string, fill?: string) => `${fill ? tint(fill) : ""}${frame}<path d="${line}"/>`
const leftPane = "M3.75 2.75H6v10.5H3.75A1.75 1.75 0 0 1 2 11.5v-7a1.75 1.75 0 0 1 1.75-1.75Z"
const rightPane = "M10 2.75h2.25A1.75 1.75 0 0 1 14 4.5v7a1.75 1.75 0 0 1-1.75 1.75H10Z"
const bottomPane = "M2 9.75h12v1.75a1.75 1.75 0 0 1-1.75 1.75h-8.5A1.75 1.75 0 0 1 2 11.5Z"
const status = (active: boolean) =>
  `${active ? tint("M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12Z") : ""}<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 8h11M5 5.25h3M5 10.75h3"/>`
const review = (active: boolean) =>
  `${active ? tint("M4.25 2.5h7.5a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-7.5a1.5 1.5 0 0 1-1.5-1.5V4a1.5 1.5 0 0 1 1.5-1.5Z") : ""}<rect x="2.75" y="2.5" width="10.5" height="11" rx="1.5"/><path d="M8 4.75v4M6 6.75h4M6 11h4"/>`
const fileTree = (active: boolean) =>
  `${active ? tint("M8.25 4.75h4.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-.75.75h-4.5a.75.75 0 0 1-.75-.75V5.5a.75.75 0 0 1 .75-.75Z") : ""}<path d="M3.5 2.5v9.75h4M3.5 6.25h4"/><rect x="7.5" y="4.75" width="6" height="3" rx=".75"/><rect x="7.5" y="10.75" width="6" height="3" rx=".75"/>`

export const iconPack = {
  plus: `<path d="M8 3v10M3 8h10"/>`,
  "plus-small": `<path d="M8 5v6M5 8h6"/>`,
  close: `<path d="m4 4 8 8m0-8-8 8"/>`,
  "close-small": xmarkSmall,
  "xmark-small": xmarkSmall,
  "outline-xmark": xmarkSmall,
  check: `<path d="M3 8.5 6.5 12 13 4.5"/>`,
  "check-small": `<path d="m5 8.5 2 2 4-4.75"/>`,
  dash: `<path d="M4 8h8"/>`,
  "chevron-down": chevronDown,
  "outline-chevron-down": chevronDown,
  "chevron-left": `<path d="M9.75 4.5 6.25 8l3.5 3.5"/>`,
  "chevron-right": `<path d="M6.25 4.5 9.75 8l-3.5 3.5"/>`,
  "chevron-double-right": `<path d="M4 4.5 7.5 8 4 11.5M8.5 4.5 12 8l-3.5 3.5"/>`,
  "chevron-grabber-vertical": grabber,
  selector: grabber,
  "arrow-left": `<path d="M13 8H3m4-4L3 8l4 4"/>`,
  "arrow-right": `<path d="M3 8h10M9 4l4 4-4 4"/>`,
  "arrow-up": `<path d="M8 13V3M4 7l4-4 4 4"/>`,
  "arrow-down-to-line": `<path d="M8 2.5V10M4.5 6.5 8 10l3.5-3.5M3 13.25h10"/>`,
  "arrow-undo-down": `<path d="M6 3.5 3 6.5l3 3M3 6.5h6.25a3.5 3.5 0 0 1 0 7H8"/>`,
  "align-right": `<path d="M13.5 3v10M2.5 8h8m-3-3 3 3-3 3"/>`,
  enter: `<path d="M13 3.5v4a2 2 0 0 1-2 2H3.5m3-3-3 3 3 3"/>`,
  reply: `<path d="M6.5 4 3 7.5 6.5 11M3 7.5h6a4 4 0 0 1 4 4v1"/>`,
  reset,
  "outline-reset": reset,
  refresh: `<path d="M12.5 8a4.5 4.5 0 1 1-1.32-3.18L12.5 6.1m0-2.6v2.6H9.9"/>`,
  sync: `<path d="M13 6.25a5.25 5.25 0 0 0-9.6-1.1M3 9.75a5.25 5.25 0 0 0 9.6 1.1M13.25 2.75V6.5H9.5M2.75 13.25V9.5H6.5"/>`,
  expand: `<path d="M9.5 2.5h4v4m0-4-4 4m-3 7h-4v-4m0 4 4-4"/>`,
  collapse: `<path d="M13.5 2.5 9.75 6.25M9.75 3v3.25H13M2.5 13.5l3.75-3.75M3 9.75h3.25V13"/>`,
  download,
  "cloud-upload": `<path d="M5.25 12.25H4.5a2.5 2.5 0 0 1-.35-4.97 3.9 3.9 0 0 1 7.6-.86 2.75 2.75 0 0 1-.25 5.83h-.75M8 13.5V8.75m-2 2 2-2 2 2"/>`,
  "magnifying-glass": `<circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3.25 3.25"/>`,
  "magnifying-glass-menu": `<path d="M2.5 4h3M2.5 8h2.25M2.5 12h3"/><circle cx="10" cy="7.75" r="3.25"/><path d="m12.4 10.15 1.6 1.6"/>`,
  menu: `<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>`,
  "outline-dots": `${dot(3.5, 8, 1)}${dot(8, 8, 1)}${dot(12.5, 8, 1)}`,
  "dot-grid": `${dot(6, 4)}${dot(10, 4)}${dot(6, 8)}${dot(10, 8)}${dot(6, 12)}${dot(10, 12)}`,
  home: `<path d="M2.75 6.75 8 2.75l5.25 4v5.75a1 1 0 0 1-1 1H10v-3.75H6v3.75H3.75a1 1 0 0 1-1-1Z"/>`,
  "settings-gear": `<path d="${gear}"/><circle cx="8" cy="8" r="2"/>`,
  help: `<circle cx="8" cy="8" r="5.75"/><path d="M6.25 6.4a1.8 1.8 0 1 1 2.6 1.6c-.5.25-.85.6-.85 1.15v.25"/>${dot(8, 11.25, 0.8)}`,
  warning: `<path d="M7.13 2.98a1 1 0 0 1 1.74 0l5.02 8.77a1 1 0 0 1-.87 1.5H2.98a1 1 0 0 1-.87-1.5Z"/><path d="M8 6.25v3"/>${dot(8, 11.1, 0.8)}`,
  "circle-x": `<circle cx="8" cy="8" r="5.75"/><path d="m6 6 4 4m0-4-4 4"/>`,
  "circle-check": `<circle cx="8" cy="8" r="5.75"/><path d="m5.5 8.25 1.75 1.75L10.5 6.25"/>`,
  "circle-ban-sign": `<circle cx="8" cy="8" r="5.75"/><path d="M3.95 12.05 12.05 3.95"/>`,
  stop: `<rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" stroke="none"/>`,
  eye: `<path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8Z"/><circle cx="8" cy="8" r="2"/>`,
  glasses: `<circle cx="4.75" cy="9.75" r="2.5"/><circle cx="11.25" cy="9.75" r="2.5"/><path d="M7.25 9.5c.5-.5 1-.5 1.5 0M2.25 9.5 3.25 5M13.75 9.5 12.75 5"/>`,
  link: `<path d="M6.75 9.25a2.75 2.75 0 0 0 3.9 0l2-2a2.75 2.75 0 0 0-3.9-3.9l-.75.75M9.25 6.75a2.75 2.75 0 0 0-3.9 0l-2 2a2.75 2.75 0 0 0 3.9 3.9l.75-.75"/>`,
  pin: `<path d="M5.75 2.5h4.5M6.75 2.5v3.25L4.5 9.25h7L9.25 5.75V2.5M8 9.25v4.25"/>`,
  calendar: `<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.75h11M5.5 2v3M10.5 2v3"/>${dot(5.5, 9.5, 0.75)}${dot(8, 9.5, 0.75)}${dot(5.5, 11.5, 0.75)}`,
  book: `<path d="M8 4.25C6.75 3.25 4.75 3 2.5 3.25v9c2.25-.25 4.25 0 5.5 1 1.25-1 3.25-1.25 5.5-1v-9c-2.25-.25-4.25 0-5.5 1ZM8 4.25v9"/>`,
  document: `<path d="M4.5 2.5h4.25L12 5.75v6.75a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a.5.5 0 0 1 .5-.5Z"/><path d="M8.75 2.5v3.25H12M6 8.5h4M6 11h2.5"/>`,
  "open-file": openExternal,
  "square-arrow-top-right": openExternal,
  "outline-square-arrow": openExternal,
  share,
  "outline-share": share,
  copy,
  "outline-copy": copy,
  trash: `<path d="M2.75 4.25h10.5M6.25 4.25V3a.5.5 0 0 1 .5-.5h2.5a.5.5 0 0 1 .5.5v1.25M4 4.25l.6 8.35a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.35M6.75 7v3.75M9.25 7v3.75"/>`,
  archive: `<rect x="2" y="3" width="12" height="3" rx=".75"/><path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6.5 8.75h3"/>`,
  edit: pencilSquare,
  "edit-small-2": pencilSquare,
  "new-session": pencilSquare,
  "new-session-active": pencilSquare,
  "pencil-line": `<path d="M3 13v-2.5l7.9-7.9a1.77 1.77 0 0 1 2.5 2.5L5.5 13ZM9.75 3.75l2.5 2.5M9 13.25h4.5"/>`,
  comment: `<path d="${bubble}"/>`,
  "speech-bubble": `<path d="${bubble}"/>`,
  "bubble-5": `<path d="${bubble}"/>`,
  prompt: `<path d="${bubble}"/><path d="M5.5 6h5M5.5 8.5h3"/>`,
  folder: `<path d="${folderBody}"/>`,
  "folder-open": `<path d="M2.5 12.5V4.5a1 1 0 0 1 1-1h2.9L8 5.25h4.5a1 1 0 0 1 1 1V7.5M2.5 12.5l1.75-5h10.25l-1.75 5Z"/>`,
  "folder-add-left": `<path d="${folderBody}"/><path d="M8 7.25v4M6 9.25h4"/>`,
  workspace: `<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><rect x="5.5" y="5.5" width="5" height="5" rx="1"/>`,
  "workspace-isolated": `<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><rect x="5.5" y="5.5" width="5" height="5" rx="1" fill="currentColor"/>`,
  "workspace-new": `<path d="M2.5 5.5V4A1.5 1.5 0 0 1 4 2.5h1.5m5 0H12A1.5 1.5 0 0 1 13.5 4v1.5m0 5V12a1.5 1.5 0 0 1-1.5 1.5h-1.5m-5 0H4A1.5 1.5 0 0 1 2.5 12v-1.5M8 5.5v5M5.5 8h5"/>`,
  branch: `<circle cx="4.75" cy="3.75" r="1.5"/><circle cx="4.75" cy="12.25" r="1.5"/><circle cx="11.25" cy="4.75" r="1.5"/><path d="M4.75 5.25v5.5M11.25 6.25c0 3.25-6.5 1.75-6.5 4.5"/>`,
  fork: `<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="11.5" cy="3.5" r="1.5"/><circle cx="8" cy="12.5" r="1.5"/><path d="M4.5 5v.75a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V5M8 7.75V11"/>`,
  filetree: fileTree(false),
  "file-tree": fileTree(false),
  "file-tree-active": fileTree(true),
  split: `<rect x="2" y="2.75" width="12" height="10.5" rx="1.75"/><path d="M8 2.75v10.5"/>`,
  unified: `<rect x="2" y="2.75" width="12" height="10.5" rx="1.75"/><path d="M2 8h12"/>`,
  review: review(false),
  "review-active": review(true),
  code: `<path d="M5.25 4.75 2 8l3.25 3.25M10.75 4.75 14 8l-3.25 3.25M9.25 3l-2.5 10"/>`,
  "code-lines": `<path d="M2.5 4h7m2 0h2m-11 4h3m2 0h6m-11 4h5m2 0h4"/>`,
  "bullet-list": `${dot(3.5, 4.5)}${dot(3.5, 8)}${dot(3.5, 11.5)}<path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7"/>`,
  checklist: `<path d="m2.5 4.5 1.25 1.25 2-2.5M2.5 10.5l1.25 1.25 2-2.5M8 4.75h5.5M8 10.75h5.5"/>`,
  task: `<path d="M5.5 3h-1a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-1"/><rect x="5.5" y="2" width="5" height="2.25" rx=".75"/><path d="M6 9.25 7.5 10.75 10.25 7.75"/>`,
  subagent: `<rect x="2.5" y="2.5" width="5" height="5" rx="1.25"/><rect x="8.5" y="8.5" width="5" height="5" rx="1.25"/><path d="M5 7.5V10a1 1 0 0 0 1 1h2.5"/>`,
  "window-cursor": `<path d="M13.5 7.75V4.25a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h3.75M2.5 6h11"/><path d="m9.75 9.25 4 1.4-1.75.85-.85 1.75Z"/>`,
  monitor: `<rect x="2" y="2.75" width="12" height="8.5" rx="1.5"/><path d="M5.5 13.5h5M8 11.25v2.25"/>`,
  photo: `<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><circle cx="10.25" cy="5.75" r="1.25"/><path d="m2.75 11.25 2.75-2.75 5 5M9.25 10.25l1.5-1.5 2.75 2.75"/>`,
  activity: `<path d="M2 8h2.5l1.75-4.5 3.5 9L11.5 8H14"/>`,
  server: `<rect x="2.5" y="2.5" width="11" height="4.5" rx="1.25"/><rect x="2.5" y="9" width="11" height="4.5" rx="1.25"/>${dot(5, 4.75, 0.75)}${dot(5, 11.25, 0.75)}`,
  providers: `<path d="M4.75 12.75a2.75 2.75 0 0 1-.4-5.47 3.9 3.9 0 0 1 7.55-.77 3.15 3.15 0 0 1-.4 6.24Z"/>`,
  models: `<path d="M8 2c.4 3.2 2.8 5.6 6 6-3.2.4-5.6 2.8-6 6-.4-3.2-2.8-5.6-6-6 3.2-.4 5.6-2.8 6-6Z"/>`,
  brain: `<path d="M8 3.6v9.4M8 3.6a2.2 2.2 0 0 0-3.85.9A2.3 2.3 0 0 0 2.75 8.6a2.4 2.4 0 0 0 1.6 3.7A2.3 2.3 0 0 0 8 13M8 3.6a2.2 2.2 0 0 1 3.85.9 2.3 2.3 0 0 1 1.4 4.1 2.4 2.4 0 0 1-1.6 3.7A2.3 2.3 0 0 1 8 13M5.25 7.25c.9 0 1.6.45 2 1.25M10.75 7.25c-.9 0-1.6.45-2 1.25"/>`,
  shield: `<path d="M8 2 13 3.75v4c0 3.1-2.1 5.25-5 6.25-2.9-1-5-3.15-5-6.25v-4Z"/>`,
  "grid-plus": `<rect x="2.5" y="2.5" width="4" height="4" rx="1"/><rect x="9.5" y="2.5" width="4" height="4" rx="1"/><rect x="2.5" y="9.5" width="4" height="4" rx="1"/><path d="M11.5 9.5v4m-2-2h4"/>`,
  keyboard: `<rect x="1.75" y="3.75" width="12.5" height="8.5" rx="1.5"/>${dot(4.5, 6.5, 0.7)}${dot(6.83, 6.5, 0.7)}${dot(9.17, 6.5, 0.7)}${dot(11.5, 6.5, 0.7)}<path d="M5.5 9.5h5"/>`,
  "outline-sliders": sliders,
  sliders,
  sidebar: layout("M6 2.75v10.5"),
  "sidebar-active": layout("M6 2.75v10.5", leftPane),
  "layout-left": layout("M6 2.75v10.5"),
  "layout-left-partial": layout("M6 2.75v10.5", leftPane),
  "layout-left-full": layout("M6 2.75v10.5", leftPane),
  "sidebar-right": layout("M10 2.75v10.5"),
  "layout-right": layout("M10 2.75v10.5"),
  "layout-right-partial": layout("M10 2.75v10.5", rightPane),
  "layout-right-full": layout("M10 2.75v10.5", rightPane),
  "panel-bottom": layout("M2 9.75h12"),
  "layout-bottom": layout("M2 9.75h12"),
  "layout-bottom-partial": layout("M2 9.75h12", bottomPane),
  "layout-bottom-full": layout("M2 9.75h12", bottomPane),
  status: status(false),
  "status-active": status(true),
  terminal: terminal(false),
  "terminal-active": terminal(true),
  console: `<path d="M3 4.5 6.5 8 3 11.5M8 11.5h5"/>`,
  "command-centre": `<circle cx="8" cy="8" r="4.5"/><path d="M8 1.75v2.5M8 11.75v2.5M1.75 8h2.5M11.75 8h2.5"/>${dot(8, 8, 1.25)}`,
  harness: `<rect x="3" y="5" width="10" height="7.5" rx="2"/><path d="M8 2.5V5M6.25 8.25v1M9.75 8.25v1M1.75 8v2M14.25 8v2"/>`,
  plug: `<path d="M6 2.5v3M10 2.5v3M4.5 5.5h7V8a3.5 3.5 0 0 1-7 0ZM8 11.5v2.5"/>`,
  mail: `<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2.5 4.5 8 8.75l5.5-4.25"/>`,
  skills: `<path d="M10.75 2c.25 1.65 1.35 2.75 3 3-1.65.25-2.75 1.35-3 3-.25-1.65-1.35-2.75-3-3 1.65-.25 2.75-1.35 3-3ZM2.75 13.25 7 9"/>${dot(4.5, 4.5, 0.8)}`,
  "model-profile": `<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5.75" cy="7" r="1.5"/><path d="M3.75 10.75c.4-1 1.1-1.5 2-1.5s1.6.5 2 1.5M9.5 6.5h2.5M9.5 9h2.5"/>`,
} satisfies Record<string, string>

export const iconPackSymbol = (body: string) =>
  `<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${body.replace(
    /<(path|circle|rect|line|polyline|ellipse)\b/g,
    '<$1 vector-effect="non-scaling-stroke"',
  )}</g>`
