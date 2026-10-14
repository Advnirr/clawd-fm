import { atom, read, update } from 'claude-code'
import type { EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult, Register } from 'claude-code'

import type { Status, Track } from '../types'
import { DARK, DAY_SCENES, frame, LIGHT, NIGHT_SCENES, ROWS } from './scenes'
import type { Palette, SceneName, WorkName } from './scenes'

const STREAM = 'https://www.youtube.com/@claude/live'
const TICK_MS = 250

const isShown = atom({ plugin: 'clawd-fm', key: 'isShown' } as const, false)
const status = atom({ plugin: 'clawd-fm', key: 'status' } as const, 'off' as Status)
const error = atom({ plugin: 'clawd-fm', key: 'error' } as const, null as string | null)
const volume = atom({ plugin: 'clawd-fm', key: 'volume' } as const, 50)
const track = atom({ plugin: 'clawd-fm', key: 'track' } as const, null as Track | null)
const scene = atom({ plugin: 'clawd-fm', key: 'scene' } as const, 0)

type Child = HookStream<ProcessSpawnChunk, ProcessSpawnResult>

let cookies = ''
let player: Child | null = null
let collector: Child | null = null
let socket = ''
let framesDir = ''
let home = '/tmp'
let volumeNow = 50
// Mirrors of the band, for the animation timer.
const band = { id: '', cols: 0, scene: 'meadow' as SceneName, working: false, tick: 0, label: '', palette: DARK as Palette }
// What Claude is doing now, from tool calls.
type Activity = { kind: WorkName; detail: string; isDone: boolean; shownAt: number | null }
// Each work scene stays at least this many ticks, so quick tools are still seen.
const HOLD_TICKS = 16
let queue: Activity[] = []

function currentWork(): Activity | undefined {
  while (queue.length > 1 || queue[0]?.isDone) {
    const head = queue[0]!
    if (!head.isDone || head.shownAt === null || band.tick - head.shownAt < HOLD_TICKS) break
    queue.shift()
  }
  const head = queue[0]
  if (head && head.shownAt === null) head.shownAt = band.tick
  return head
}

// Scene changes wipe in over WIPE_TICKS.
const WIPE_TICKS = 6
const wipe = { scene: 'meadow' as SceneName, from: 'meadow' as SceneName, at: -WIPE_TICKS }

function bandFrame(cols: number): string {
  const act = currentWork()
  const scene = act?.kind ?? (band.working ? 'think' : band.scene)
  if (scene !== wipe.scene) {
    wipe.from = wipe.scene
    wipe.scene = scene
    wipe.at = band.tick
  }
  const progress = (band.tick - wipe.at) / WIPE_TICKS
  return frame(scene, cols, band.tick, {
    label: band.label, palette: band.palette, detail: act?.detail ?? '', from: wipe.from, progress,
  })
}

// A short reaction scene, shown after whatever is queued.
function react(kind: 'happy' | 'oops') {
  if (queue.some(a => a.kind === kind && a.shownAt === null)) return
  queue.push({ kind, detail: '', isDone: true, shownAt: null })
}

function base(path: unknown): string {
  return String(path ?? '').split('/').pop() ?? ''
}

function workOf(tool: string, input: Record<string, unknown>): { kind: WorkName; detail: string } {
  const firstLine = (v: unknown) => String(v ?? '').split('\n')[0]!.slice(0, 240)
  switch (tool) {
    case 'Bash': return { kind: 'shell', detail: `$ ${firstLine(input.command).replace(/\/home\/[^/\s]+/g, '~')}` }
    case 'Read': return { kind: 'read', detail: `reading ${base(input.file_path)}` }
    case 'Grep': return { kind: 'read', detail: `grep ${firstLine(input.pattern)}` }
    case 'Glob': return { kind: 'read', detail: `glob ${firstLine(input.pattern)}` }
    case 'Edit': return { kind: 'edit', detail: `editing ${base(input.file_path)}` }
    case 'Write': return { kind: 'edit', detail: `writing ${base(input.file_path)}` }
    case 'NotebookEdit': return { kind: 'edit', detail: `editing ${base(input.notebook_path)}` }
    case 'WebSearch': return { kind: 'web', detail: `searching: ${firstLine(input.query)}` }
    case 'WebFetch': return { kind: 'web', detail: `fetching ${firstLine(input.url).replace(/^https?:\/\//, '').split('/')[0]}` }
    case 'Agent':
    case 'Task': return { kind: 'agent', detail: firstLine(input.description) || 'helpers at work' }
    default: return { kind: 'think', detail: `using ${tool.replace(/^mcp__/, '').replace(/__/g, ' ')}` }
  }
}

