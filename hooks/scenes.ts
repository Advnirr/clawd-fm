// Animated scenes for the band, packed as Raster cells.
// Each terminal cell holds two pixels (half blocks), so ROWS cells = ROWS*2 px.

export const ROWS = 4
const PX_ROWS = ROWS * 2

export type WorkName = 'think' | 'shell' | 'read' | 'edit' | 'web' | 'agent' | 'happy' | 'oops'
export type IdleName =
  | 'meadow' | 'rain' | 'sea' | 'snow' | 'train'
  | 'night' | 'city' | 'campfire' | 'space' | 'lighthouse' | 'fireflies'
  | 'room'
export type SceneName = IdleName | WorkName
export const DAY_SCENES: readonly IdleName[] = ['meadow', 'room', 'rain', 'train', 'sea', 'snow']
export const NIGHT_SCENES: readonly IdleName[] = ['night', 'room', 'city', 'fireflies', 'campfire', 'lighthouse', 'space']
export const IDLE_SCENES: readonly IdleName[] = [...new Set([...DAY_SCENES, ...NIGHT_SCENES])]

// Terminal's own background.
const NONE = 0x01000000
const CLAWD = 0xd97757

export type Palette = {
  ink: number // main line art
  dim: number // clouds, rain, far things
  bright: number // stars, moon
  eye: number
  ground: number
  water: number
  foam: number
  wood: number
  screen: number
  plate: number
  plateText: number
}

export const DARK: Palette = {
  ink: 0xb8b5a8, dim: 0x6b6a64, bright: 0xf0eee6, eye: 0x1f1e1d, ground: 0x8a877c,
  water: 0x1f3442, foam: 0x7f9fb3, wood: 0x8a6a4a, screen: 0x2b2a27, plate: 0x2b2a27, plateText: 0xe8e6dc,
}

export const LIGHT: Palette = {
  ink: 0x3d3c38, dim: 0x9a978c, bright: 0x6b6a64, eye: 0x1f1e1d, ground: 0x5a5852,
  water: 0x9fb8c9, foam: 0xf0f4f7, wood: 0x8a6a4a, screen: 0x1f1e1d, plate: 0x1f1e1d, plateText: 0xe8e6dc,
}

type Cell = { ch: number; fg: number; bg: number }

// Clawd, 10x5 px: o = body, k = eyes.
const WALK_A = ['.oooooooo.', '.ookookoo.', 'oooooooooo', '.oooooooo.', '.o.o..o.o.']
const WALK_B = ['.oooooooo.', '.ookookoo.', 'oooooooooo', '.oooooooo.', '..o.oo.o..']
const BLINK = ['.oooooooo.', '.oooooooo.', 'oooooooooo', '.oooooooo.', '.o.o..o.o.']
const TYPE_B = ['.oooooooo.', 'oookookooo', '.oooooooo.', '.oooooooo.', '.o.o..o.o.']
// Helpers, 6x3 px.
const MINI_A = ['.oooo.', 'okooko', '.o..o.']
const MINI_B = ['.oooo.', 'okooko', 'o....o']

// Cheap stable noise in [0, 1).
function noise(a: number, b = 0): number {
  let h = (a * 374761393 + b * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? B64[n & 63]! : '='
  }
  return out
}

class Canvas {
  readonly cells: Cell[]
  readonly px: (number | null)[]

  constructor(readonly cols: number, readonly p: Palette) {
    this.cells = Array.from({ length: cols * ROWS }, () => ({ ch: 32, fg: p.ink, bg: NONE }))
    this.px = new Array(cols * PX_ROWS).fill(null)
  }

  put(x: number, y: number, ch: string, fg: number, bg?: number) {
    if (x < 0 || x >= this.cols || y < 0 || y >= ROWS) return
    const cell = this.cells[y * this.cols + x]!
    cell.ch = ch.codePointAt(0) ?? 32
    cell.fg = fg
    if (bg !== undefined) cell.bg = bg
  }

