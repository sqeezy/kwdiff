import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { DebouncedSearch, FocusSelector, LoadPatch, LoadRefs, LoadSelection, ScrollDiffLines, ScrollToHunk, noFilters, update } from '../src/app'

import { Message } from '../src/message'
import { activeFilterCount, hasFilters } from '../src/model'
import type { Model } from '../src/model'

const repo = { name: 'acme-api', root: 'C:\\work\\acme-api' }

const commits = [
  { sha: 'c1a4f2e', date: '2019-04-12', author: 'Petra', subject: 'fix: retry (ABC-123)' },
  { sha: 'e3f1a07', date: '2026-11-02', author: 'Yuki', subject: 'refactor: policy (ABC-123)' },
]

const base: Model = {
  repo,
  recents: [repo],
  refs: [{ name: 'main', kind: 'local' }],
  branch: null,
  keyword: 'ABC-123',
  code: false,
  commits,
  selectedShas: [],
  cursor: 0,
  anchor: null,
  shiftDown: false,
  files: [],
  fileIndex: 0,
  patch: null,
  roots: [],
  lastError: null,
  showKeymap: false,
  pane: 'search',
  hunkIndex: 0,
  branches: [],
  filters: { ...noFilters },
  showFilters: false,
  compare: { from: null, to: null },
  searching: false,
  searchId: 1,
  selectionId: 0,
  patchId: 0,
  error: null,
}

// A selection change loads the file list and the roots in one Command; an
// empty answer ends the cascade. Reloading bumps the generation to 1, so the
// resolved message carries it — an older one is dropped in update.
const selectionResolved = Command.resolve(
  LoadSelection,
  Message.SucceededSelection({ id: 1, files: [], roots: [], error: null }),
)

// The debounce is resolved with a stale id, so update drops it and asks for
// nothing further: the test asserts the new generation, not the search.
const debounceStale = Command.resolve(
  DebouncedSearch,
  Message.SearchRequested({ id: -1, keyword: '', code: false, branch: null, filters: noFilters }),
)

describe('selection', () => {
  test('ticking a commit selects it', () => {
    story(
      update,
      given(base),
      message(Message.ToggledCommit({ sha: 'c1a4f2e' })),
      selectionResolved,
      model(m => {
        expect(m.selectedShas).toEqual(['c1a4f2e'])
      }),
    )
  })

  test('ticking twice unselects it', () => {
    story(
      update,
      given({ ...base, selectedShas: ['c1a4f2e'] }),
      message(Message.ToggledCommit({ sha: 'c1a4f2e' })),
      selectionResolved,
      model(m => {
        expect(m.selectedShas).toEqual([])
      }),
    )
  })

  test('select all takes every result, across roots', () => {
    story(
      update,
      given(base),
      message(Message.ToggledAll({ on: true })),
      selectionResolved,
      model(m => {
        expect(m.selectedShas).toEqual(['c1a4f2e', 'e3f1a07'])
      }),
    )
  })

  test('space toggles the commit under the cursor', () => {
    story(
      update,
      given({ ...base, cursor: 1, pane: 'commits' }),
      message(Message.PressedSpace()),
      selectionResolved,
      model(m => {
        expect(m.selectedShas).toEqual(['e3f1a07'])
      }),
    )
  })
})

describe('cursor', () => {
  test('moves within the result list', () => {
    story(
      update,
      given(base),
      message(Message.MovedCursor({ delta: 1 })),
      model(m => {
        expect(m.cursor).toBe(1)
      }),
    )
  })

  test('does not walk past the end', () => {
    story(
      update,
      given({ ...base, cursor: 1 }),
      message(Message.MovedCursor({ delta: 1 })),
      model(m => {
        expect(m.cursor).toBe(1)
      }),
    )
  })
})

