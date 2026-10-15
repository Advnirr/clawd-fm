import { expect, test } from 'claude-code/testing'

import { DARK, frame, idlePool, LIGHT, ROWS } from './scenes'

const CLAWD = 0xd97757
const NONE = 0x01000000
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Unpacks a frame into its cells: code point, foreground, background.
function cells(b64: string): { ch: number; fg: number; bg: number }[] {
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

// The pixel at half-row py, or null where the cell holds no block.
function pixel(b64: string, cols: number, x: number, py: number): number | null {
  const { ch, fg, bg } = cells(b64)[Math.floor(py / 2) * cols + x]!
  if (py % 2 === 0) return ch === 0x2580 ? fg : null
  if (ch === 0x2584) return fg
  return ch === 0x2580 && bg !== NONE ? bg : null
}

// The highest half-row in columns x0..x1 drawn in the color.
function top(b64: string, cols: number, x0: number, x1: number, color: number): number {
  for (let py = 0; py < ROWS * 2; py++) {
    for (let x = x0; x <= x1; x++) if (pixel(b64, cols, x, py) === color) return py
  }
  return -1
}

const TEXT = (b64: string) => cells(b64).map(c => String.fromCodePoint(c.ch)).join('')

test('a frame depends only on its arguments', async () => {
  for (const scene of ['meadow', 'rain', 'city', 'shell'] as const) {
    expect(frame(scene, 90, 42, { detail: '$ ls' })).toBe(frame(scene, 90, 42, { detail: '$ ls' }))
  }
})

test('the width is clamped to 1..512 columns', async () => {
  expect(frame('sea', 0, 3)).toBe(frame('sea', 1, 3))
  expect(frame('sea', 4000, 3)).toBe(frame('sea', 512, 3))
})

test('the train jolts car by car, Clawd riding the middle one', async () => {
  const cols = 100
  const still = frame('train', cols, 5)
  // Locomotive (x 42..54) first, then Clawd's car (23..40), then the last car (4..21).
  const loco = top(still, cols, 42, 46, 0x8c3a2e)
  const clawd = top(still, cols, 23, 40, CLAWD)
  const last = top(still, cols, 4, 21, 0x8c3a2e)
  expect(clawd).toBeGreaterThan(-1)
  expect(top(frame('train', cols, 10), cols, 42, 46, 0x8c3a2e)).toBe(loco + 1)
  expect(top(frame('train', cols, 11), cols, 23, 40, CLAWD)).toBe(clawd + 1)
  expect(top(frame('train', cols, 11), cols, 4, 21, 0x8c3a2e)).toBe(last)
  expect(top(frame('train', cols, 12), cols, 4, 21, 0x8c3a2e)).toBe(last + 1)
  expect(top(frame('train', cols, 12), cols, 23, 40, CLAWD)).toBe(clawd)
})

test('a scene change wipes in from the left', async () => {
  const cols = 60
  expect(frame('sea', cols, 9, { from: 'rain', progress: 0 })).toBe(frame('rain', cols, 9))
  expect(frame('sea', cols, 9, { from: 'rain', progress: 1 })).toBe(frame('sea', cols, 9))
  const half = cells(frame('sea', cols, 9, { from: 'rain', progress: 0.5 }))
  const sea = cells(frame('sea', cols, 9))
  const rain = cells(frame('rain', cols, 9))
  for (let y = 0; y < ROWS; y++) {
    expect(half[y * cols + 5]).toEqual(sea[y * cols + 5])
    expect(half[y * cols + 50]).toEqual(rain[y * cols + 50])
  }
})

test('the track plate shows on wide bands and scrolls a long name', async () => {
  const name = 'Siren and the Sea — Swimwave'
  expect(TEXT(frame('meadow', 120, 0, { label: name }))).toContain(name)
  const long = 'A'.repeat(30) + ' Very Long Title That Will Not Fit'
  expect(frame('meadow', 60, 0, { label: long })).not.toBe(frame('meadow', 60, 2, { label: long }))
  // Too narrow for a plate: the scene is left as it is.
  expect(frame('meadow', 12, 0, { label: name })).toBe(frame('meadow', 12, 0))
})

test('a work caption shows beside the scene, and not under a shell command', async () => {
  expect(TEXT(frame('read', 100, 0, { detail: 'reading README.md' }))).toContain('reading README.md')
  expect(TEXT(frame('read', 40, 0, { detail: 'reading README.md' }))).not.toContain('reading README.md')
  expect(TEXT(frame('shell', 100, 30, { detail: '$ npm test' }))).toContain('$ npm')
})

test('the light palette changes the drawing', async () => {
  expect(frame('meadow', 80, 4, { palette: LIGHT })).not.toBe(frame('meadow', 80, 4, { palette: DARK }))
})

const at = (month: number, day: number, hour: number) => idlePool(new Date(2026, month - 1, day, hour))

test('scenes follow the season', async () => {
  const october = at(10, 15, 12)
  expect(october).toContain('autumn')
  expect(october).toContain('rain')
  expect(october).not.toContain('snow')
  expect(october).not.toContain('meadow')
  const february = at(2, 1, 12)
  expect(february).toContain('snow')
  expect(february).not.toContain('autumn')
  expect(february).not.toContain('rain')
  expect(at(5, 1, 12)).toContain('meadow')
  expect(at(7, 1, 23)).toContain('fireflies')
  expect(at(11, 1, 23)).not.toContain('fireflies')
  // Day from 7:00 to 20:00.
  expect(at(10, 15, 7)).toContain('train')
  expect(at(10, 15, 20)).toContain('city')
})

test('from 10 December to 14 January every other scene is festive', async () => {
  for (const [month, day] of [[12, 10], [12, 31], [1, 14]] as const) {
    const days = at(month, day, 12)
    const nights = at(month, day, 23)
    expect(days.filter((_, i) => i % 2 === 0).every(s => s === 'fir' || s === 'gifts')).toBe(true)
    expect(days).toContain('gifts')
    expect(nights.filter((_, i) => i % 2 === 0).every(s => s === 'fir' || s === 'fireworks')).toBe(true)
    expect(nights).toContain('fireworks')
  }
  for (const [month, day] of [[12, 9], [1, 15]] as const) {
    expect(at(month, day, 12)).not.toContain('fir')
    expect(at(month, day, 23)).not.toContain('fireworks')
  }
})

test('every season and hour has scenes to show', async () => {
  for (let month = 1; month <= 12; month++) {
    for (const hour of [3, 12, 22]) expect(at(month, 15, hour).length).toBeGreaterThanOrEqual(4)
  }
})
