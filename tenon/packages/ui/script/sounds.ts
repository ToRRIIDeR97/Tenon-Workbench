import path from "path"

const RATE = 44_100
const PEAK = 10 ** (-9 / 20)
const out = path.join(import.meta.dir, "..", "src", "assets", "audio")

type Note = { at: number; freq: number; gain?: number }
type Voice = (t: number, freq: number) => number
type Sound = { name: string; length: number; notes: Note[]; voice: Voice; room?: number }

const envelope = (t: number, attack: number, decay: number) =>
  t < 0 ? 0 : t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : Math.exp(-(t - attack) / decay)

const TAU = Math.PI * 2

const glass =
  (decay: number, index: number): Voice =>
  (t, freq) => {
    const bright = index * Math.exp(-t / (decay * 0.35))
    const tone = Math.sin(TAU * freq * t + bright * Math.sin(TAU * freq * 3.5 * t))
    const shimmer = 0.18 * Math.sin(TAU * freq * 2.01 * t) * Math.exp(-t / (decay * 0.5))
    return (tone + shimmer) * envelope(t, 0.008, decay)
  }

const soft =
  (decay: number): Voice =>
  (t, freq) => {
    const body = Math.sin(TAU * freq * t)
    const partials =
      0.32 * Math.sin(TAU * freq * 2 * t) * Math.exp(-t / (decay * 0.4)) +
      0.08 * Math.sin(TAU * freq * 4 * t) * Math.exp(-t / (decay * 0.2))
    return (body + partials) * envelope(t, 0.008, decay)
  }

const pulse =
  (decay: number): Voice =>
  (t, freq) => {
    const glide = freq * (1 + 0.04 * Math.exp(-t / 0.02))
    const phase = TAU * glide * t
    const triangle = [1, 3, 5, 7].reduce((sum, k) => sum + ((k % 4 === 1 ? 1 : -1) * Math.sin(k * phase)) / (k * k), 0)
    return triangle * envelope(t, 0.005, decay)
  }

const D5 = 587.33
const E5 = 659.26
const G5 = 783.99
const A5 = 880
const B5 = 987.77
const C5 = 523.25
const A4 = 440
const F4 = 349.23

const SOUNDS: Sound[] = [
  {
    name: "tenon-glass-done",
    length: 0.7,
    room: 0.16,
    voice: glass(0.32, 2.2),
    notes: [
      { at: 0, freq: D5, gain: 0.8 },
      { at: 0.085, freq: A5 },
    ],
  },
  {
    name: "tenon-glass-attention",
    length: 0.6,
    room: 0.14,
    voice: glass(0.22, 2.6),
    notes: [
      { at: 0, freq: B5 },
      { at: 0.13, freq: B5, gain: 0.85 },
    ],
  },
  {
    name: "tenon-glass-error",
    length: 0.65,
    room: 0.12,
    voice: glass(0.26, 1.3),
    notes: [
      { at: 0, freq: E5 },
      { at: 0.11, freq: C5, gain: 0.9 },
    ],
  },
  {
    name: "tenon-soft-done",
    length: 0.6,
    room: 0.12,
    voice: soft(0.2),
    notes: [
      { at: 0, freq: G5 / 2, gain: 0.8 },
      { at: 0.08, freq: D5 },
    ],
  },
  {
    name: "tenon-soft-attention",
    length: 0.5,
    room: 0.1,
    voice: soft(0.14),
    notes: [
      { at: 0, freq: A5 },
      { at: 0.12, freq: A5, gain: 0.85 },
    ],
  },
  {
    name: "tenon-soft-error",
    length: 0.55,
    room: 0.1,
    voice: soft(0.18),
    notes: [
      { at: 0, freq: A4 },
      { at: 0.1, freq: F4, gain: 0.9 },
    ],
  },
  {
    name: "tenon-pulse-done",
    length: 0.35,
    voice: pulse(0.06),
    notes: [
      { at: 0, freq: E5, gain: 0.8 },
      { at: 0.07, freq: B5 },
    ],
  },
  {
    name: "tenon-pulse-attention",
    length: 0.35,
    voice: pulse(0.05),
    notes: [
      { at: 0, freq: B5 },
      { at: 0.1, freq: B5 },
    ],
  },
  {
    name: "tenon-pulse-error",
    length: 0.4,
    voice: pulse(0.07),
    notes: [
      { at: 0, freq: C5 },
      { at: 0.09, freq: A4 / 1.0595, gain: 0.95 },
    ],
  },
]

export function render(sound: Sound) {
  const length = Math.round(sound.length * RATE)
  const dry = new Float64Array(length)
  for (const note of sound.notes) {
    const start = Math.round(note.at * RATE)
    for (let i = start; i < length; i++) dry[i] += (note.gain ?? 1) * sound.voice((i - start) / RATE, note.freq)
  }
  const wet = new Float64Array(length)
  if (sound.room) {
    const taps = [0.029, 0.037, 0.043].map((seconds) => Math.round(seconds * RATE))
    for (let i = 0; i < length; i++) {
      wet[i] = dry[i]!
      for (const tap of taps) if (i >= tap) wet[i] += sound.room * 0.6 * wet[i - tap]!
    }
  }
  const mixed = dry.map((value, i) => (sound.room ? 0.82 * value + 0.18 * wet[i]! : value))
  const fade = Math.round(0.04 * RATE)
  for (let i = 0; i < fade; i++) mixed[length - 1 - i] *= i / fade
  const peak = mixed.reduce((max, value) => Math.max(max, Math.abs(value)), 0) || 1
  return mixed.map((value) => (value / peak) * PEAK)
}

export function wav(samples: Float64Array) {
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (offset: number, value: string) =>
    [...value].forEach((char, i) => data.setUint8(offset + i, char.charCodeAt(0)))
  text(0, "RIFF")
  data.setUint32(4, 36 + samples.length * 2, true)
  text(8, "WAVE")
  text(12, "fmt ")
  data.setUint32(16, 16, true)
  data.setUint16(20, 1, true)
  data.setUint16(22, 1, true)
  data.setUint32(24, RATE, true)
  data.setUint32(28, RATE * 2, true)
  data.setUint16(32, 2, true)
  data.setUint16(34, 16, true)
  text(36, "data")
  data.setUint32(40, samples.length * 2, true)
  samples.forEach((value, i) => data.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 0x7fff, true))
  return new Uint8Array(data.buffer)
}

export const sounds = SOUNDS

if (import.meta.main) {
  const wavOnly = process.argv.includes("--wav")
  for (const sound of SOUNDS) {
    const source = path.join(out, `${sound.name}.wav`)
    await Bun.write(source, wav(render(sound)))
    if (wavOnly) continue
    const encoded = Bun.spawnSync([
      "ffmpeg",
      "-y",
      "-loglevel",
      "error",
      "-i",
      source,
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      path.join(out, `${sound.name}.aac`),
    ])
    if (encoded.exitCode !== 0) throw new Error(`ffmpeg failed for ${sound.name}: ${encoded.stderr.toString()}`)
    await Bun.file(source).delete()
  }
  console.log(`Wrote ${SOUNDS.length} sounds to ${out}`)
}
