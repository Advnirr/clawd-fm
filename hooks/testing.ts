// Test helpers: reading a packed Raster frame back.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Unpacks a frame into its cells: code point, foreground, background.
export function cells(b64: string): { ch: number; fg: number; bg: number }[] {
  const bytes: number[] = []
  for (let i = 0; i < b64.length; i += 4) {
    const n = [0, 1, 2, 3].map(k => B64.indexOf(b64[i + k]!))
    const v = (Math.max(n[0]!, 0) << 18) | (Math.max(n[1]!, 0) << 12) | (Math.max(n[2]!, 0) << 6) | Math.max(n[3]!, 0)
    bytes.push((v >> 16) & 255)
    if (n[2]! >= 0) bytes.push((v >> 8) & 255)
    if (n[3]! >= 0) bytes.push(v & 255)
  }
  const word = (i: number) => (bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)) >>> 0
  const out = []
  for (let i = 0; i < bytes.length; i += 12) out.push({ ch: word(i), fg: word(i + 4), bg: word(i + 8) })
  return out
}

// A frame's characters in reading order, rows run together.
export const TEXT = (b64: string) => cells(b64).map(c => String.fromCodePoint(c.ch)).join('')