  // Spaces are skipped unless a background is given.
  text(x: number, y: number, s: string, fg: number, bg?: number) {
    for (let i = 0; i < s.length; i++) if (s[i] !== ' ' || bg !== undefined) this.put(x + i, y, s[i]!, fg, bg)
  }

  fillRow(y: number, bg: number) {
    for (let x = 0; x < this.cols; x++) this.cells[y * this.cols + x]!.bg = bg
  }

  pixel(x: number, py: number, color: number) {
    if (x < 0 || x >= this.cols || py < 0 || py >= PX_ROWS) return
    this.px[py * this.cols + x] = color
  }

  sprite(rows: readonly string[], x: number, py: number, colors: Record<string, number>) {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const c = colors[row[dx]!]
        if (c !== undefined) this.pixel(x + dx, py + dy, c)
      }
    })
  }

  clawd(rows: readonly string[], x: number, py: number) {
    this.sprite(rows, x, py, { o: CLAWD, k: this.p.eye })
  }

  // Pixels win over characters; a half-pixel cell keeps the cell's background.
  pack(): string {
    const words = new Uint32Array(this.cols * ROWS * 3)
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x
        const cell = this.cells[i]!
        const top = this.px[2 * y * this.cols + x] ?? null
        const bot = this.px[(2 * y + 1) * this.cols + x] ?? null
        let { ch, fg, bg } = cell
        if (top !== null) {
          ch = 0x2580 // ▀
          fg = top
          if (bot !== null) bg = bot
        } else if (bot !== null) {
          ch = 0x2584 // ▄
          fg = bot
        }
        words.set([ch, fg, bg], i * 3)
      }
    }
    return base64(new Uint8Array(words.buffer))
  }
}

function walkerX(cols: number, t: number, every: number): number {
  return (Math.floor(t / every) % (cols + 12)) - 11
}

function meadow(c: Canvas, t: number) {
  const { cols, p } = c
  for (let i = 0; i < Math.ceil(cols / 24); i++) {
    const x = Math.floor(noise(i, 1) * cols + t / 10) % (cols + 8) - 4
    c.text(x, i % 2, noise(i, 2) < 0.5 ? '.-~~-.' : '(__)', p.dim)
  }
  const sway = Math.floor(t / 8) % 2
  for (let x = 0; x < cols; x++) {
    const n = noise(x, 3)
    if (n < 0.4) c.put(x, 2, (sway ? "/|\\,'" : "\\|/,'")[Math.floor(n * 12.5)]!, p.ink)
    c.put(x, 3, "/\\|#%'.,"[Math.floor(noise(x, 4) * 8)]!, p.ground)
  }
  c.clawd(t % 40 < 2 ? BLINK : Math.floor(t / 2) % 2 ? WALK_B : WALK_A, walkerX(cols, t, 2), 1)
}

function night(c: Canvas, t: number) {
  const { cols, p } = c
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < cols; x++) {
      const n = noise(x, y + 10)
      if (n < 0.05) c.put(x, y, (t + Math.floor(n * 400)) % 24 < 3 ? '*' : '.', n < 0.02 ? p.bright : p.dim)
    }
  }
  c.put(Math.min(cols - 1, 6), 0, 'C', p.bright)
  for (let x = 0; x < cols; x++) c.put(x, 3, noise(x, 5) < 0.3 ? ',' : '_', p.dim)
  const x = Math.floor(cols / 3)
  c.clawd(BLINK, x, 1)
  const step = Math.floor(t / 4) % 4
  for (let k = 0; k < step; k++) c.put(x + 11 + k, 2 - k, k === 2 ? 'Z' : 'z', p.bright)
}

