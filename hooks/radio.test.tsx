import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { explain, workOf } from './register'
import { TEXT } from './testing'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 11 },
    view: {},
  },
} as const

const RAN = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

const DATA = '/home/test/.local/share/clawd-fm'

type World = {
  stored?: Record<string, unknown>
  files?: Record<string, string>
  collected?: string[]
  mpvSays?: string
  plays?: boolean
  // What bin/lock.py says, in order, the ms before each: another session holds the lock.
  lock?: [number, string][]
}

// Everything beneath the plugin: clock, store, files, settings, and fake mpv, collector and lock.
function world(on: On, w: World = {}) {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/test' })
  const store = new Map(Object.entries(w.stored ?? {}))
  const files = new Map(Object.entries(w.files ?? {}).map(([k, v]) => [`${DATA}/${k}`, v]))
  const spawned: string[][] = []
  const mpvCalls: unknown[][] = []
  let quit = () => {}
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('session.end', async () => ({ sessionId: 'test' }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('settings.read', async () => ({ value: { theme: 'dark' } }))
  on('ui.blit', async () => ({ value: {} }))
  on('store.get', async ($, e) => ({ value: store.get(e.key) }))
  on('store.set', async ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.read', async ($, e) => {
    const text = files.get(e.path)
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', async ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('process.run', async ($, e) => {
    if (e.argv[2]?.endsWith('mpvctl.py')) {
      const { command } = JSON.parse(e.argv[4]!) as { command: unknown[] }
      mpvCalls.push(command)
      if (command[0] === 'quit') quit()
      const data = command[1] === 'audio-pts' ? (w.plays ? 12.5 : null) : command[1] === 'eof-reached' ? false : null
      return { value: { ...RAN, stdout: JSON.stringify({ data, error: 'success' }) } }
    }
    return { value: { ...RAN, stdout: '' } }
  })
  on('process.spawn', async function* ($, e) {
    spawned.push([...e.argv])
    if (e.argv[0] === 'mpv') {
      if (w.mpvSays) {
        yield { stream: 'stderr' as const, text: w.mpvSays }
        return { value: { code: 2, signal: null } }
      }
      await new Promise<void>(resolve => { quit = resolve })
      return { value: { code: 0, signal: null } }
    }
    if (e.argv[2]?.endsWith('lock.py')) {
      for (const [ms, text] of w.lock ?? [[0, 'acquired']]) {
        await clock.sleep(ms)
        yield { stream: 'stdout' as const, text: `${text}\n` }
      }
    } else {
      for (const line of w.collected ?? []) yield { stream: 'stdout' as const, text: `${line}\n` }
    }
    await clock.sleep(600_000)
    return { value: { code: 0, signal: null } }
  })
  const mpvs = () => spawned.filter(a => a[0] === 'mpv')
  const file = (name: string) => files.get(`${DATA}/${name}`)
  const put = (name: string, text: string) => void files.set(`${DATA}/${name}`, text)
  return { clock, spawned, mpvs, mpvCalls, store, file, put }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

const fm = (args = '') => ({
  command: 'fm', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 },
})

test('mpv errors become hints worth acting on', async () => {
  expect(explain('[ytdl_hook] ERROR: Sign in to confirm you’re not a bot')).toContain('/plugin configure clawd-fm@clawd-fm')
  expect(explain('HTTP Error 429: Too Many Requests')).toBe('YouTube rate limit (429)')
  const zen = [
    '[ytdl_hook] yt-dlp: error: unsupported browser specified for cookies: "zen-browser". Supported browsers are: brave, chrome',
    '[ytdl_hook] youtube-dl failed: unexpected error occurred',
    'Failed to recognize file format.',
  ].join('\n')
  expect(explain(zen)).toContain('"zen-browser"')
  expect(explain(zen)).toContain('firefox:/path/to/profile')
  expect(explain('[ffmpeg] something failed badly\nAudio --vid=no')).toBe('something failed badly')
  expect(explain('')).toBeNull()
  expect(explain('Playing: stream\nAO: [pulse] 48000Hz')).toBeNull()
})

test('tool calls pick the work scene and a short caption', async () => {
  expect(workOf('Bash', { command: 'ls /home/mikhail/x\necho 2' })).toEqual({ kind: 'shell', detail: '$ ls ~/x' })
  expect(workOf('Read', { file_path: '/a/b/scenes.ts' })).toEqual({ kind: 'read', detail: 'reading scenes.ts' })
  expect(workOf('Edit', { file_path: '/a/README.md' })).toEqual({ kind: 'edit', detail: 'editing README.md' })
  expect(workOf('WebFetch', { url: 'https://example.com/a/b' })).toEqual({ kind: 'web', detail: 'fetching example.com' })
  expect(workOf('Agent', {})).toEqual({ kind: 'agent', detail: 'helpers at work' })
  expect(workOf('mcp__github__create_issue', {})).toEqual({ kind: 'think', detail: 'using github create_issue' })
})

test('/fm shows the band, a second /fm hides it', async ($, on) => {
  world(on)
  await start($)
  expect((await $.command.run(fm())).text).toBe('Claude FM on: tuning in…')
  const ui = await $.ui.mount({ plugin: 'clawd-fm', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect((await $.command.run(fm())).text).toBe('Claude FM off.')
  await ui.unmount()
})

test('volume starts from the saved one, moves in tens and stays within 0..130', async ($, on) => {
  world(on, { stored: { volume: 70 } })
  await start($)
  expect((await $.command.run(fm('+'))).text).toBe('Claude FM volume 80%.')
  expect((await $.command.run(fm('vol 500'))).text).toBe('Claude FM volume 130%.')
  expect((await $.command.run(fm('vol -3'))).text).toBe('Claude FM volume 0%.')
  expect((await $.command.run(fm('vol 35'))).text).toBe('Claude FM volume 35%.')
  expect((await $.command.run(fm('vol abc'))).text).toBe('Claude FM volume 35%.')
})

test('the band buttons change the volume', async ($, on) => {
  world(on)
  await start($)
  await $.command.run(fm())
  const ui = await $.ui.mount({ plugin: 'clawd-fm', surface: 'terminal', ...BAND })
  await ui.press({ key: 'down' })
  await ui.press({ key: 'down' })
  expect(await ui.find({ text: '30%' })).toBeDefined()
  await ui.press({ key: 'up' })
  expect(await ui.find({ text: '40%' })).toBeDefined()
  await ui.unmount()
})

test('cookies from settings reach yt-dlp through mpv', { options: { cookiesFromBrowser: 'firefox:/p/zen' } }, async ($, on) => {
  const { clock, spawned } = world(on)
  await start($)
  await $.command.run(fm())
  await clock.advance(3000)
  const mpv = spawned.find(a => a[0] === 'mpv')
  expect(mpv).toContain('--ytdl-raw-options=cookies-from-browser=firefox:/p/zen')
  expect(mpv?.at(-1)).toBe('https://www.youtube.com/@claude/live')
  expect(spawned.some(a => a[2]?.endsWith('collect.py'))).toBe(true)
  await $.command.run(fm('stop'))
})

test('without cookies mpv gets no cookie option', async ($, on) => {
  const { clock, spawned } = world(on)
  await start($)
  await $.command.run(fm())
  await clock.advance(3000)
  expect(spawned.find(a => a[0] === 'mpv')?.some(a => a.includes('cookies'))).toBe(false)
  await $.command.run(fm('stop'))
})

test('a failing mpv leaves its reason in the band', async ($, on) => {
  const { clock } = world(on, {
    mpvSays: '[ytdl_hook] yt-dlp: error: unsupported browser specified for cookies: "zen". Supported browsers are: firefox\n',
  })
  await start($)
  await $.command.run(fm())
  await clock.advance(3000)
  const ui = await $.ui.mount({ plugin: 'clawd-fm', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /yt-dlp does not know the browser "zen".*retrying/ })).toBeDefined()
  await ui.unmount()
  await $.command.run(fm('stop'))
})

test('a playing stream shows the track the collector heard', async ($, on) => {
  const { clock } = world(on, { plays: true, collected: ['not json', '{"artist":"Joya","title":"Sunday"}'] })
  await start($)
  await $.command.run(fm())
  await clock.advance(3000)
  await clock.advance(3000)
  // Too short for the scene: the name goes into the text line.
  const ui = await $.ui.mount({ plugin: 'clawd-fm', surface: 'terminal', ...BAND, props: { ...BAND.props, maxRows: 2 } })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ text: '♫ Joya — Sunday' })).toBeDefined()
  await ui.unmount()
  await $.command.run(fm('stop'))
})

