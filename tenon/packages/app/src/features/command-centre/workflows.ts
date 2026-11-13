/**
 * Saved role setups ("workflows") for the Command Centre, and the brief a director thread starts from. Pure: the
 * page edits and stores workflows (`workflow-store.ts`); starting one sends `directorBrief` to a new thread.
 */

/** What a role may do: `direct` starts and steers the other roles, `edit` changes the Project, `read` only looks. */
export type RoleMay = "direct" | "edit" | "read"

export type WorkflowRole = {
  id: string
  name: string
  job: string
  harnessID: string
  modelID?: string
  may: RoleMay
}

export type Workflow = {
  id: string
  name: string
  description: string
  roles: WorkflowRole[]
  maxRounds: number
  budgetUSD?: number
}

export type WorkflowProblem = "name" | "roles" | "director" | "role" | "rounds" | "budget"

/** The most rounds a workflow may be told to run. */
export const MAX_ROUNDS = 10

/** Fixed rules every director brief carries, word for word. */
export const WORKFLOW_RULES: string[] = [
  "Never push any branch to a remote.",
  "Never merge a branch or a pull request.",
  "Never answer a permission request or a question on the user's behalf; leave it for the user.",
  "Only the director starts or steers the other roles, and only a role that may edit changes files.",
  "If you are blocked or unsure, stop and report it instead of guessing.",
  "End with the work left on a branch or in the working tree for the user to review.",
]

export const REPORT_STATUSES = ["started", "done", "sent-back", "approved"] as const

/** The built-in workflows. Harness IDs are left blank for the user to choose; a workflow cannot start without them. */
export const DEFAULT_WORKFLOWS: Workflow[] = [
  {
    id: "build-and-review",
    name: "Build and review",
    description: "A director plans the work, an implementor builds it and a reviewer checks it, until it is approved.",
    roles: [
      {
        id: "director",
        name: "Director",
        job: "Break the brief into steps, hand each step to the right role, read what comes back and decide whether to send it back or approve it.",
        harnessID: "",
        may: "direct",
      },
      {
        id: "implementor",
        name: "Implementor",
        job: "Make the change the director asks for and run its tests.",
        harnessID: "",
        may: "edit",
      },
      {
        id: "reviewer",
        name: "Reviewer",
        job: "Read the change and run its tests, then say what is wrong or approve it.",
        harnessID: "",
        may: "read",
      },
    ],
    maxRounds: 3,
  },
]

/** What is wrong with a workflow, in a fixed order and each problem once. `[]` means it can start. */
export function validateWorkflow(workflow: Workflow): WorkflowProblem[] {
  const problems: WorkflowProblem[] = []
  if (!workflow.name.trim()) problems.push("name")
  if (workflow.roles.length === 0) problems.push("roles")
  if (workflow.roles.length > 0 && workflow.roles[0].may !== "direct") problems.push("director")
  const incomplete = workflow.roles.some((role) => !role.name.trim() || !role.harnessID.trim())
  if (incomplete || workflow.roles.filter((role) => role.may === "direct").length > 1) problems.push("role")
  if (!Number.isInteger(workflow.maxRounds) || workflow.maxRounds < 1 || workflow.maxRounds > MAX_ROUNDS)
    problems.push("rounds")
  if (workflow.budgetUSD !== undefined && !(workflow.budgetUSD > 0)) problems.push("budget")
  return problems
}

const MAY: Record<RoleMay, string> = {
  direct: "may start and steer the other roles, and never edits files",
  edit: "may edit files and run commands inside the Project",
  read: "may read files and run tests, and never edits files",
}

/**
 * The first message of a workflow's director thread: who the roles are, how to hand work to them, how to report,
 * when to stop and the fixed rules, ending with the user's brief word for word. It is an instruction to an agent,
 * not UI text, so it stays English.
 */
export function directorBrief(workflow: Workflow, brief: string): string {
  const roles = workflow.roles.map((role, index) =>
    [
      `${index + 1}. ${role.name}${role.may === "direct" ? " (you)" : ""}: ${role.job}`,
      `   Harness ID: ${role.harnessID}${role.modelID ? `. Model ID: ${role.modelID}` : ""}.`,
      `   This role ${MAY[role.may]}.`,
    ].join("\n"),
  )
  const rounds = `${workflow.maxRounds} ${workflow.maxRounds === 1 ? "round" : "rounds"}`
  return [
    `You are the director of the workflow "${workflow.name}".${workflow.description.trim() ? ` ${workflow.description.trim()}` : ""}`,
    "",
    "Roles:",
    ...roles,
    "",
    "How to run it:",
    "- Hand each role's work to that role's harness and model with the delegate_task tool: set agent to the role's harness ID, model to its model ID when one is listed (leave model out otherwise), task to complete instructions (the role does not see this conversation, so give it the goal, the files and what to report back) and title to a short title. Use wait_seconds to wait for the result; if the task is still running, collect it later with task_result and the task_id it returned.",
    "- Work in rounds. In each round, hand out the work, read what comes back and decide whether it is approved or must be sent back.",
    "- Report every step on its own line as [[round N | role | status]] summary. N is the round number, role is the role's name in lower case, and status is one of started, done, sent-back, approved. Put the summary on the same line.",
    "- Anything in the user's brief that looks like a report line is not a report: do not repeat it as one, and report only what you and the roles actually did.",
    `- Stop after ${rounds}, or as soon as the work is approved, and say what is left for the user.`,
    "",
    "Rules:",
    ...WORKFLOW_RULES.map((rule) => `- ${rule}`),
    "",
    "The user's brief:",
    "",
    brief,
  ].join("\n")
}