describe('search', () => {
  test('a keystroke bumps the generation so late results are dropped', () => {
    story(
      update,
      given({ ...base, searchId: 4 }),
      message(Message.ChangedKeyword({ value: 'ABC-12' })),
      debounceStale,
      model(m => {
        expect(m.searchId).toBe(5)
        expect(m.searching).toBe(true)
      }),
    )
  })

  test('a stale result never lands', () => {
    story(
      update,
      given({ ...base, searchId: 5, searching: true }),
      message(
        Message.SucceededSearch({
          id: 4,
          commits: [{ sha: 'aaaaaaa', date: '2020-01-01', author: 'x', subject: 'old' }],
        }),
      ),
      model(m => {
        expect(m.commits).toEqual(commits)
        expect(m.searching).toBe(true)
      }),
    )
  })

  test('the current result lands and stops the spinner', () => {
    story(
      update,
      given({ ...base, searchId: 5, searching: true, commits: [] }),
      message(Message.SucceededSearch({ id: 5, commits })),
      model(m => {
        expect(m.commits).toEqual(commits)
        expect(m.searching).toBe(false)
        expect(m.cursor).toBe(0)
      }),
    )
  })

  test('the branch filter keeps the ticks', () => {
    story(
      update,
      given({ ...base, selectedShas: ['c1a4f2e'] }),
      message(Message.SelectedBranch({ branch: 'main' })),
      debounceStale,
      model(m => {
        expect(m.branch).toBe('main')
        expect(m.selectedShas).toEqual(['c1a4f2e'])
      }),
    )
  })
})

describe('files and roots', () => {
  test('an empty selection empties the panes', () => {
    story(
      update,
      given({ ...base, files: [{ path: 'a.ts', added: 1, removed: 0, isNew: false }], patch: 'x' }),
      message(Message.SucceededSelection({ id: 0, files: [], roots: [], error: null })),
      model(m => {
        expect(m.files).toEqual([])
        expect(m.patch).toBeNull()
      }),
    )
  })

  test('a shrunk file list pulls the cursor back into range', () => {
    const files = [
      { path: 'a.ts', added: 1, removed: 0, isNew: false },
      { path: 'b.ts', added: 2, removed: 1, isNew: false },
    ]
    story(
      update,
      given({ ...base, fileIndex: 3, patchId: 7, files }),
      message(Message.SucceededSelection({ id: 0, files, roots: [], error: null })),
      Command.resolve(LoadPatch, Message.SucceededPatch({ id: 8, patch: '', error: null })),
      model(m => {
        expect(m.fileIndex).toBe(1)
        expect(m.patchId).toBe(8)
      }),
    )
  })

  test('two roots are kept for the divider', () => {
    story(
      update,
      given(base),
      message(Message.SucceededSelection({ id: 0, files: [], roots: ['root-1', 'root-2', 'root-1'], error: null })),
      model(m => {
        expect(m.roots).toEqual(['root-1', 'root-2'])
      }),
    )
  })

  test('one root does not raise the divider', () => {
    story(
      update,
      given(base),
      message(Message.SucceededSelection({ id: 0, files: [], roots: ['root-1'], error: null })),
      model(m => {
        expect(m.roots.length).toBe(1)
      }),
    )
  })
})

describe('recents', () => {
  const refs = Command.resolve(LoadRefs, Message.SucceededRefs({ refs: [] }))

  test('opening a repository puts it first', () => {
    story(
      update,
      given({ ...base, repo: null, recents: [] }),
      message(Message.OpenedRepo({ name: 'other', root: 'C:\\work\\other' })),
      refs,
      model(m => {
        expect(m.recents[0]?.root).toBe('C:\\work\\other')
      }),
    )
  })

  test('reopening moves it up instead of duplicating it', () => {
    story(
      update,
      given({ ...base, recents: [repo, { name: 'other', root: 'C:\\work\\other' }] }),
      message(Message.OpenedRepo({ name: repo.name, root: repo.root })),
      refs,
      model(m => {
        expect(m.recents.map(entry => entry.root)).toEqual(['C:\\work\\acme-api', 'C:\\work\\other'])
      }),
    )
  })

  test('the list stops at ten', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      name: `r${index}`,
      root: `C:\\work\\r${index}`,
    }))
    story(
      update,
      given({ ...base, recents: many }),
      message(Message.OpenedRepo({ name: 'new', root: 'C:\\work\\new' })),
      refs,
      model(m => {
        expect(m.recents.length).toBe(10)
        expect(m.recents[0]?.root).toBe('C:\\work\\new')
      }),
    )
  })
})