test('/fm list numbers the tracks in the order heard, with search links', async ($, on) => {
  world(on, {
    files: {
      'tracks.json': JSON.stringify([
        { artist: 'Joya', title: 'Sunday', first_seen: '2026-10-14T12:00:00' },
        { artist: 'Astor', title: '01 - Drift', first_seen: '2026-10-13T09:00:00' },
      ]),
    },
  })
  await start($)
  const lines = (await $.command.run(fm('list'))).text!.split('\n')
  expect(lines[0]).toBe('Claude FM: 2 tracks heard')
  expect(lines[1]).toStartWith('1. Astor — 01 - Drift  https://open.spotify.com/search/Astor%20Drift')
  expect(lines[2]).toStartWith('2. Joya — Sunday')
})

test('/fm list before anything was heard says so', async ($, on) => {
  world(on)
  await start($)
  expect((await $.command.run(fm('list'))).text).toBe('No tracks yet: they are collected while Claude FM plays.')
})

test('while another terminal plays, this one starts no mpv and shows its track', async ($, on) => {
  const { clock, mpvs, file } = world(on, { lock: [[0, 'busy']], files: { 'now.json': '{"artist":"Joya","title":"Sunday"}' } })
  await start($)
  await $.command.run(fm())
  await clock.advance(3000)
  await clock.advance(3000)
  expect(mpvs()).toHaveLength(0)
  const ui = await $.ui.mount({ plugin: 'clawd-fm', surface: 'terminal', ...BAND, props: { ...BAND.props, maxRows: 2 } })
  expect(await ui.find({ text: '♫ Joya — Sunday · playing in another terminal' })).toBeDefined()
  expect((await ui.find({ key: 'play' }))?.text).toContain('stop')
  // Hiding a waiting terminal leaves the playing one alone.
  await $.command.run(fm('hide'))
  expect(file('stopped-at')).toBeUndefined()
  await ui.unmount()
})

