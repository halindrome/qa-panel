import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Picked } from '../types'

const PANE = 'qa-remaining'
const DIR = '.claude/remaining'
/** The `list` of a picked to-do; group names are the other lists. */
export const TODO = ':todo'

// Bumped whenever the list may have changed, so the pane redraws.
const stamp = atom({ plugin: 'qa-remaining', key: 'stamp' } as const, 0)
const picked = atom({ plugin: 'qa-remaining', key: 'picked' } as const, null as Picked)

export type Item = { key: string; why: string; href?: string }
export type Data = {
  title?: string
  updated?: string
  ticketUrl?: string
  search?: { label: string; href: string }
  groups?: { name: string; items: Item[] }[]
  todo?: string[]
}
/** Where a press lands: a row (`key`) or, without one, the end of a list. */
export type Spot = { list: string; key?: string }

/**
 * The branch this work merges into. An explicit override wins; then a
 * `.branchconfig.yaml`, where feature and hotfix branches merge into
 * `base_branch` and long-lived branches (epic, release, trunk) are the target
 * themselves; then the current branch.
 */
export function pickTarget(o: { override?: string; config?: string; branch: string }): string {
  if (o.override) return o.override
  const key = (k: string) => o.config?.match(new RegExp(`^${k}:[ \\t]*["']?([^\\s#"']+)`, 'm'))?.[1]
  const type = key('branch_type')
  if (type === 'feature' || type === 'hotfix') return key('base_branch') ?? o.branch
  return o.branch
}

export const fileName = (target: string) => `${target.replaceAll('/', '__')}.json`

/** Moves a row before another (or to the end of a list). Returns `data` itself when nothing moves. */
export function move(data: Data, from: { list: string; key: string }, to: Spot): Data {
  if ((from.list === TODO) !== (to.list === TODO) || from.key === to.key) return data
  const next = JSON.parse(JSON.stringify(data)) as Data
  const listOf = (list: string) =>
    (list === TODO ? next.todo : next.groups?.find(g => g.name === list)?.items) as (Item | string)[] | undefined
  const keyOf = (x: Item | string) => (typeof x === 'string' ? x : x.key)
  const src = listOf(from.list)
  const dst = listOf(to.list)
  const i = src?.findIndex(x => keyOf(x) === from.key) ?? -1
  if (!src || !dst || i < 0) return data
  const [row] = src.splice(i, 1)
  const j = to.key === undefined ? -1 : dst.findIndex(x => keyOf(x) === to.key)
  dst.splice(j < 0 ? dst.length : j, 0, row!)
  return next
}

type Where = { root: string; target: string; rel: string; path: string }

// ponytail: three git spawns per render; cache by cwd + HEAD if a pane redraw ever feels slow.
async function locate($: EngineInterface): Promise<Where | null> {
  const top = await $.process.run(['git', 'rev-parse', '--show-superproject-working-tree', '--show-toplevel'])
  // A submodule prints its superproject first: the monorepo keeps one list.
  const root = top.exitCode === 0 ? top.stdout.split('\n').find(Boolean) : undefined
  if (!root) return null
  const git = (...args: string[]) =>
    $.process.run(['git', ...args], { cwd: root }).then(r => (r.exitCode === 0 ? r.stdout.trim() : undefined))
  const [override, branch, config] = await Promise.all([
    git('config', '--get', 'qa-remaining.target'),
    git('rev-parse', '--abbrev-ref', 'HEAD'),
    $.fs.read(`${root}/.branchconfig.yaml`).catch(() => undefined),
  ])
  const target = pickTarget({ override, config, branch: branch ?? 'HEAD' })
  const rel = `${DIR}/${fileName(target)}`
  return { root, target, rel, path: `${root}/${rel}` }
}