async function mpv($: EngineInterface, command: unknown[]) {
  if (!socket) return null
  const r = await $.process.run(
    ['python3', '-I', `${$.plugin.root}/bin/mpvctl.py`, socket, JSON.stringify({ command })],
    { timeoutMs: 3000 },
  ).catch(() => null)
  try {
    return r ? (JSON.parse(r.stdout) as { data?: unknown; error: string }) : null
  } catch {
    return null
  }
}

// Presses and commands only flip `want`; the watchdog does the slow work.
let want = false
let retryAt = 0
let backoff = 5000

function play() {
  want = true
  retryAt = 0
}

async function stop($: EngineInterface) {
  want = false
  await kill($)
  await update($, status, () => 'off')
  await update($, error, () => null)
}

async function kill($: EngineInterface) {
  const child = player
  player = null
  stopCollector()
  if (child) {
    await mpv($, ['quit'])
    void child.return(undefined as never)
  }
}

// Same filter as MPV_VF in bin/collect.py: plate frames, ready for OCR.
const PLATE_VF = 'lavfi=[fps=2,scale=1280:720,crop=280:32:955:30,scale=iw*4:ih*4:flags=lanczos,negate,format=gray]'

// One stream does both: mpv plays the audio and drops plate frames for the collector.
function launch($: EngineInterface) {
  const id = Math.random().toString(36).slice(2, 10)
  socket = `/tmp/clawd-fm-${id}.sock`
  const sock = socket
  const frames = `/tmp/clawd-fm-${id}`
  const argv = [
    'mpv', '--quiet', '--msg-level=all=warn', '--no-input-terminal', '--term-osd=no',
    `--input-ipc-server=${sock}`, `--volume=${volumeNow}`,
    '--ytdl-format=95/best[height<=720]/best', '--hwdec=auto-copy-safe',
    '--vo=image', '--vo-image-format=png', `--vo-image-outdir=${frames}`, `--vf=${PLATE_VF}`,
    '--cache=yes', '--cache-secs=30', '--demuxer-readahead-secs=20',
  ]
  if (cookies) argv.push(`--ytdl-raw-options=cookies-from-browser=${cookies}`)
  argv.push(STREAM)
  const child = $.process.spawn({ argv })
  player = child
  framesDir = frames
  void (async () => {
    // mpv prints only warnings and errors; keep the tail to explain a failure.
    let said = ''
    try {
      for await (const { text } of child) said = (said + text).slice(-4000)
      await child.result
    } catch (err) {
      said += `\nmpv: ${String(err)}`
    }
    const why = explain(said)
    if (why) await update($, error, () => why)
    await $.process.run(['rm', '-rf', sock, frames]).catch(() => null)
    if (player === child) {
      player = null
      stopCollector()
    }
  })()
  startCollector($)
}

// Turns mpv's last words into something to act on.
function explain(said: string): string | null {
  if (/Sign in to confirm/i.test(said)) {
    return 'YouTube asks to sign in: set "Cookies from browser" in /plugin configure clawd-fm'
  }
  if (/429|Too Many Requests/i.test(said)) return 'YouTube rate limit (429)'
  const last = said.split('\n').map(l => l.trim()).filter(l => /error|fail/i.test(l)).pop()
  return last ? last.replace(/^\[[^\]]+\]\s*/, '').slice(0, 120) : null
}