function rain(c: Canvas, t: number) {
  const { cols, p } = c
  // Drops fall down-left: x + y is constant along one drop's path.
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < cols; x++) {
      const diag = x + y
      if (noise(diag, 6) < 0.45 && (t + Math.floor(noise(diag, 7) * 6)) % 6 === y) c.put(x, y, '/', p.dim)
    }
  }
  for (let x = 0; x < cols; x++) {
    const n = noise(x, 8)
    c.put(x, 3, n < 0.15 ? ((t >> 2) + x) % 3 === 0 ? 'o' : '~' : '_', p.ground)
  }
  const x = walkerX(cols, t, 3)
  c.clawd(Math.floor(t / 3) % 2 ? WALK_B : WALK_A, x, 2)
  c.sprite(['.uuuuuuuuuu.', 'u....s.....u'], x - 1, 0, { u: 0x4a6a8c, s: p.ink })
}

function sea(c: Canvas, t: number) {
  const { cols, p } = c
  c.fillRow(2, p.water)
  c.fillRow(3, p.water)
  for (let y = 2; y < ROWS; y++) {
    for (let x = 0; x < cols; x++) if ((x + Math.floor(t / 2) + y * 3) % 6 === 0) c.put(x, y, '~', p.foam)
  }
  for (let x = 0; x < 16; x++) c.pixel(x, 5, p.wood)
  c.clawd(WALK_A, 3, 0)
  c.put(14, 0, '/', p.ink)
  c.put(15, 0, '\u00af', p.ink) // ¯
  const bob = Math.floor(t / 6) % 2
  c.put(16, 1, '|', p.ink)
  c.put(16, 2 + bob, 'o', CLAWD, p.water)
  if (bob) c.put(16, 2, '|', p.ink, p.water)
}

function snow(c: Canvas, t: number) {
  const { cols, p } = c
  // Flakes drift down; each column has its own phase.
  for (let x = 0; x < cols; x++) {
    if (noise(x, 60) > 0.25) continue
    const y = (Math.floor(t / 3) + Math.floor(noise(x, 61) * 8)) % 6
    const dx = Math.floor(t / 6 + noise(x, 62) * 4) % 2
    if (y < 3) c.put(x + dx, y, noise(x, 63) < 0.3 ? '*' : '.', p.bright)
  }
  for (let x = 0; x < cols; x++) c.pixel(x, 7, 0xe8e6dc)
  const sx = Math.floor(cols * 0.5)
  c.sprite(['.www.', 'wkwkw', '.www.', 'wwwww', 'wwwww'], sx, 2, { w: 0xf0eee6, k: 0x1f1e1d })
  c.pixel(sx + 5, 3, 0xd97757) // carrot
  c.clawd(Math.floor(t / 2) % 2 ? WALK_B : WALK_A, walkerX(cols, t, 2), 2)
}

function city(c: Canvas, t: number) {
  const { cols, p } = c
  // Skyline with windows that light up and go dark.
  let x = 0
  let b = 0
  while (x < cols) {
    const w = 4 + Math.floor(noise(b, 70) * 6)
    const top = Math.floor(noise(b, 71) * 2)
    for (let y = top; y < 3; y++) {
      for (let i = 0; i < w - 1; i++) {
        const lit = noise(b * 31 + i, y * 7 + Math.floor((t + noise(b, 72) * 60) / 40)) < 0.3
        c.put(x + i, y, lit && i % 2 ? '▄' : ' ', 0xe8c060, p.screen)
      }
    }
    x += w
    b++
  }
  for (let i = 0; i < cols; i++) c.put(i, 3, i % 6 === 0 ? '·' : '_', p.dim)
  c.clawd(Math.floor(t / 2) % 2 ? WALK_B : WALK_A, walkerX(cols, t, 2), 3)
}

