import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { explain, workOf } from './register'

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

type World = { stored?: Record<string, unknown>; tracks?: string; collected?: string[]; mpvSays?: string; plays?: boolean }

// Everything beneath the plugin: clock, store, settings, and fake mpv and collector.
function world(on: On, w: World = {}) {
  const clock = mock.clock(on)
  mock.store(on, w.stored)
  mock.env(on, { HOME: '/home/test' })
  const spawned: string[][] = []
  const mpvCalls: unknown[][] = []
  let quit = () => {}
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('session.end', async () => ({ sessionId: 'test' }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('settings.read', async () => ({ value: { theme: 'dark' } }))
  on('ui.blit', async () => ({ value: {} }))
  on('fs.read', async ($, e) => {
    return w.tracks === undefined ? { deny: `ENOENT: ${e.path}` } : { value: w.tracks }
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
    for (const line of w.collected ?? []) yield { stream: 'stdout' as const, text: `${line}\n` }
    await clock.sleep(600_000)
    return { value: { code: 0, signal: null } }
  })
  return { clock, spawned, mpvCalls }
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
    tracks: JSON.stringify([
      { artist: 'Joya', title: 'Sunday', first_seen: '2026-10-14T12:00:00' },
      { artist: 'Astor', title: '01 - Drift', first_seen: '2026-10-13T09:00:00' },
    ]),
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
