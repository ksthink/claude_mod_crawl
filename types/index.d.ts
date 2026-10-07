export type Row = { path: string; name: string; depth: number; isDir: boolean; isOpen: boolean }

declare module 'claude-code' {
  interface PluginState {
    'omok-explorer': { open: string[]; rows: Row[]; width: number; busy: boolean; tick: number; top: number; pos: { x: number; dir: number; hold: number } }
  }
}
