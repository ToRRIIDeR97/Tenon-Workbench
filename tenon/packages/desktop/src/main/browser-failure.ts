export type BrowserFailure = {
  kind: "load" | "crashed" | "certificate"
  code: number | string
  description: string
  url: string
}

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