function campfire(c: Canvas, t: number) {
  const { cols, p } = c
  for (let x = 0; x < cols; x++) {
    if (noise(x, 80) < 0.03) c.put(x, 0, '.', p.dim)
    c.put(x, 3, noise(x, 81) < 0.2 ? ',' : '_', p.dim)
  }
  const fx = Math.max(16, Math.floor(cols / 3))
  c.sprite(['wwwwwwww'], fx - 4, 7, { w: p.wood })
  // Flames flicker: a random column profile each frame.
  const flame = [0xd97757, 0xe8a33d, 0xf0d060]
  for (let i = 0; i < 6; i++) {
    const h = (i === 0 || i === 5 ? 1 : 3) + Math.floor(noise(i, t) * 3)
    for (let k = 0; k < h; k++) c.pixel(fx - 3 + i, 6 - k, flame[Math.min(2, Math.floor(k / 2))]!)
  }
  for (let s = 0; s < 3; s++) {
    const y = 2 - ((Math.floor(t / 2) + s) % 3)
    c.put(fx - 1 + Math.floor(noise(s, Math.floor(t / 6)) * 3), y, '.', 0xe8a33d)
  }
  c.clawd(t % 30 < 2 ? BLINK : WALK_A, fx - 16, 3)
}

function space(c: Canvas, t: number) {
  const { cols } = c
  // Three layers of stars, the near ones faster.
  for (let i = 0; i < Math.floor(cols / 2); i++) {
    const layer = i % 3
    const y = Math.floor(noise(i, 90) * 4)
    const speed = [1, 2, 4][layer]!
    const x = (Math.floor(noise(i, 91) * cols * 4) - Math.floor((t * speed) / 2)) % cols
    c.put((x + cols) % cols, y, ['.', '·', '*'][layer]!, [0x4a4944, 0x8a877c, 0xf0eee6][layer]!)
  }
  // A planet drifts by, slower than the stars.
  const span = cols + 10
  const px = cols - (Math.floor(t / 6) % span)
  c.sprite(['..pppp..', '.pppppp.', 'rrrrrrrr', '.pppppp.', '..pppp..'], px, 1, { p: 0x9c6ab5, r: 0xc9b37a })
  // Clawd rides a rocket; the flame flickers behind it.
  const x = 8
  c.clawd(WALK_A, x + 2, 0)
  c.sprite(['ff.ggggggggggnn.', '.gggggwwgggggnnn', 'ff.ggggggggggnn.'], x, 5,
    { g: 0xb8b5a8, w: 0x7fb3d9, n: 0xc0392b, f: 0x8a877c })
  const flame = [0xf0d060, 0xe8a33d, 0xd97757]
  const len = 2 + (t % 3)
  for (let i = 0; i < len; i++) c.pixel(x - 1 - i, 6, flame[Math.min(2, i)]!)
  if (t % 2) c.pixel(x - 1, 5, 0xe8a33d)
  else c.pixel(x - 1, 7, 0xe8a33d)
}