test('a waiting terminal takes the stream over when the playing one closes', async ($, on) => {
  const { clock, mpvs } = world(on, { lock: [[0, 'busy'], [10_000, 'acquired']] })
  await start($)
  await $.command.run(fm())
  await clock.advance(3000)
  expect(mpvs()).toHaveLength(0)
  await clock.advance(12_000)
  expect(mpvs()).toHaveLength(1)
  await $.command.run(fm('stop'))
})

test('the playing terminal shares the track it hears', async ($, on) => {
  const { clock, file } = world(on, { plays: true, collected: ['{"artist":"Astor","title":"Forest Park"}'] })
  await start($)
  await $.command.run(fm())
  await clock.advance(3000)
  expect(JSON.parse(file('now.json')!)).toEqual({ artist: 'Astor', title: 'Forest Park' })
  await $.command.run(fm('stop'))
})

test('after a restart the same track is shared again', async ($, on) => {
  const { clock, file } = world(on, { plays: true, collected: ['{"artist":"Astor","title":"Forest Park"}'] })
  await start($)
  await $.command.run(fm())
  await clock.advance(3000)
  await $.command.run(fm('stop'))
  await clock.advance(1)
  // Playing again: the lock clears now.json, the collector hears the same track.
  await $.command.run(fm('play'))
  await clock.advance(3000)
  expect(JSON.parse(file('now.json')!)).toEqual({ artist: 'Astor', title: 'Forest Park' })
  await $.command.run(fm('stop'))
})

