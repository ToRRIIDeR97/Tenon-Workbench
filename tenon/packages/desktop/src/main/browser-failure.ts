// Why the panel's browser has no page to show (#325): a failed main-frame load, a crashed page process or a
// rejected certificate. Sent to the Browser tab in `browser-state`, which shows it with the address and Retry
// instead of a blank native view.
export type BrowserFailure = {
  kind: "load" | "crashed" | "certificate"
  code: number | string
  description: string
  url: string
}

// Chromium's net::ERR_ABORTED: a navigation replaced by another one, or cancelled; not a failure to show.
const ERR_ABORTED = -3

export function browserLoadFailure(input: {
  errorCode: number
  errorDescription: string
  validatedURL: string
  isMainFrame: boolean
}): BrowserFailure | undefined {
  if (!input.isMainFrame || input.errorCode === ERR_ABORTED) return undefined
  return { kind: "load", code: input.errorCode, description: input.errorDescription, url: input.validatedURL }
}

export function browserCrash(details: { reason: string; exitCode: number }, url: string): BrowserFailure | undefined {
  if (details.reason === "clean-exit") return undefined
  return { kind: "crashed", code: details.exitCode, description: details.reason, url }
}

export function browserCertificateFailure(url: string, error: string): BrowserFailure {
  return { kind: "certificate", code: error, description: error, url }
}
