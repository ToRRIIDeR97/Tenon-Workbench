import type { PromiseMethodName } from "../interpreter/model.js"

export const promiseStatics = new Set<PromiseMethodName>(["all", "allSettled", "race", "resolve", "reject"])

export const TOOL_CALL_CONCURRENCY = 8