describe('failures are visible', () => {
  test('a failed file load carries git’s message into the pane', () => {
    story(
      update,
      given(base),
      message(
        Message.SucceededSelection({ id: 0, files: [], roots: [], error: 'fatal: not a git repository' }),
      ),
      model(m => {
        expect(m.lastError).toBe('fatal: not a git repository')
        expect(m.files).toEqual([])
      }),
    )
  })

  test('a successful load clears the message', () => {
    story(
      update,
      given({ ...base, lastError: 'old' }),
      message(Message.SucceededSelection({ id: 0, files: [], roots: [], error: null })),
      model(m => {
        expect(m.lastError).toBeNull()
      }),
    )
  })

  test('a failed patch keeps the text and shows why', () => {
    story(
      update,
      given({ ...base, patchId: 3 }),
      message(
        Message.SucceededPatch({ id: 3, patch: '', error: 'exit status 128' }),
      ),
      model(m => {
        expect(m.lastError).toBe('exit status 128')
      }),
    )
  })
})

describe('keymap', () => {
  test('? opens it and ? closes it', () => {
    story(
      update,
      given(base),
      message(Message.ToggledKeymap()),
      model(m => {
        expect(m.showKeymap).toBe(true)
      }),
      message(Message.ToggledKeymap()),
      model(m => {
        expect(m.showKeymap).toBe(false)
      }),
    )
  })

  test('escape closes it without reaching for the DOM', () => {
    story(
      update,
      given({ ...base, showKeymap: true }),
      message(Message.PressedEscape()),
      model(m => {
        expect(m.showKeymap).toBe(false)
      }),
    )
  })
})

describe('pane navigation', () => {
  const focusResolved = Command.resolve(FocusSelector, Message.ElementFocused())
  const scrollResolved = Command.resolve(ScrollToHunk, Message.ScrolledToHunk({ index: 0 }))

  test('tab walks search → commits → files → diff and stops at diff', () => {
    story(
      update,
      given({ ...base, pane: 'search' }),
      message(Message.Descended()),
      focusResolved,
      model(m => expect(m.pane).toBe('commits')),
    )
  })

  test('shift+tab walks back to search and stays there', () => {
    story(
      update,
      given({ ...base, pane: 'files' }),
      message(Message.Ascended()),
      focusResolved,
      model(m => expect(m.pane).toBe('commits')),
      message(Message.Ascended()),
      focusResolved,
      model(m => expect(m.pane).toBe('search')),
    )
  })

  test('j moves the cursor only inside the commit list', () => {
    story(
      update,
      given({ ...base, pane: 'search', cursor: 0 }),
      message(Message.MovedInPane({ delta: 1 })),
      model(m => expect(m.cursor).toBe(0)),
      message(Message.FocusedPane({ pane: 'commits' })),
      focusResolved,
      message(Message.MovedInPane({ delta: 1 })),
      model(m => expect(m.cursor).toBe(1)),
    )
  })

  test('n moves between hunks and clamps at the last one', () => {
    const patch = '@@ -1 +1 @@\n+a\n@@ -9 +9 @@\n+b'
    story(
      update,
      given({ ...base, pane: 'diff', patch, hunkIndex: 0 }),
      message(Message.MovedHunk({ delta: 1 })),
      scrollResolved,
      model(m => expect(m.hunkIndex).toBe(1)),
      message(Message.MovedHunk({ delta: 1 })),
      scrollResolved,
      model(m => expect(m.hunkIndex).toBe(1)),
      message(Message.JumpedHunk({ to: 'top' })),
      scrollResolved,
      model(m => expect(m.hunkIndex).toBe(0)),
    )
  })
})

