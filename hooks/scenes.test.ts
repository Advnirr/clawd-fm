import { expect, test } from 'claude-code/testing'

import { DARK, frame, idlePool, LIGHT, ROWS } from './scenes'
import { cells, TEXT } from './testing'

const CLAWD = 0xd97757
const NONE = 0x01000000
// The pixel at half-row py, or null where the cell holds no block.
function pixel(cs: ReturnType<typeof cells>, cols: number, x: number, py: number): number | null {
  const { ch, fg, bg } = cs[Math.floor(py / 2) * cols + x]!
  if (py % 2 === 0) return ch === 0x2580 ? fg : null
  if (ch === 0x2584) return fg
  return ch === 0x2580 && bg !== NONE ? bg : null
}

// The highest half-row in columns x0..x1 drawn in the color.
function top(b64: string, cols: number, x0: number, x1: number, color: number): number {
  const cs = cells(b64)
  for (let py = 0; py < ROWS * 2; py++) {
    for (let x = x0; x <= x1; x++) if (pixel(cs, cols, x, py) === color) return py
  }
  return -1
}


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
  expect(october).not.toContain('skate')
  expect(october).not.toContain('meadow')
  const february = at(2, 1, 12)
  expect(february).toContain('snow')
  expect(february).toContain('skate')
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
    for (const hour of [3, 12, 22]) expect(at(month, 15, hour).length).toBeGreaterThanOrEqual(5)
  }
})

test('scenes seen all year dress for the season', async () => {
  for (const scene of ['train', 'room', 'night', 'city', 'campfire', 'sea', 'lighthouse'] as const) {
    expect(frame(scene, 100, 12, { season: 'winter' }), scene).not.toBe(frame(scene, 100, 12, { season: 'summer' }))
  }
  expect(frame('meadow', 100, 12, { season: 'spring' })).not.toBe(frame('meadow', 100, 12, { season: 'summer' }))
  // Summer is the default.
  expect(frame('train', 100, 12)).toBe(frame('train', 100, 12, { season: 'summer' }))
})

test('the train passes white hills in winter and green ones in summer', async () => {
  const hills = (season: 'winter' | 'summer', color: number) => top(frame('train', 120, 8, { season }), 120, 60, 119, color)
  expect(hills('winter', 0xd8dce0) >= 0 || hills('winter', 0xc8ced4) >= 0).toBe(true)
  expect(hills('winter', 0x3f5a3a)).toBe(-1)
  expect(hills('summer', 0x3f5a3a)).toBeGreaterThan(-1)
})

test('a caption stays whole while helpers walk past it', async () => {
  const caption = 'helper · reading notes.txt'
  for (let t = 0; t < 200; t += 3) {
    for (const scene of ['agent', 'meadow', 'read'] as const) expect(TEXT(frame(scene, 120, t, { detail: caption })), `${scene} at ${t}`).toContain(caption)
  }
})

test('helpers turn back before the caption, and use the whole band without one', async () => {
  const cols = 120
  const detail = 'helper · $ bash -c a very long command that fills the rest of the band'
  let reachesRight = false
  for (let t = 0; t < 400; t += 2) {
    // The caption starts at column 66.
    expect(top(frame('agent', cols, t, { detail }), cols, 64, cols - 1, CLAWD), `t=${t}`).toBe(-1)
    if (top(frame('agent', cols, t), cols, 64, cols - 1, CLAWD) >= 0) reachesRight = true
  }
  expect(reachesRight).toBe(true)
})

test('the shell shows real output once the command finished, and no made-up text before', async () => {
  const running = TEXT(frame('shell', 100, 60, { detail: '$ ls' }))
  expect(running.replace(/[\s$ls▌▀▄]/g, '')).toBe('')
  const done = TEXT(frame('shell', 100, 60, { detail: '$ ls', output: { lines: ['a.txt', 'b.txt'], isError: false } }))
  expect(done).toContain('a.txt')
  expect(done).toContain('b.txt')
  // Long commands are shown whole, never retyped over the output.
  for (const t of [0, 5, 40]) {
    expect(TEXT(frame('shell', 100, t, { detail: '$ ls', output: { lines: ['a.txt'], isError: false } }))).toContain('a.txt')
  }
  expect(TEXT(frame('shell', 100, 3, { detail: '$ true', output: { lines: [], isError: false } }))).toContain('(no output)')
})

test('one helper walks for each subagent', async () => {
  // Helpers' eyes sit on half-row 3, two pixels each; Clawd's are higher.
  const eyes = (n: number) => {
    const cs = cells(frame('agent', 120, 30, { helpers: n }))
    let count = 0
    for (let x = 0; x < 120; x++) if (pixel(cs, 120, x, 3) === DARK.eye) count++
    return count
  }
  expect(eyes(1)).toBe(2)
  expect(eyes(2)).toBe(4)
  expect(eyes(5)).toBe(10)
  expect(eyes(9)).toBe(10)
})
