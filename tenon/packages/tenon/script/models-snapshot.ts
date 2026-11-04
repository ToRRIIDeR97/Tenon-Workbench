/**
 * The models.dev catalog for the build: an explicit file wins, then the network, then the last good
 * download, so being offline or a models.dev outage doesn't stop a build.
 */
export async function loadModelsData(input: { url: string; source?: string; snapshot: string }) {
  if (input.source) {
    const text = await Bun.file(input.source).text()
    JSON.parse(text)
    return text
  }
  try {
    const response = await fetch(input.url, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()
    JSON.parse(text)
    await Bun.write(input.snapshot, text)
    return text
  } catch (error) {
    const snapshot = Bun.file(input.snapshot)
    if (!(await snapshot.exists())) {
      throw new Error(`Failed to load ${input.url} and no snapshot exists at ${input.snapshot}`, { cause: error })
    }
    console.warn(`Using the saved models.dev snapshot: ${error instanceof Error ? error.message : String(error)}`)
    return snapshot.text()
  }
}
