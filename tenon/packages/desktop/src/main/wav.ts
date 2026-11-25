export function wavBytes(samples: Float32Array, rate: number) {
  const buffer = Buffer.alloc(44 + samples.length * 2)
  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(36 + samples.length * 2, 4)
  buffer.write("WAVE", 8)
  buffer.write("fmt ", 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36)
  buffer.writeUInt32LE(samples.length * 2, 40)
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0))
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + index * 2)
  })
  return buffer
}