const SCHEMA =
  '{ "title"?, "updated": "YYYY-MM-DD", "ticketUrl"?: "<base URL a key is appended to>", "search"?: { "label", "href" }, ' +
  '"groups": [{ "name", "items": [{ "key", "why", "href"? }] }], "todo"?: ["..."] }'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'qa-remaining', description: 'Show the tickets still open for the branch you merge into' })
    const at = await locate($).catch(() => null)
    if (at && (await $.fs.exists(at.path))) void $.ui.open({ id: PANE, title: 'Remaining' })
    return next(e)
  })

  on('command.run', { command: 'qa-remaining' }, async $ => {
    await update($, stamp, n => n + 1).catch(() => {})
    await $.ui.open({ id: PANE, title: 'Remaining' })
    const at = await locate($)
    if (!at) return { text: 'Not in a git repository.' }
    const exists = await $.fs.exists(at.path)
    return { text: `Merge target ${at.target}: ${at.path}${exists ? '' : ' (not created yet)'}` }
  })

  // Lists are also written by scripts and by checkouts, not only Write/Edit,
  // so re-read after every tool call; the file is small. A failed bump is dropped.
  on('tool.call', ($, e, next) =>
    next(e).then(ran => {
      void update($, stamp, n => n + 1).catch(() => {})
      return ran
    }),
  )

  // Tell Claude where the list is, so it keeps it current in any repo.
  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    const at = await locate($).catch(() => null)
    if (!at || !(await $.fs.exists(at.path))) return out
    const text =
      `# Remaining tickets\nThe tickets still open for merge target \`${at.target}\` are kept in \`${at.path}\`, ` +
      `shown to the person in a side pane. Shape: ${SCHEMA}. Array order is priority and the person reorders it in the ` +
      `pane: keep their order when you edit, and work from the top. When a ticket's state changes, update its \`why\`, ` +
      `move it to the right group, set \`updated\`, and drop it once it is done.`
    return { ...out, sections: [...out.sections, { id: 'qa-remaining:list', text, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Link, Button } = $.ui.resolve(e)
    await read($, stamp)
    const held = await read($, picked)
    const at = await locate($)
    if (!at) return <Text dimColor>Not in a git repository.</Text>
    if (!(await $.fs.exists(at.path)))
      return <Text dimColor>No list for {at.target} yet. Ask Claude to start {at.rel}.</Text>
    let data: Data
    try {
      data = JSON.parse(await $.fs.read(at.path)) as Data
    } catch (err) {
      return <Text color="red">Can't read {at.path}: {String(err)}</Text>
    }

    // Pick up, then drop on a row (goes before it) or a header (goes last); the held row again cancels.
    const press = (spot: Spot) => async () => {
      let from: Picked = null
      await update($, picked, cur => {
        from = cur
        return cur || !spot.key ? null : { list: spot.list, key: spot.key }
      })
      const f = from as Picked
      if (!f || f.key === spot.key) return
      const fresh = JSON.parse(await $.fs.read(at.path)) as Data
      const moved = move(fresh, f, spot)
      if (moved === fresh) return
      await $.fs.write(at.path, JSON.stringify(moved, null, 2) + '\n')
      await update($, stamp, n => n + 1)
    }
    const isHeld = (list: string, key: string) => held?.list === list && held.key === key
    const canDrop = (list: string) => !!held && (held.list === TODO) === (list === TODO)
    const handle = (list: string, key: string) => (
      <Button key={`${list}/${key}`} plain onPress={press({ list, key })}>
        {isHeld(list, key) ? <Text inverse bold>↕</Text> : canDrop(list) ? '›' : '≡'}
      </Button>
    )
    const header = (list: string, label: string) =>
      canDrop(list) ? (
        <Button key={`end/${list}`} plain onPress={press({ list })}>
          <Text bold>{label}</Text> <Text dimColor>← drop at end</Text>
        </Button>
      ) : (
        <Text bold>{label}</Text>
      )
    const groups = data.groups ?? []
    const todo = data.todo ?? []
    const count = groups.reduce((n, g) => n + g.items.length, 0)

    return (
      <Box flexDirection="column">
        <Text bold>{data.title ?? at.target}</Text>
        {held ? (
          <Text>moving {held.key}: press › where it goes, ↕ to cancel</Text>
        ) : (
          <Text dimColor>
            {count} tickets · updated {data.updated ?? '?'} · press ≡ to reorder
          </Text>
        )}
        {data.search && <Link href={data.search.href} label={data.search.label} />}
        {groups.map(g => (
          <Box flexDirection="column" marginTop={1}>
            {header(g.name, `${g.name} (${g.items.length})`)}
            {g.items.map(it => {
              const href = it.href ?? (data.ticketUrl ? data.ticketUrl + it.key : undefined)
              return (
                <Box>
                  {handle(g.name, it.key)}
                  <Text>
                    {' '}
                    {href ? <Link href={href} label={it.key} /> : it.key} <Text dimColor>{it.why}</Text>
                  </Text>
                </Box>
              )
            })}
          </Box>
        ))}
        {todo.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            {header(TODO, 'To-dos')}
            {todo.map(t => (
              <Box>
                {handle(TODO, t)}
                <Text dimColor> {t}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