// Runs every few seconds: starts, checks and restarts the player.
async function watchdog($: EngineInterface) {
  if (!want) return
  const now = await $.clock.now()
  if (!player) {
    if (now < retryAt) return
    await update($, status, () => 'loading')
    retryAt = now + backoff
    backoff = Math.min(backoff * 2, 120_000)
    launch($)
    return
  }
  if (!collector) startCollector($)
  const pts = await mpv($, ['get_property', 'audio-pts'])
  const eof = await mpv($, ['get_property', 'eof-reached'])
  if (eof?.data === true) {
    // The stream dropped (often a 429); retry after the backoff.
    await kill($)
    return
  }
  if (typeof pts?.data === 'number') {
    backoff = 5000
    if ((await read($, status)) !== 'playing') {
      await update($, status, () => 'playing')
      await update($, error, () => null)
    }
  }
}

function startCollector($: EngineInterface) {
  const argv = [
    'python3', '-u', `${$.plugin.root}/bin/collect.py`, '--now', '--frames-dir', framesDir,
    '--out', `${home}/.local/share/clawd-fm/tracks.json`,
  ]
  const child = $.process.spawn({ argv })
  collector = child
  void (async () => {
    let buf = ''
    try {
      for await (const { stream, text } of child) {
        if (collector !== child) break
        if (stream !== 'stdout') continue
        buf += text
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          try {
            const now = JSON.parse(line) as Track
            const prev = await read($, track)
            // A corrected name of the same track keeps the scene.
            const isSame = prev !== null && prev.title.slice(0, 8) === now.title.slice(0, 8)
            await update($, track, () => now)
            // Next scene in turn, so none repeats before all were shown.
            if (!isSame) await update($, scene, n => n + 1)
          } catch { /* not a track line */ }
        }
      }
    } catch { /* collector died; the watchdog restarts it */ }
    if (collector === child) collector = null
  })()
}

function stopCollector() {
  const child = collector
  collector = null
  if (child) void child.return(undefined as never)
}

async function setVolume($: EngineInterface, to: (v: number) => number) {
  const v = Math.max(0, Math.min(130, Math.round(to(await read($, volume)))))
  volumeNow = v
  await update($, volume, () => v)
  await $.store.set('volume', v)
  await mpv($, ['set_property', 'volume', v])
}

