export type Track = { artist: string; title: string }

export type Status = 'off' | 'loading' | 'playing' | 'error'

declare module 'claude-code' {
  interface PluginState {
    'clawd-fm': {
      isShown: boolean
      status: Status
      error: string | null
      volume: number
      track: Track | null
      scene: number
    }
  }
}
