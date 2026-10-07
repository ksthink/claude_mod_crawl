// crawl: Clawd as pixel art, 12 columns by 9 rows, drawn at half size: one terminal column per pixel,
// two pixel rows per terminal row (half blocks). Taken from claude.dev/shared/img/clawd-mark.png.
// # body, E eye, e shut eye, h happy eye, x dizzy eye, . empty.

export const SP = ' '
export const BODY_COLOR = '#FF3B1D'
const DARK = '#141413'

export const CHAR_COLS = 12
export const CHAR_ROWS = 5
export const BUBBLE_COLS = 3

// What crawl is doing, picked from what Claude is doing.
export type Mood = 'rest' | 'think' | 'read' | 'edit' | 'run' | 'web' | 'agent' | 'error' | 'done'
export const MOODS: Mood[] = ['rest', 'think', 'read', 'edit', 'run', 'web', 'agent', 'error', 'done']

export const moodOf = (tool: string): Mood =>
  /^(Read|Glob|Grep|LS|NotebookRead)$/.test(tool)
    ? 'read'
    : /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)
      ? 'edit'
      : /^(Bash|BashOutput|KillShell|PowerShell)$/.test(tool)
        ? 'run'
        : /^(WebFetch|WebSearch)$/.test(tool) || tool.startsWith('mcp__')
          ? 'web'
          : /^(Agent|Task|Workflow)$/.test(tool)
            ? 'agent'
            : 'think'

// Columns crawl moves per step in each mood; 0 stays put.
export const SPEED: Record<Mood, number> = {
  rest: 1,
  think: 0,
  read: 1,
  edit: 2,
  run: 3,
  web: 0,
  agent: 0,
  error: 0,
  done: 0,
}

const face = (eyes: string, brow = '..########..') => [brow, eyes, '############', '############', '..########..', '..########..']
const BODY = face('..#E####E#..')
const SHUT = face('..#e####e#..')
const LOOK_L = face('..E####E##..')
const LOOK_R = face('..##E####E..')
const UP = face('..########..', '..#E####E#..')
const HAPPY = face('..#h####h#..')
const DIZZY = face('..#x####x#..')

const LEGS = '..#.#..#.#..'
const STRIDE_A = '.#.#....#.#.'
const STRIDE_B = '...#.##.#...'
const TUCK = '...#.##.#...'
const GAP = '............'

const shift = (art: string[], d: number) =>
  art.map(row => (d < 0 ? row.slice(-d) + '.'.repeat(-d) : '.'.repeat(d) + row.slice(0, row.length - d)))

const stand = (body: string[], legs = LEGS) => [GAP, GAP, ...body, legs]
const hop = (body: string[], legs = LEGS) => [GAP, ...body, legs, GAP]

const FRAMES: Record<Mood, (dir: number) => string[][]> = {
  // Squatting, blinking now and then.
  rest: () => [stand(BODY), stand(BODY), stand(BODY), stand(SHUT)],
  // Looks up, then left and right, pondering.
  think: () => [stand(UP), stand(UP), stand(LOOK_L), stand(LOOK_R)],
  // Walks along with eyes on the way ahead, scanning.
  read: dir => {
    const eyes = dir < 0 ? LOOK_L : LOOK_R
    return [STRIDE_A, LEGS, STRIDE_B, LEGS].map(legs => stand(eyes, legs))
  },
  // Stomps, one leg pair up then the other.
  edit: () => [
    [GAP, ...BODY, '..#.#..#.#..', '.......#.#..'],
    [...BODY, LEGS, LEGS, GAP],
    [GAP, ...BODY, '..#.#..#.#..', '..#.#.......'],
    [...BODY, LEGS, LEGS, GAP],
  ],
  // Runs: hopping strides, eyes forward.
  run: dir => {
    const eyes = dir < 0 ? LOOK_L : LOOK_R
    return [hop(eyes, STRIDE_A), stand(eyes, LEGS), hop(eyes, STRIDE_B), stand(eyes, LEGS)]
  },
  // Stares up and away, on tiptoe.
  web: () => [stand(UP), hop(UP, TUCK), stand(UP), stand(LOOK_R)],
  // Sways side to side, calling friends.
  agent: () => [shift(stand(BODY), -1), stand(BODY), shift(stand(BODY), 1), stand(BODY)],
  // Shakes with dizzy eyes.
  error: () => [shift(stand(DIZZY), -1), shift(stand(DIZZY), 1)],
  // Jumps for joy.
  done: () => [stand(HAPPY), [...HAPPY, TUCK, GAP, GAP], hop(HAPPY), stand(HAPPY)],
}

const BUBBLES: Record<Mood, string[]> = {
  rest: [''],
  think: ['.', '..', '...'],
  read: [''],
  edit: ['', '*'],
  run: [''],
  web: ['?', ' ?'],
  agent: ['+', '++'],
  error: ['!', '!!'],
  done: ['♪', ' ♪'],
}

export const frame = (mood: Mood, tick: number, dir: number) => {
  const frames = FRAMES[mood](dir)
  return frames[tick % frames.length]
}

export const bubble = (mood: Mood, tick: number) => {
  const b = BUBBLES[mood]
  return b[tick % b.length].padEnd(BUBBLE_COLS, SP)
}

const PX: Record<string, string | undefined> = { '#': BODY_COLOR, E: DARK, '.': undefined }
const GLYPH: Record<string, string> = { e: '▁', h: '^', x: '×' }

export type Span = { text: string; fg?: string; bg?: string }

// Pairs pixel rows into terminal rows: top pixel as the upper half block, bottom as the lower.
export const paint = (art: string[]): Span[][] => {
  const px = art.length % 2 ? [...art, GAP] : art
  const out: Span[][] = []
  for (let y = 0; y < px.length; y += 2) {
    const line: Span[] = []
    for (let x = 0; x < px[y].length; x++) {
      const a = px[y][x]
      const b = px[y + 1][x]
      const g = GLYPH[a] ?? GLYPH[b]
      const t = PX[a]
      const u = PX[b]
      const cell: { ch: string; fg?: string; bg?: string } = g
        ? { ch: g, fg: DARK, bg: BODY_COLOR }
        : t === u
          ? { ch: SP, bg: t }
          : !t
            ? { ch: '▄', fg: u }
            : !u
              ? { ch: '▀', fg: t }
              : { ch: '▀', fg: t, bg: u }
      const last = line[line.length - 1]
      if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.ch
      else line.push({ text: cell.ch, fg: cell.fg, bg: cell.bg })
    }
    out.push(line)
  }
  return out
}

// One random step: stand still, start walking either way, turn around, or stop and hold for a few ticks.
// With `steady`, never stands or stops: keeps going and only turns at the edges or now and then.
export const stepPos = (p: { x: number; dir: number; hold: number }, max: number, speed: number, steady = false) => {
  let { dir } = p
  const x = Math.min(p.x, max)
  if (!steady && p.hold > 0) return { x, dir: 0, hold: p.hold - 1 }
  const r = Math.random()
  if (dir === 0) {
    if (!steady && r >= 0.5) return { x, dir: 0, hold: 0 }
    dir = Math.random() < 0.5 ? -1 : 1
  } else if (!steady && r < 0.15) return { x, dir: 0, hold: 1 + Math.floor(Math.random() * 5) }
  else if (r < (steady ? 0.1 : 0.25)) dir = -dir
  let nx = x + dir * speed
  if (nx < 0 || nx > max) {
    dir = -dir
    nx = x + dir * speed
  }
  return { x: Math.min(max, Math.max(0, nx)), dir, hold: 0 }
}
