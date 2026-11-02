import { Schema } from "effect"
import { KnowledgeNote } from "@/knowledge/note"
import { KnowledgeVault } from "@/knowledge/vault"
import { PlannerCalendar } from "@/planner/calendar"
import { BrainProject } from "@/project/brain"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"

const NoteQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

const VaultPageQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

const VaultProjectQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  project: Schema.String,
})

const ProjectQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  id: Schema.String,
})

export class SecondBrainConflictError extends Schema.ErrorClass<SecondBrainConflictError>("SecondBrainConflictError")(
  {
    name: Schema.Literal("SecondBrainConflictError"),
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 409 },
) {}

/** A rejected request: `data.message` is the domain reason, such as `invalid_path` or `invalid_json`. */
export class SecondBrainInvalidError extends Schema.ErrorClass<SecondBrainInvalidError>("SecondBrainInvalidError")(
  {
    name: Schema.Literal("SecondBrainInvalidError"),
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 400 },
) {}

// Every endpoint shares one error mapper, so they declare the same error set.
const errors = [
  SecondBrainInvalidError,
  HttpApiError.NotFound,
  SecondBrainConflictError,
  HttpApiError.InternalServerError,
]

export const SecondBrainPaths = {
  notes: "/second-brain/notes",
  note: "/second-brain/note",
  calendar: "/second-brain/calendar",
  projects: "/second-brain/projects",
  project: "/second-brain/project",
  projectThreads: "/second-brain/project-threads",
  projectWorkspace: "/second-brain/projects/workspace",
  projectScan: "/second-brain/projects/scan",
  projectLink: "/second-brain/projects/link",
  projectUnlink: "/second-brain/projects/unlink",
  instructions: "/second-brain/instructions",
  vault: "/second-brain/vault",
  vaultPages: "/second-brain/vault/pages",
  vaultPage: "/second-brain/vault/page",
  vaultPageHistory: "/second-brain/vault/page/history",
  vaultTimeline: "/second-brain/vault/timeline",
  vaultLog: "/second-brain/vault/log",
  vaultConflicts: "/second-brain/vault/conflicts",
  vaultMigrate: "/second-brain/vault/migrate",
} as const