export const register: Register = (on, options) => {
  cookies = String(options.cookiesFromBrowser ?? '')

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'fm',
      description: 'Claude FM: show the radio band and play (again to stop and hide)',
      argumentHint: '[play|stop|hide|vol N|+|-|scene|list]',
    })
    home = (await $.env.get('HOME')) ?? '/tmp'
    const saved = await $.store.get('volume')
    if (typeof saved === 'number') {
      volumeNow = saved
      await update($, volume, () => saved)
    }
    // A reload kills the old mpv; bring it back.
    if ((await read($, status)) !== 'off') play()
    $.clock.every(3000, () => void watchdog($))
    const { theme } = await $.settings.read()
    band.palette = String(theme ?? '').includes('light') ? LIGHT : DARK
    $.clock.every(TICK_MS, () => {
      if (!band.id || band.cols <= 0) return
      band.tick++
      void $.ui.blit({ requestId: band.id, key: 'scene', cells: bandFrame(band.cols) })
    })
    return next(e)
  })

  on('command.run', { command: 'fm' }, async ($, e) => {
    const [cmd = '', value = ''] = e.args.trim().split(/\s+/)
    const shown = await read($, isShown)
    if (cmd === 'stop') {
      await stop($)
      return { text: 'Claude FM stopped.' }
    }
    if (cmd === 'hide' || (!cmd && shown)) {
      await stop($)
      await update($, isShown, () => false)
      return { text: 'Claude FM off.' }
    }
    if (cmd === '+' || cmd === '-' || cmd === 'vol') {
      const n = Number(value)
      await setVolume($, v => (cmd === '+' ? v + 10 : cmd === '-' ? v - 10 : Number.isFinite(n) ? n : v))
      return { text: `Claude FM volume ${volumeNow}%.` }
    }
    if (cmd === 'list') return { text: await trackList($) }
    if (cmd === 'scene') {
      await update($, scene, n => n + 1)
      return { text: 'Next scene.' }
    }
    await update($, isShown, () => true)
    play()
    return { text: 'Claude FM on: tuning in…' }
  })

  // Watch tools only to pick the work scene; never changes the call.
  on('tool.call', async ($, e, next) => {
    const act: Activity = { ...workOf(String(e.tool), e as unknown as Record<string, unknown>), isDone: false, shownAt: null }
    queue.push(act)
    if (queue.length > 4) queue.splice(1, 1) // keep the backlog short
    try {
      const result = await next(e)
      const r = result as { isError?: boolean; deny?: string }
      if (r.isError || r.deny) react('oops')
      return result
    } finally {
      act.isDone = true
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.reason === 'answer') react('happy')
    else if (e.reason === 'error') react('oops')
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await stop($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey || !(await read($, isShown))) {
      band.id = ''
      return next(e)
    }
    const { Box, Button, Raster, Text } = $.ui.resolve(e)
    const [st, err, vol, now, idx] = await Promise.all([
      read($, status), read($, error), read($, volume), read($, track), read($, scene),
    ])
    const cols = e.props.bodyColumns
    band.id = e.requestId
    band.cols = cols
    band.scene = idleScene(idx)
    band.working = e.props.isWorking
    const hasScene = e.props.maxRows >= ROWS + 2
    if (!hasScene) band.cols = 0

    const name = now ? `${now.artist} — ${now.title}` : ''
    const note = st === 'loading' ? (err ? `${err} · retrying` : 'tuning in…')
      : st === 'error' ? `error: ${err ?? 'unknown'}`
      : st === 'off' ? 'off air'
      : name ? '' : 'listening for the track name…'
    band.label = st === 'playing' ? name : ''
    const isOn = st === 'playing' || st === 'loading'

    return (
      <Box flexDirection="column">
        {hasScene && (
          <Raster
            key="scene"
            columns={cols}
            rows={ROWS}
            cells={bandFrame(cols)}
          />
        )}
        <Box>
          <Text> </Text>
          <Button key="play" hotkey="p" plain onPress={() => void (want ? stop($) : play())}>
            {isOn ? '■ stop' : '▶ play'}
          </Button>
          <Text dimColor>{'   '}</Text>
          <Button key="down" hotkey="j" plain onPress={() => void setVolume($, v => v - 10)}>−</Button>
          <Text> {vol}% </Text>
          <Button key="up" hotkey="k" plain onPress={() => void setVolume($, v => v + 10)}>+</Button>
          <Text dimColor>{'   '}</Text>
          <Button key="scene" hotkey="s" plain onPress={() => void update($, scene, n => n + 1)}>
            scene <Text dimColor>›</Text>
          </Button>
          <Text dimColor wrap="truncate-end">
            {'   '}{hasScene ? note : note || `♫ ${name}`}
          </Text>
        </Box>
      </Box>
    )
  })
}

// Every track heard so far, with a Spotify search link each.
async function trackList($: EngineInterface): Promise<string> {
  let tracks: (Track & { first_seen: string })[] = []
  try {
    tracks = JSON.parse(await $.fs.read(`${home}/.local/share/clawd-fm/tracks.json`))
  } catch {
    return 'No tracks yet: they are collected while Claude FM plays.'
  }
  tracks.sort((a, b) => a.first_seen.localeCompare(b.first_seen))
  const lines = tracks.map((t, i) => {
    const query = `${t.artist} ${t.title.replace(/^\d+\s*-\s*/, '')}`
    return `${i + 1}. ${t.artist} — ${t.title}  https://open.spotify.com/search/${encodeURIComponent(query)}`
  })
  return [`Claude FM: ${tracks.length} tracks heard`, ...lines].join('\n')
}

// Day scenes from 7:00 to 20:00, night scenes otherwise.
function idleScene(idx: number): SceneName {
  const hour = new Date().getHours()
  const pool = hour >= 7 && hour < 20 ? DAY_SCENES : NIGHT_SCENES
  return pool[idx % pool.length] ?? 'meadow'
}
