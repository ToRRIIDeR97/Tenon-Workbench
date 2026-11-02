// Speech models offered in Settings › Dictation. Sources, revisions and checksums are the GGUF
// builds Handy's model catalog uses (https://github.com/cjpais/Handy, src-tauri/src/catalog/catalog.json).

export const DICTATION_MODELS = [
  {
    id: "whisper-small",
    name: "Whisper Small",
    repository: "handy-computer/whisper-small-gguf",
    revision: "c0214bd34be9296695486f838e0142f900803159",
    file: "whisper-small-Q8_0.gguf",
    size: 269_751_136,
    sha256: "9b9c8811bbcc82a7766f0fb0925614bdacb0923b2cc630daeac17108b655b860",
  },
  {
    id: "whisper-turbo",
    name: "Whisper Turbo",
    repository: "handy-computer/whisper-large-v3-turbo-gguf",
    revision: "5eaf945c7978e564bae5b28a5b1639dd93c2bfb1",
    file: "whisper-large-v3-turbo-Q8_0.gguf",
    size: 886_381_760,
    sha256: "b2e30cc286bc9f3aba4db9099fc7403543497c05ce7100d0d83091ddfd25a183",
  },
  {
    id: "parakeet-v3",
    name: "Parakeet V3",
    repository: "handy-computer/parakeet-tdt-0.6b-v3-gguf",
    revision: "85ac09ea12fc4b1112fa76810059364bc6adc9de",
    file: "parakeet-tdt-0.6b-v3-Q8_0.gguf",
    size: 739_508_576,
    sha256: "5859f77944efcd8eafa23a6350731960b2b55b2203df51f319665c807d802cc7",
  },
] as const

export type DictationModelID = (typeof DICTATION_MODELS)[number]["id"]

export function dictationModelURL(model: (typeof DICTATION_MODELS)[number]) {
  return `https://huggingface.co/${model.repository}/resolve/${model.revision}/${model.file}`
}

/** The engine binary's file name: `.exe` on Windows, no extension on macOS and Linux. */
export function dictationEngineFile(platform: NodeJS.Platform) {
  return platform === "win32" ? "tenon-dictation.exe" : "tenon-dictation"
}