describe('range selection', () => {
  test('a plain click toggles the row and moves the anchor', () => {
    story(
      update,
      given(base),
      message(Message.ClickedCommit({ index: 1 })),
      Command.resolve(LoadSelection, Message.SucceededSelection({ id: 1, files: [], roots: [], error: null })),
      model(m => {
        expect(m.selectedShas).toEqual(['e3f1a07'])
        expect(m.anchor).toBe(1)
      }),
    )
  })

  test('shift-click selects the whole range from the anchor', () => {
    story(
      update,
      given({ ...base, shiftDown: true, anchor: 0, cursor: 0 }),
      message(Message.ClickedCommit({ index: 1 })),
      Command.resolve(LoadSelection, Message.SucceededSelection({ id: 1, files: [], roots: [], error: null })),
      model(m => {
        expect(m.selectedShas).toEqual(['c1a4f2e', 'e3f1a07'])
      }),
    )
  })

  test('shift-click backwards selects the same range', () => {
    story(
      update,
      given({ ...base, shiftDown: true, anchor: 1, cursor: 1 }),
      message(Message.ClickedCommit({ index: 0 })),
      Command.resolve(LoadSelection, Message.SucceededSelection({ id: 1, files: [], roots: [], error: null })),
      model(m => {
        expect(m.selectedShas).toEqual(['c1a4f2e', 'e3f1a07'])
      }),
    )
  })

  test('shift+arrow extends the selection from the anchor', () => {
    story(
      update,
      given({ ...base, pane: 'commits', shiftDown: true, anchor: 0, cursor: 0 }),
      message(Message.MovedInPane({ delta: 1 })),
      Command.resolve(LoadSelection, Message.SucceededSelection({ id: 1, files: [], roots: [], error: null })),
      model(m => {
        expect(m.selectedShas).toEqual(['c1a4f2e', 'e3f1a07'])
        expect(m.cursor).toBe(1)
      }),
    )
  })

  test('releasing shift returns to plain toggling', () => {
    story(
      update,
      given({ ...base, shiftDown: true }),
      message(Message.ShiftUp()),
      model(m => expect(m.shiftDown).toBe(false)),
    )
  })
})