// Cozy room: Clawd at a laptop, a mug, a lamp, rain on the window.
function room(c: Canvas, t: number) {
  const { cols, p } = c
  const lampGlow = 0x2a2418
  // Desk with warm light around the lamp.
  for (let x = 0; x < 26; x++) c.put(x, 3, '▀', p.wood)
  for (let y = 0; y < 3; y++) for (let x = 19; x < 26; x++) c.put(x, y, ' ', p.ink, lampGlow)
  c.clawd(Math.floor(t / 2) % 2 ? TYPE_B : WALK_A, 1, 1)
  // Mug with steam.
  c.sprite(['ww.', 'www', 'ww.'], 11, 3, { w: 0xe8e6dc })
  c.put(11 + (Math.floor(t / 4) % 2), 0, '~', p.dim)
  c.put(12 - (Math.floor(t / 4) % 2), 1, '~', p.dim)
  // Laptop, its screen lit.
  for (let x = 14; x < 19; x++) {
    c.put(x, 1, noise(x, Math.floor(t / 3)) < 0.5 ? '-' : ' ', 0x9fb8c9, 0x2f4a5f)
    c.put(x, 2, noise(x + 9, Math.floor(t / 3)) < 0.5 ? '-' : ' ', 0x9fb8c9, 0x2f4a5f)
  }
  for (let x = 13; x < 20; x++) c.pixel(x, 6, p.dim)
  // Lamp.
  c.sprite(['.sss.', 'sssss', '..l..', '..l..', '..l..', '.lll.'], 20, 0, { s: 0xe8a33d, l: p.dim })
  // Window: rain over blurred city lights.
  const wx = 28
  const w = Math.max(10, Math.min(30, cols - wx - 2))
  const pane = 0x18222c
  for (let y = 0; y < 3; y++) {
    for (let x = wx; x < wx + w; x++) {
      const mid = x === wx + (w >> 1)
      if (x === wx || x === wx + w - 1 || mid) c.put(x, y, '│', p.wood, pane) // │
      else if (y === 2 && noise(x, 100) < 0.35) {
        const on = noise(x, Math.floor((t + x * 7) / 30)) < 0.8
        c.put(x, y, '▄', on ? [0xe8c060, 0xd97757, 0x9fb8c9][Math.floor(noise(x, 101) * 3)]! : 0x2a2a2a, pane)
      } else if (noise(x, 102) < 0.5 && (Math.floor(t / 2) + Math.floor(noise(x, 103) * 6)) % 6 === y) {
        c.put(x, y, noise(x, 104) < 0.6 ? '|' : '.', 0x8fb0c8, pane)
      } else c.put(x, y, ' ', p.ink, pane)
    }
  }
  for (let x = wx - 1; x < wx + w + 1; x++) c.put(x, 3, '▀', p.wood) // sill
}

// A train ride: hills and poles slide past the windows.
function train(c: Canvas, t: number) {
  const { cols, p } = c
  const sky = 0x3d5468
  const scroll = t
  for (let x = 0; x < cols; x++) {
    const wall = x % 22 < 3
    for (let y = 0; y < 3; y++) c.put(x, y, ' ', p.ink, wall ? 0x3a3936 : sky)
    if (wall) continue
    const wx = x + scroll
    const h = 2 + Math.floor(noise(Math.floor(wx / 6), 110) * 3) // hills, 2..4 px
    for (let py = 6 - h; py < 6; py++) c.pixel(x, py, 0x4f7a45)
    if (wx % 17 === 0) for (let py = 0; py < 6; py++) c.pixel(x, py, 0x6b6a64) // pole
    if (noise(Math.floor((x + scroll / 4) / 1), 111) < 0.03) c.put(x, 0, '.', p.dim, sky)
  }
  for (let x = 0; x < cols; x++) c.put(x, 3, '▀', 0x5a3e2b) // seats
  c.clawd(t % 40 < 2 ? BLINK : WALK_A, 6, 2)
}

// A lighthouse sweeps its beam over the sea.
function lighthouse(c: Canvas, t: number) {
  const { cols, p } = c
  for (let y = 2; y < ROWS; y++) {
    c.fillRow(y, p.water)
    for (let x = 0; x < cols; x++) if ((x + Math.floor(t / 3) + y * 4) % 7 === 0) c.put(x, y, '~', p.foam)
  }
  for (let x = 0; x < cols; x++) if (noise(x, 120) < 0.04) c.put(x, 0, '.', p.dim)
  // Rocks with Clawd on them.
  for (let x = 0; x < 16; x++) c.pixel(x, 5, 0x4a4944)
  for (let x = 1; x < 14; x++) c.pixel(x, 4, 0x4a4944)
  c.clawd(t % 30 < 2 ? BLINK : WALK_A, 3, 0)
  const lx = Math.max(24, Math.floor(cols * 0.42))
  c.sprite(['.yy.', 'wwww', 'rrrr', 'wwww', 'rrrr', 'wwww', 'kkkk'], lx, 0,
    { y: 0xf0d060, w: 0xf0eee6, r: 0xc0392b, k: 0x4a4944 })
  // The beam alternates sides and fades out.
  const phase = t % 24
  const dir = phase < 12 ? 1 : -1
  const reach = (phase % 12) * 3
  for (let i = 1; i <= reach; i++) {
    const x = dir > 0 ? lx + 4 + i : lx - 1 - i
    c.put(x, 0, '─', i < reach / 2 ? 0xf0d060 : 0x8a7a40)
  }
}

