import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { fileName, move, pickTarget, TODO } from './register'
import type { Data } from './register'

const DATA: Data = {
  ticketUrl: 'https://example.atlassian.net/browse/',
  groups: [
    { name: 'Fix', items: [{ key: 'P-1', why: 'a' }, { key: 'P-2', why: 'b' }, { key: 'P-3', why: 'c' }] },
    { name: 'Ready', items: [{ key: 'P-9', why: 'z' }] },
  ],
  todo: ['one', 'two'],
}
const keys = (d: Data, g: number) => d.groups![g]!.items.map(i => i.key)

test('the merge target', async () => {
  const feature = 'monorepo_branch: f/x\nbranch_type: feature\nbase_branch: epic/big   # cut from the epic\n'
  const epic = 'monorepo_branch: epic/big\nbranch_type: epic\nbase_branch: main\n'
  const sub = 'branch_type: release\nsubmodule_branches:\n  api:\n    base_branch: other\n'
  expect(pickTarget({ config: feature, branch: 'f/x' })).toBe('epic/big')
  expect(pickTarget({ config: epic, branch: 'epic/big' })).toBe('epic/big')
  expect(pickTarget({ config: sub, branch: 'rel' })).toBe('rel')
  expect(pickTarget({ branch: 'main' })).toBe('main')
  expect(pickTarget({ override: 'pinned', config: feature, branch: 'f/x' })).toBe('pinned')
  expect(fileName('epic/big')).toBe('epic__big.json')
})

test('moving rows', async () => {
  expect(keys(move(DATA, { list: 'Fix', key: 'P-3' }, { list: 'Fix', key: 'P-1' }), 0)).toEqual(['P-3', 'P-1', 'P-2'])
  expect(keys(move(DATA, { list: 'Fix', key: 'P-1' }, { list: 'Fix' }), 0)).toEqual(['P-2', 'P-3', 'P-1'])
  const across = move(DATA, { list: 'Fix', key: 'P-2' }, { list: 'Ready', key: 'P-9' })
  expect(keys(across, 0)).toEqual(['P-1', 'P-3'])
  expect(keys(across, 1)).toEqual(['P-2', 'P-9'])
  expect(move(DATA, { list: TODO, key: 'two' }, { list: TODO, key: 'one' }).todo).toEqual(['two', 'one'])
  // No-ops hand back the same object, so nothing is written.
  expect(move(DATA, { list: 'Fix', key: 'P-1' }, { list: 'Fix', key: 'P-1' })).toBe(DATA)
  expect(move(DATA, { list: TODO, key: 'one' }, { list: 'Fix' })).toBe(DATA)
  expect(move(DATA, { list: 'Fix', key: 'gone' }, { list: 'Fix' })).toBe(DATA)
  expect(keys(DATA, 0)).toEqual(['P-1', 'P-2', 'P-3'])
})

/** Mounts the pane over a repo at /repo on `main`, its list held in `file.text`. */
async function pane(...[$, on, file]: [...Parameters<TestBody>, { text: string }]) {
  on('process.run', (_, e) => {
    const args = e.argv.slice(1).join(' ')
    const stdout = args.startsWith('rev-parse --show') ? '/repo\n' : args.startsWith('rev-parse') ? 'main\n' : ''
    return { value: { exitCode: args.startsWith('config') ? 1 : 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', (_, e) => ({ value: e.path === '/repo/.claude/remaining/main.json' }))
  on('fs.read', (_, e) => {
    if (e.path.endsWith('main.json')) return { value: file.text }
    throw new Error('missing')
  })
  on('fs.write', (_, e) => {
    file.text = e.text
    return { value: undefined }
  })
  return $.ui.mount({
    plugin: 'qa-remaining',
    component: 'Pane',
    requestId: 'qa-remaining',
    surface: 'terminal',
    props: { title: 'Remaining', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
}
const shows = async (ui: { drawn: () => Promise<unknown> }, text: string) => JSON.stringify(await ui.drawn()).includes(text)

test('pick then place writes the new order', async ($, on) => {
  const file = { text: JSON.stringify(DATA) }
  const ui = await pane($, on, file)
  await ui.press({ key: 'Fix/P-3' })
  await ui.press({ key: 'end/Ready' })
  expect(keys(JSON.parse(file.text) as Data, 1)).toEqual(['P-9', 'P-3'])
  await ui.unmount()
})

test('a list of the wrong shape is named, not thrown', async ($, on) => {
  const file = { text: 'null' }
  const ui = await pane($, on, file)
  for (const bad of ['null', '[]', '{"groups":{}}', '{"groups":[{"name":"Fix"}]}', '{"groups":[{"name":"Fix","items":[{"why":"no key"}]}]}', '{"todo":[1]}']) {
    file.text = bad
    await ui.redraw()
    expect(await shows(ui, "Can't read")).toBe(true)
  }
  await ui.unmount()
})

test('a press on a list that went bad shows the error', async ($, on) => {
  const file = { text: JSON.stringify(DATA) }
  const ui = await pane($, on, file)
  await ui.press({ key: 'Fix/P-3' })
  file.text = '{"groups":{}}'
  await ui.press({ key: 'end/Ready' })
  expect(file.text).toBe('{"groups":{}}')
  expect(await shows(ui, "Can't read")).toBe(true)
  await ui.unmount()
})