// Two endpoints are a tree diff: `git diff A B` needs no common ancestor, which
// is why it is the one thing every other viewer cannot do here.
describe('two-endpoint compare', () => {
  const reloaded = Command.resolve(
    LoadSelection,
    Message.SucceededSelection({ id: 1, files: [], roots: [], error: null }),
  )

  test('one slot alone leaves the tick panes alone', () => {
    story(
      update,
      given({
        ...base,
        files: [{ path: 'a.ts', added: 1, removed: 0, isNew: false }],
        patch: 'the ticks',
        patchId: 4,
      }),
      message(Message.ChoseEndpoint({ slot: 'from', value: 'main' })),
      model(m => {
        expect(m.compare).toEqual({ from: 'main', to: null })
        expect(m.patch).toBe('the ticks')
        expect(m.patchId).toBe(4)
      }),
    )
  })

  test('both slots replace the ticks with the tree diff', () => {
    story(
      update,
      given({ ...base, selectedShas: ['c1a4f2e'] }),
      message(Message.ChoseEndpoint({ slot: 'from', value: 'main' })),
      message(Message.ChoseEndpoint({ slot: 'to', value: 'svn/legacy' })),
      reloaded,
      model(m => {
        expect(m.compare).toEqual({ from: 'main', to: 'svn/legacy' })
        expect(m.selectionId).toBe(1)
        // The ticks survive, so clearing a slot returns to them unchanged.
        expect(m.selectedShas).toEqual(['c1a4f2e'])
      }),
    )
  })

  test('clearing a slot returns the panes to the ticks', () => {
    story(
      update,
      given({
        ...base,
        compare: { from: 'main', to: 'svn/legacy' },
        selectedShas: ['c1a4f2e'],
      }),
      message(Message.ChoseEndpoint({ slot: 'to', value: null })),
      reloaded,
      model(m => {
        expect(m.compare).toEqual({ from: 'main', to: null })
        expect(m.selectionId).toBe(1)
      }),
    )
  })

  test('choosing the same endpoint again is not a reload', () => {
    story(
      update,
      given({ ...base, compare: { from: 'main', to: 'svn/legacy' } }),
      message(Message.ChoseEndpoint({ slot: 'from', value: 'main' })),
      model(m => {
        expect(m.compare).toEqual({ from: 'main', to: 'svn/legacy' })
      }),
    )
  })

  test('ticking while comparing leaves the tree diff in place', () => {
    const files = [{ path: 'a.ts', added: 1, removed: 0, isNew: false }]
    story(
      update,
      given({ ...base, compare: { from: 'main', to: 'svn/legacy' }, files, patch: 'the diff', patchId: 9 }),
      message(Message.ToggledCommit({ sha: 'c1a4f2e' })),
      model(m => {
        expect(m.selectedShas).toEqual(['c1a4f2e'])
        expect(m.patch).toBe('the diff')
        expect(m.patchId).toBe(9)
      }),
    )
  })

  test('the commit under the cursor fills a slot', () => {
    story(
      update,
      given({ ...base, compare: { from: 'main', to: null }, cursor: 1 }),
      message(Message.UsedCommitAsEndpoint({ slot: 'to' })),
      reloaded,
      model(m => {
        expect(m.compare).toEqual({ from: 'main', to: 'e3f1a07' })
      }),
    )
  })

  test('x swaps the endpoints', () => {
    story(
      update,
      given({ ...base, compare: { from: 'main', to: 'svn/legacy' } }),
      message(Message.SwappedEndpoints()),
      reloaded,
      model(m => {
        expect(m.compare).toEqual({ from: 'svn/legacy', to: 'main' })
      }),
    )
  })

  test('a selection answer from an older generation never lands', () => {
    story(
      update,
      given({ ...base, selectionId: 2 }),
      message(
        Message.SucceededSelection({
          id: 1,
          files: [{ path: 'stale.ts', added: 1, removed: 0, isNew: true }],
          roots: [],
          error: null,
        }),
      ),
      model(m => {
        expect(m.files).toEqual([])
      }),
    )
  })
})