// Fireflies blink between dark trees.
function fireflies(c: Canvas, t: number) {
  const { cols, p } = c
  const tree = 0x1f3a2a
  for (let i = 0; i < Math.ceil(cols / 14); i++) {
    const tx = Math.floor(i * 14 + noise(i, 130) * 8)
    c.sprite(['..t..', '.ttt.', 'ttttt', '.ttt.', 'ttttt', '..b..', '..b..'], tx, 0, { t: tree, b: 0x3a2e24 })
  }
  for (let x = 0; x < cols; x++) c.put(x, 3, noise(x, 131) < 0.3 ? '"' : '_', 0x2f4a2f)
  for (let k = 0; k < Math.floor(cols / 4); k++) {
    const x = Math.floor(noise(k, 132) * cols + Math.sin((t + k * 13) / 9) * 3)
    const y = Math.floor(noise(k, 133) * 3)
    if ((t + k * 5) % 14 < 9) c.put(x, y, '•', (t + k) % 14 < 4 ? 0xf0f070 : 0xa8c050)
  }
  c.clawd(Math.floor(t / 3) % 2 ? WALK_B : WALK_A, walkerX(cols, t, 3), 2)
}

// Work scenes: what Claude is doing right now. `detail` is the tool's target.

function think(c: Canvas, t: number) {
  const { p } = c
  for (let x = 0; x < 16; x++) c.put(x, 3, '_', p.dim)
  c.clawd(t % 30 < 2 ? BLINK : WALK_A, 2, 1)
  c.put(12, 1, '.', p.dim)
  c.put(13, 0, 'o', p.dim)
  const eureka = t % 48 >= 40
  const sym = eureka ? '!' : '?*~#%&'[Math.floor(t / 6) % 6]!
  c.text(15, 0, '(   )', p.dim)
  c.put(17, 0, sym, eureka ? CLAWD : p.bright)
  if (eureka) c.text(15, 1, ' \\|/ ', CLAWD)
}

function shell(c: Canvas, t: number, detail: string) {
  const { cols, p } = c
  const x0 = 14
  const w = Math.max(10, Math.min(Math.floor(cols * 0.5), cols - x0 - 2))
  for (let i = 0; i < x0 + w; i++) c.put(i, 3, '\u2580', p.wood) // desk
  c.clawd(t % 2 ? TYPE_B : WALK_A, 2, 1)
  for (let y = 0; y < 3; y++) c.text(x0, y, ' '.repeat(w), p.ink, p.screen)
  // Wrap the command over up to 3 rows; type it in ~10 ticks.
  const cmd = detail || '$ make it work'
  const room = w - 2
  const lines: string[] = []
  for (let i = 0; i < cmd.length && lines.length < 3; i += room) lines.push(cmd.slice(i, i + room))
  const shownLen = lines.join('').length
  const speed = Math.max(1, Math.ceil(shownLen / 10))
  const typed = Math.min(shownLen, (t % (Math.ceil(shownLen / speed) + 30)) * speed)
  let left = typed
  lines.forEach((line, y) => {
    c.text(x0 + 1, y, line.slice(0, Math.max(0, left)), p.bright, p.screen)
    left -= line.length
  })
  const cy = Math.min(lines.length - 1, Math.floor(typed / room))
  if (typed < shownLen && t % 2) c.put(x0 + 1 + (typed % room), cy, '\u258c', CLAWD, p.screen) // ▌
  // Output scrolls in the rows the command left free.
  if (typed === shownLen) {
    for (let y = lines.length; y < 3; y++) {
      const line = Math.floor(t / 2) + y
      const len = Math.floor(noise(line, 20) * (w - 4))
      let out = ''
      for (let i = 0; i < len; i++) out += noise(line, i) < 0.2 ? ' ' : 'abcdefghik./-=_'[Math.floor(noise(i, line) * 15)]!
      c.text(x0 + 1, y, out, noise(line, 21) < 0.15 ? CLAWD : p.dim, p.screen)
    }
  }
}