export const SecondBrainApi = HttpApi.make("secondBrain").add(
  HttpApiGroup.make("secondBrain")
    .add(
      HttpApiEndpoint.get("listNotes", SecondBrainPaths.notes, {
        query: Schema.Struct({ ...WorkspaceRoutingQueryFields, search: Schema.optional(Schema.String) }),
        success: described(Schema.Array(KnowledgeNote.Info), "Notes"),
        error: errors,
      }),
      HttpApiEndpoint.get("readNote", SecondBrainPaths.note, {
        query: NoteQuery,
        success: described(KnowledgeNote.Document, "Note"),
        error: errors,
      }),
      HttpApiEndpoint.put("writeNote", SecondBrainPaths.note, {
        query: NoteQuery,
        payload: KnowledgeNote.WriteInput,
        success: described(KnowledgeNote.Document, "Note saved"),
        error: errors,
      }),
      HttpApiEndpoint.delete("deleteNote", SecondBrainPaths.note, {
        query: Schema.Struct({ ...NoteQuery.fields, expectedRevision: Schema.String }),
        success: described(KnowledgeNote.Info, "Note deleted"),
        error: errors,
      }),
      HttpApiEndpoint.get("readCalendar", SecondBrainPaths.calendar, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: described(PlannerCalendar.Snapshot, "Calendar"),
        error: errors,
      }),
      HttpApiEndpoint.put("writeCalendar", SecondBrainPaths.calendar, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: PlannerCalendar.WriteInput,
        success: described(PlannerCalendar.Snapshot, "Calendar saved"),
        error: errors,
      }),
      HttpApiEndpoint.get("listProjects", SecondBrainPaths.projects, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: described(Schema.Array(BrainProject.Info), "Projects"),
        error: errors,
      }),
      HttpApiEndpoint.post("createProject", SecondBrainPaths.projects, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: BrainProject.CreateInput,
        success: described(BrainProject.Info, "Project created"),
        error: errors,
      }),
      HttpApiEndpoint.get("listProjectThreads", SecondBrainPaths.projectThreads, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: described(Schema.Array(BrainProject.ThreadSummary), "Projects with thread directories"),
        error: errors,
      }),
      HttpApiEndpoint.post("ensureWorkspaceProject", SecondBrainPaths.projectWorkspace, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: BrainProject.EnsureWorkspaceInput,
        success: described(BrainProject.Info, "Project linked to the Workspace"),
        error: errors,
      }),
      HttpApiEndpoint.post("scanProjects", SecondBrainPaths.projectScan, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: described(BrainProject.ScanResult, "Project folders scanned"),
        error: errors,
      }),
      HttpApiEndpoint.post("linkProjectFolder", SecondBrainPaths.projectLink, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: BrainProject.LinkInput,
        success: described(BrainProject.ScanResult, "Folder linked as a Project"),
        error: errors,
      }),
      HttpApiEndpoint.post("unlinkProjectFolder", SecondBrainPaths.projectUnlink, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: BrainProject.LinkInput,
        success: described(BrainProject.ScanResult, "Linked folder removed"),
        error: errors,
      }),
      HttpApiEndpoint.get("readInstructions", SecondBrainPaths.instructions, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: described(BrainProject.Instructions, "AGENTS.md in this folder"),
        error: errors,
      }),
      HttpApiEndpoint.put("writeInstructions", SecondBrainPaths.instructions, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: BrainProject.InstructionsInput,
        success: described(BrainProject.Instructions, "AGENTS.md saved"),
        error: errors,
      }),
      HttpApiEndpoint.delete("removeInstructions", SecondBrainPaths.instructions, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: described(BrainProject.Instructions, "AGENTS.md removed"),
        error: errors,
      }),
      HttpApiEndpoint.get("readProject", SecondBrainPaths.project, {
        query: ProjectQuery,
        success: described(BrainProject.Info, "Project"),
        error: errors,
      }),
      HttpApiEndpoint.patch("updateProject", SecondBrainPaths.project, {
        query: ProjectQuery,
        payload: BrainProject.UpdateInput,
        success: described(BrainProject.Info, "Project updated"),
        error: errors,
      }),
      HttpApiEndpoint.get("readVault", SecondBrainPaths.vault, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: described(KnowledgeVault.Info, "The vault root and this workspace's folder"),
        error: errors,
      }),
      HttpApiEndpoint.get("listVaultPages", SecondBrainPaths.vaultPages, {
        query: Schema.Struct({
          ...WorkspaceRoutingQueryFields,
          project: Schema.optional(Schema.String),
          search: Schema.optional(Schema.String),
        }),
        success: described(Schema.Array(KnowledgeVault.PageInfo), "Vault pages"),
        error: errors,
      }),
      HttpApiEndpoint.get("readVaultPage", SecondBrainPaths.vaultPage, {
        query: VaultPageQuery,
        success: described(KnowledgeVault.Page, "Vault page"),
        error: errors,
      }),
      HttpApiEndpoint.put("writeVaultPage", SecondBrainPaths.vaultPage, {
        query: VaultPageQuery,
        payload: KnowledgeVault.PageWriteInput,
        success: described(KnowledgeVault.Page, "Vault page saved"),
        error: errors,
      }),
      HttpApiEndpoint.get("readVaultPageHistory", SecondBrainPaths.vaultPageHistory, {
        query: Schema.Struct({ ...VaultPageQuery.fields, revision: Schema.optional(Schema.String) }),
        success: described(
          Schema.Union([Schema.Array(KnowledgeVault.PageVersion), KnowledgeVault.PageVersionBody]),
          "Earlier versions of a page, or one version's body when a revision is given",
        ),
        error: errors,
      }),
      HttpApiEndpoint.get("readVaultTimeline", SecondBrainPaths.vaultTimeline, {
        query: VaultProjectQuery,
        success: described(KnowledgeVault.Timeline, "Project timeline"),
        error: errors,
      }),
      HttpApiEndpoint.put("writeVaultTimeline", SecondBrainPaths.vaultTimeline, {
        query: VaultProjectQuery,
        payload: KnowledgeVault.TimelineWriteInput,
        success: described(KnowledgeVault.Timeline, "Project timeline saved"),
        error: errors,
      }),
      HttpApiEndpoint.get("readVaultLog", SecondBrainPaths.vaultLog, {
        query: VaultProjectQuery,
        success: described(Schema.Array(KnowledgeVault.LogEntry), "Project log, newest first"),
        error: errors,
      }),
      HttpApiEndpoint.post("appendVaultLog", SecondBrainPaths.vaultLog, {
        query: VaultProjectQuery,
        payload: KnowledgeVault.LogInput,
        success: described(KnowledgeVault.LogEntry, "Log entry appended"),
        error: errors,
      }),
      HttpApiEndpoint.get("listVaultConflicts", SecondBrainPaths.vaultConflicts, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: described(Schema.Array(KnowledgeVault.Conflict), "Sync conflict copies"),
        error: errors,
      }),
      HttpApiEndpoint.post("migrateVault", SecondBrainPaths.vaultMigrate, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: described(KnowledgeVault.MigrateResult, "Workspace notes moved into the vault"),
        error: errors,
      }),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "second brain",
        description: "Workspace-scoped notes, the Tenon vault and local calendar data.",
      }),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
