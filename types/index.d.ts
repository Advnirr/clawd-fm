export type Track = { artist: string; title: string }

// remote: another session plays the stream; this one shows its track.
export type Status = 'off' | 'loading' | 'playing' | 'error' | 'remote'

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