function read(c: Canvas, t: number) {
  const { cols, p } = c
  const x0 = 16
  const w = Math.max(10, Math.min(30, cols - x0 - 2))
  for (let y = 0; y < ROWS; y++) {
    c.text(x0, y, ' '.repeat(w), p.dim, p.screen)
    const line = Math.floor(t / 4) + y // scrolls up
    const len = 3 + Math.floor(noise(line, 30) * (w - 5))
    for (let i = 1; i < len; i++) if (noise(line, i + 40) > 0.15) c.put(x0 + i, y, '\u2500', p.dim, p.screen) // ─
  }
  // Magnifier sweeps along the lines.
  const span = w - 3
  const mx = x0 + 1 + (t % span)
  const my = 1 + (Math.floor(t / span) % 2)
  c.put(mx, my, 'O', p.bright, p.screen)
  c.put(mx + 1, my + 1, '\\', p.bright, p.screen)
  c.clawd(t % 30 < 2 ? BLINK : WALK_A, 3, 3)
}

function edit(c: Canvas, t: number) {
  const { cols } = c
  const x0 = 15
  const w = Math.max(8, Math.min(28, cols - x0 - 2)) & ~3
  const perRow = w / 4
  const rows = 6 // pixel rows 2..7
  const total = perRow * rows
  const laid = Math.min(total, Math.floor(t / 2) % (total + 12))
  for (let k = 0; k < laid; k++) {
    const r = Math.floor(k / perRow)
    const i = k % perRow
    const shift = r % 2 ? 2 : 0
    for (let d = 0; d < 3; d++) {
      const x = x0 + i * 4 + shift + d
      if (x < x0 + w) c.pixel(x, 7 - r, (r + i) % 2 ? 0xb5651d : 0x9c4f1a)
    }
  }
  c.clawd(WALK_A, 2, 3)
  // Hammer swings.
  const up = Math.floor(t / 2) % 2 === 0
  c.sprite(up ? ['hh.', '.w.', '.w.'] : ['...', 'www', '..h'], 11, up ? 0 : 3, { h: 0x9a978c, w: 0x8a6a4a })
}

function web(c: Canvas, t: number) {
  const { cols, p } = c
  c.clawd(WALK_A, 2, 3)
  c.sprite(['d...d', '.d.d.', '..s..', '..s..', '.sss.'], 11, 1, { d: p.ink, s: p.dim }) // dish
  const gx = Math.max(20, Math.min(cols - 8, 36))
  for (let i = 0; i < 3; i++) {
    const x = 16 + ((t + i * 7) % Math.max(1, gx - 17))
    c.put(x, 1, ')', i === 0 ? p.bright : p.dim)
  }
  // A small planet.
  c.sprite(['.bbbb.', 'bgbbgb', 'bbggbb', 'bgbbbb', '.bbbb.'], gx, 1, { b: 0x4a6a8c, g: 0x6a8c4a })
  if (t % 21 < 3) c.put(gx + 6, 0, '*', CLAWD)
}

function agent(c: Canvas, t: number) {
  const { cols, p } = c
  for (let x = 0; x < cols; x++) c.put(x, 3, noise(x, 50) < 0.2 ? ',' : '_', p.dim)
  const x = walkerX(cols + 24, t, 2) + 24
  const step = Math.floor(t / 2) % 2
  c.clawd(step ? WALK_B : WALK_A, x, 1)
  for (let k = 1; k <= 3; k++) c.sprite((step + k) % 2 ? MINI_B : MINI_A, x - k * 8, 3, { o: CLAWD, k: p.eye })
}

