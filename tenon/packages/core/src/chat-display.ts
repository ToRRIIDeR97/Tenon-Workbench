export * as ChatDisplay from "./chat-display"

/** Tells agents that Tenon's chat renders ```svg fenced blocks as diagram windows (session-ui svg-window.ts). */
export const svgGuidance = [
  "Tenon Workbench chat renders a fenced code block tagged `svg` as an inline diagram window.",
  "When a diagram, graph, or codebase map would explain something better than text, write one complete <svg> element with a viewBox inside a ```svg block.",
  "The window is sandboxed: scripts, event handlers, links and external resources (images, fonts, stylesheets) are removed or blocked, so keep the SVG self-contained.",
  "For colors that read in light and dark themes, use currentColor or the CSS variables --tenon-fg, --tenon-muted, --tenon-accent, --tenon-surface and --tenon-border.",
  "Keep text at 12px or larger and the viewBox width near 680.",
  "Give every label room: size each box to its text (about 0.6 × font size per character), and keep labels from sharing space with each other or with arrows.",
  "When the `render_svg` tool is available (on the `tenon` MCP server), check every diagram with it before sending: look at the picture, fix each problem it lists, and render again until it reports none.",
].join("\n")

/**
 * How an agent asks the user a question. External harnesses reach Tenon through the `ask_user`
 * tool of the `tenon` MCP server; native agents have the built-in `question` tool. A harness without
 * that server (an ACP agent with no HTTP MCP support) asks in its reply.
 */
export const askGuidance = {
  harness:
    "When you are unsure and the choice matters, ask the user instead of guessing: call the `ask_user` tool on the `tenon` MCP server.",
  native: "When you are unsure and the choice matters, ask the user instead of guessing: use the `question` tool.",
  reply:
    "When you are unsure and the choice matters, ask the user instead of guessing: put the question in your reply and wait for the answer.",
} as const

/** Inline ```html previews and ```html canvas artboards (the right panel's Canvas tab). */
export const designGuidance = [
  "For a small visual (one component or a few variants), write one self-contained ```html fenced block. Inline CSS and JavaScript are fine; no network requests or external resources. It renders inline in a sandboxed window.",
  'For larger design work (whole pages or several screens), write one ```html canvas title="Name" block per artboard. Artboards appear in the Canvas tab of the right panel.',
  "Diagrams stay ```svg blocks.",
].join("\n")

/** ```view blocks: the universal viewer for files the user should see, not just read about. */
export const viewGuidance = [
  "To show the user a file (an image, video, sound, PDF, document, spreadsheet or 3D model), write a ```view fenced block with one path per line, relative to the thread folder (or an https URL for an image, video or sound on the web). Each line becomes a viewer window in the chat: images, video and audio play inline, 3D models (.glb, .gltf) turn in a viewport, PDFs page in a reader, and documents open in full with Open.",
  "Use it whenever the user asks to see, hear or check something, and after you make or change a visual or audio asset. The user can pin a file to the Project's artifacts and leave notes on it for you.",
].join("\n")

/** File references the chat turns into links. */
export const fileReferenceGuidance =
  "Cite files as inline code with a path relative to the thread folder, optionally with a line or range, like `src/app.tsx:42` or `src/app.tsx:42-58`. These become clickable in the chat."

/**
 * Where Project work is recorded. Tenon is the source of truth for a Project's notes, roadmap, tasks, issues and
 * features; a linked GitHub repository mirrors the issues. Names the app tools by their bare names, which external
 * harnesses see on the `tenon` MCP server.
 */
export const workGuidance = [
  "Tenon Workbench keeps each Project's notes, roadmap, tasks, issues, features and progress. When the Tenon app tools are available (notes_*, timeline_*, log_append, calendar_*, tasks_create, threads_list, project_setup, thread_start; on the `tenon` MCP server for external harnesses), use them for this without being asked by name:",
  "- Notes, docs, plans, specs, research or meeting notes: write a Tenon note with notes_write (notes_search first to update an existing page instead of duplicating it). Don't put them only in a repository file or only in your reply.",
  "- Roadmap, milestones, features, issues, bugs, to-dos: read the Project's timeline with timeline_get, then add or update items with timeline_update (milestone for a roadmap phase, task for a feature, issue or bug). Mark a task doing when you start it and done when it is finished.",
  "- Progress: after finishing meaningful work, add one line with log_append (what was done, what is next).",
  "- Dated personal to-dos and events: tasks_create and calendar_apply.",
  "- A new project, or work that belongs in another Project: create the Project with project_setup (it makes the folder in this workspace), then start a thread there with thread_start and a self-contained first message. A thread can do this from any Project, General included.",
  "- A long-running command (a dev server, a watch build, a log tail): start it with terminal_start, so it runs in a terminal tab of this thread the user can see; read its output with terminal_read and stop it with terminal_stop. Run commands that finish in your own shell.",
  "Tenon is the main record. When the Project's folder is a GitHub repository and `gh` works, keep GitHub in step: for each new issue or feature task, also open a GitHub issue (`gh issue create`) and end the Tenon task's title with its number, like `Fix login redirect (#42)`; when you read GitHub issues the timeline lacks, add them as tasks the same way. Close the GitHub issue when the task is done. If `gh` is missing or signed out, record it in Tenon only and say so.",
].join("\n")

/**
 * The thread's checklist. Every harness's own plan tool (todowrite, TodoWrite, Codex's plan) reaches the Tasks dock
 * above the composer (`SessionTodo.planFromToolCall`, `AcpHarness.planEvents`), but agents rarely write one unasked.
 */
export const checklistGuidance =
  "For any task with three or more steps, keep a checklist with your todo or plan tool (todowrite, TodoWrite or update_plan, whichever you have): write it before starting, mark one step in progress at a time, and mark each step completed as soon as it is done. Tenon Workbench shows it above the composer as the user's progress bar, so keep it current until every step is completed or cancelled."

/** All Tenon chat abilities for one kind of agent, kept short because harnesses receive it at every handoff. */
export function abilities(agent: keyof typeof askGuidance) {
  return [
    askGuidance[agent],
    checklistGuidance,
    workGuidance,
    designGuidance,
    svgGuidance,
    viewGuidance,
    fileReferenceGuidance,
  ].join("\n\n")
}