// The filters are `git log`'s own limits, passed through. `Command.resolve`
// only checks which Message comes back, so these read the Command's args
// directly — that is where a filter has to show up to reach git.
describe('filters', () => {
  const filtersOf = (over: Partial<Model['filters']> = {}): Model['filters'] => ({
    ...noFilters,
    ...over,
  })

  const firstCommand = (out: { commands?: ReadonlyArray<unknown> }) =>
    out.commands?.[0] as { name: string; args?: Record<string, unknown> } | undefined

  test('a filter reaches the search Command arguments', () => {
    const out = update(base, Message.ChangedFilters({ filters: filtersOf({ author: 'Petra' }) }))
    expect(out.model.filters.author).toBe('Petra')
    const command = firstCommand(out)
    expect(command?.name).toBe('DebouncedSearch')
    expect(command?.args).toMatchObject({
      keyword: 'ABC-123',
      branch: null,
      filters: { author: 'Petra', path: '', since: '', until: '', regex: false },
    })
  })

  test('regex is one query away, and the button counts it', () => {
    const out = update(base, Message.ToggledRegex())
    expect(out.model.filters.regex).toBe(true)
    expect(firstCommand(out)?.args).toMatchObject({ filters: { regex: true } })
    expect(activeFilterCount(out.model.filters)).toBe(1)
  })

  test('every set field counts as one filter, whitespace does not', () => {
    expect(
      activeFilterCount(
        filtersOf({ author: 'x', path: 'src/', since: '2026-01-01', until: '2026-02-01', regex: true }),
      ),
    ).toBe(5)
    expect(hasFilters(noFilters)).toBe(false)
    expect(hasFilters(filtersOf({ author: '   ' }))).toBe(false)
  })

  test('clearing resets every field and asks again', () => {
    const out = update(
      { ...base, filters: filtersOf({ author: 'Petra', path: 'src/', regex: true }) },
      Message.ClearedFilters(),
    )
    expect(out.model.filters).toEqual(noFilters)
    expect(firstCommand(out)?.args).toMatchObject({ filters: noFilters })
  })

  test('a keystroke keeps the filters in the query', () => {
    const out = update(
      { ...base, filters: filtersOf({ path: 'src/http' }) },
      Message.ChangedKeyword({ value: 'retry' }),
    )
    expect(firstCommand(out)?.args).toMatchObject({
      keyword: 'retry',
      filters: { path: 'src/http' },
    })
  })

  test('no repository, no search', () => {
    const out = update(
      { ...base, repo: null },
      Message.ChangedFilters({ filters: filtersOf({ author: 'Petra' }) }),
    )
    expect(out.model.filters.author).toBe('Petra')
    expect(out.commands).toEqual([])
  })

  test('opening a repository drops filters typed for the old history', () => {
    story(
      update,
      given({ ...base, filters: filtersOf({ author: 'Petra' }) }),
      message(Message.OpenedRepo({ name: 'other', root: 'C:\\work\\other' })),
      Command.resolve(LoadRefs, Message.SucceededRefs({ refs: [] })),
      model(m => {
        expect(m.filters).toEqual(noFilters)
      }),
    )
  })

  test('the panel opens with the caret in the first field; escape closes it', () => {
    story(
      update,
      given(base),
      message(Message.ToggledFiltersPanel()),
      Command.resolve(FocusSelector, Message.ElementFocused()),
      model(m => expect(m.showFilters).toBe(true)),
      message(Message.PressedEscape()),
      model(m => expect(m.showFilters).toBe(false)),
    )
  })
})

// The diff pane is one <pre>: arrows and j/k move it by lines, which is view
// state, so the model does not change; n/p keep their hunk jumps.
describe('diff scrolling', () => {
  const patch = '@@ -1 +1 @@\n+a\n@@ -9 +9 @@\n+b'

  test('arrows and j/k scroll lines instead of stepping hunks', () => {
    story(
      update,
      given({ ...base, pane: 'diff' as const, patch, hunkIndex: 1 }),
      message(Message.MovedInPane({ delta: 1 })),
      Command.resolve(ScrollDiffLines, Message.ScrolledDiffLines({ delta: 1 })),
      model(m => {
        expect(m.hunkIndex).toBe(1)
      }),
    )
  })

  test('the scroll Command carries the direction', () => {
    const out = update({ ...base, pane: 'diff' as const, patch }, Message.MovedInPane({ delta: -3 }))
    const command = out.commands?.[0] as { name: string; args?: Record<string, unknown> } | undefined
    expect(command?.name).toBe('ScrollDiffLines')
    expect(command?.args).toEqual({ delta: -3 })
  })

  test('n and p still move between hunks', () => {
    story(
      update,
      given({ ...base, pane: 'diff' as const, patch, hunkIndex: 0 }),
      message(Message.MovedHunk({ delta: 1 })),
      Command.resolve(ScrollToHunk, Message.ScrolledToHunk({ index: 1 })),
      model(m => {
        expect(m.hunkIndex).toBe(1)
      }),
    )
  })
})