test('a stop in any terminal stops the player everywhere', async ($, on) => {
  const { clock, mpvCalls, file, put } = world(on, { plays: true })
  await start($)
  await $.command.run(fm())
  await clock.advance(3000)
  expect(mpvCalls).not.toContainEqual(['quit'])
  // Another terminal pressed stop.
  put('stopped-at', String(clock.now()))
  await clock.advance(3000)
  expect(mpvCalls).toContainEqual(['quit'])
  const ui = await $.ui.mount({ plugin: 'clawd-fm', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'play' }))?.text).toContain('play')
  await ui.unmount()
  // And this terminal's own stop is left for the others.
  await $.command.run(fm())
  await clock.advance(3000)
  await $.command.run(fm('stop'))
  expect(Number(file('stopped-at'))).toBe(clock.now())
})

test('a volume set in another terminal reaches the player', async ($, on) => {
  const { clock, mpvCalls, store } = world(on, { plays: true })
  await start($)
  await $.command.run(fm())
  await clock.advance(3000)
  store.set('volume', 20)
  await clock.advance(3000)
  expect(mpvCalls).toContainEqual(['set_property', 'volume', 20])
  const ui = await $.ui.mount({ plugin: 'clawd-fm', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: '20%' })).toBeDefined()
  await ui.unmount()
  await $.command.run(fm('stop'))
})

// What the band's scene shows as text, mounted wide enough for captions.
async function caption($: Engine) {
  const ui = await $.ui.mount({ plugin: 'clawd-fm', surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns: 120 } })
  const raster = await ui.find({ type: 'Raster' })
  await ui.unmount()
  return TEXT(String(raster?.props.cells ?? ''))
}

// A call from a subagent's loop: the engine stamps agentId, a test passes it.
const fromAgent = ($: Engine, agentId: string, input: Record<string, unknown>) =>
  $.tool.call({ tool_use_id: `u-${agentId}`, ...input, agentId } as never)

function answering(on: On) {
  on('tool.call', async () => ({ result: 'ok' as never, text: 'ok' }))
  on('turn.complete', async () => ({ text: '' }))
}

const turnEnd = (agentId?: string) => ({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' as const, agentId })

test('a subagent at work shows as a helper, not as Clawd himself', async ($, on) => {
  world(on)
  answering(on)
  await start($)
  await $.command.run(fm())
  await fromAgent($, 'sub-1', { tool: 'Read', file_path: '/tmp/notes.txt' })
  // The caption's shimmer skips spaces, so the scene shows through them.
  expect(await caption($)).toMatch(/helper.{3}reading notes\.txt/)
  await fromAgent($, 'sub-2', { tool: 'Grep', pattern: 'law' })
  expect(await caption($)).toMatch(/2 helpers.{3}grep law/)
  // Its turn ends: no jump for Clawd, the other helper still shows.
  await $.turn.complete(turnEnd('sub-2'))
  const text = await caption($)
  expect(text).not.toContain('done!')
  expect(text).toMatch(/[^2] helper.{3}reading notes\.txt/)
  await $.command.run(fm('stop'))
})

test('the main loop\'s own work still shows as Clawd at work', async ($, on) => {
  world(on)
  answering(on)
  await start($)
  await $.command.run(fm())
  await fromAgent($, 'sub-1', { tool: 'Read', file_path: '/tmp/notes.txt' })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'u2', file_path: '/tmp/main.ts', old_string: 'a', new_string: 'b' })
  const text = await caption($)
  expect(text).toContain('editing main.ts')
  expect(text).not.toContain('helper')
  await $.command.run(fm('stop'))
})
