import { expect, test } from 'claude-code/testing'

import { frame, IDLE_SCENES, ROWS } from './scenes'

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

test('every scene packs one cell per column and row', async () => {
  for (const scene of [...IDLE_SCENES, 'think', 'shell', 'read', 'edit', 'web', 'agent'] as const) {
    for (const cols of [1, 37, 120]) {
      for (const t of [0, 7, 1000]) {
        const b64 = frame(scene, cols, t, { label: 'Artist — Title', detail: '$ npm test' })
        // 12 bytes per cell, base64 is 4 chars per 3 bytes.
        expect(b64.length).toBe((cols * ROWS * 12 * 4) / 3)
      }
    }
  }
})

test('the band stays out of the way until /fm', async ($, on) => {
  // Stands for the engine's own empty band.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  const ui = await $.ui.mount({ plugin: 'clawd-fm', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(await ui.find({ key: 'scene' })).toBeUndefined()
  await ui.unmount()
})