// Reactions at the end of a turn or a failed tool.

function happy(c: Canvas, t: number) {
  const { cols, p } = c
  for (let x = 0; x < 20; x++) c.put(x, 3, '_', p.dim)
  c.clawd(WALK_A, 4, t % 4 < 2 ? 0 : 2)
  for (let k = 0; k < 6; k++) {
    const x = 1 + Math.floor(noise(k, Math.floor(t / 2)) * 17)
    const y = Math.floor(noise(k + 9, Math.floor(t / 2)) * 3)
    if (noise(x, y) > 0.4) c.put(x, y, k % 2 ? '*' : '+', k % 3 ? CLAWD : p.bright)
  }
  c.text(Math.min(cols - 6, 18), 1, 'done!', p.bright)
}

function oops(c: Canvas, t: number) {
  const { cols, p } = c
  for (let x = 0; x < 20; x++) c.put(x, 3, '_', p.dim)
  const x = 4 + (t % 2) // shiver
  c.clawd(BLINK, x, 1)
  c.pixel(x + 11, 1 + (Math.floor(t / 2) % 4), 0x7fb3d9) // sweat drop
  c.text(Math.min(cols - 5, 18), 1, 'oops', CLAWD)
}

const SCENES: Record<SceneName, (c: Canvas, t: number, detail: string) => void> = {
  meadow, rain, sea, snow, train, night, city, campfire, space, lighthouse, fireflies, room, think, shell, read, edit, web, agent, happy, oops,
}

// "♫ label" on a dark plate in the top-right corner, scrolling when long.
function plate(c: Canvas, label: string, t: number) {
  const width = Math.min(label.length + 4, Math.max(16, Math.floor(c.cols * 0.45)))
  if (width > c.cols - 2) return
  const x0 = c.cols - width - 1
  const room = width - 4
  let shown = label
  if (label.length > room) {
    const loop = label + '   '
    const off = Math.floor(t / 2) % loop.length
    shown = (loop + loop).slice(off, off + room)
  }
  // The plate stays on top of any pixels under it.
  for (let x = x0; x < x0 + width; x++) {
    c.px[x] = null
    c.px[c.cols + x] = null
  }
  c.text(x0, 0, `   ${shown.padEnd(room)} `, c.p.plateText, c.p.plate)
  c.put(x0 + 1, 0, '\u266b', CLAWD, c.p.plate) // ♫
}

export type FrameOptions = {
  label?: string
  palette?: Palette
  detail?: string
  // Wipe from this scene: columns right of progress*cols still show it.
  from?: SceneName
  progress?: number
}

function draw(scene: SceneName, cols: number, t: number, palette: Palette, detail: string): Canvas {
  const c = new Canvas(cols, palette)
  SCENES[scene](c, t, detail)
  return c
}

export function frame(scene: SceneName, cols: number, t: number, o: FrameOptions = {}): string {
  cols = Math.max(1, Math.min(512, cols))
  const palette = o.palette ?? DARK
  const detail = o.detail ?? ''
  const c = draw(scene, cols, t, palette, detail)
  if (o.from && o.from !== scene && (o.progress ?? 1) < 1) {
    const old = draw(o.from, cols, t, palette, '')
    const edge = Math.floor((o.progress ?? 0) * cols)
    for (let x = edge; x < cols; x++) {
      for (let y = 0; y < ROWS; y++) c.cells[y * cols + x] = old.cells[y * cols + x]!
      for (let py = 0; py < PX_ROWS; py++) c.px[py * cols + x] = old.px[py * cols + x] ?? null
    }
  }
  // Caption, except where the scene already shows it.
  if (detail && scene !== 'shell' && c.cols >= 60) {
    const x = Math.max(46, Math.floor(c.cols * 0.55))
    c.text(x, 2, detail.slice(0, c.cols - x - 1), c.p.dim)
  }
  if (o.label) plate(c, o.label, t)
  return c.pack()
}
