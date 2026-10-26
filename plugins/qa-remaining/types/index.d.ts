/** The row picked up for a move: its list (a group name, or the to-do list) and its key. */
export type Picked = { list: string; key: string } | null

declare module 'claude-code' {
  interface PluginState {
    'qa-remaining': { stamp: number; picked: Picked }
  }
}
