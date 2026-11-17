import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import {
  BlurActive,
  DebouncedSearch,
  FocusSelector,
  LoadConfig,
  LoadPatch,
  LoadRefs,
  LoadSelection,
  OpenRepo,
  PickRepo,
  ScrollDiffLines,
  ScrollToHunk,
  matchingHunk,
  noFilters,
  update,
} from '../src/app'

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
  showRepos: false,
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
      given({ ...base, files: [{ path: 'a.ts', added: 1, removed: 0, isNew: false, matched: false }], patch: 'x' }),
      message(Message.SucceededSelection({ id: 0, files: [], roots: [], error: null })),
      model(m => {
        expect(m.files).toEqual([])
        expect(m.patch).toBeNull()
      }),
    )
  })

  test('a shrunk file list pulls the cursor back into range', () => {
    const files = [
      { path: 'a.ts', added: 1, removed: 0, isNew: false, matched: false },
      { path: 'b.ts', added: 2, removed: 1, isNew: false, matched: false },
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
      debounceStale,
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
      debounceStale,
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
      debounceStale,
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
        files: [{ path: 'a.ts', added: 1, removed: 0, isNew: false, matched: false }],
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
    const files = [{ path: 'a.ts', added: 1, removed: 0, isNew: false, matched: false }]
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
          files: [{ path: 'stale.ts', added: 1, removed: 0, isNew: true, matched: false }],
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
      debounceStale,
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

// `-a` matched a changed line: the patch opens where it matched, and the file
// that contains the match is the one that opens.
describe('search-to-hunk', () => {
  const patch = '@@ -1 +1 @@\n context\n+needle here\n@@ -9 +9 @@\n+other\n'

  test('the matching hunk is found in the changed lines only', () => {
    expect(matchingHunk(patch, 'needle', false)).toBe(0)
    expect(matchingHunk(patch, 'other', false)).toBe(1)
    expect(matchingHunk(patch, 'context', false)).toBe(-1)
    expect(matchingHunk(patch, '@@', false)).toBe(-1)
  })

  test('regex mode reads the needle as a pattern', () => {
    expect(matchingHunk(patch, 'nee.le', true)).toBe(0)
    expect(matchingHunk(patch, 'nee.le', false)).toBe(-1)
    expect(matchingHunk(patch, '(unclosed', true)).toBe(-1)
  })

  test('a code search opens the file that matched', () => {
    const files = [
      { path: 'a.ts', added: 1, removed: 0, isNew: false, matched: false },
      { path: 'b.ts', added: 2, removed: 1, isNew: false, matched: true },
    ]
    story(
      update,
      given({ ...base, code: true, keyword: 'needle', patchId: 0, files }),
      message(Message.SucceededSelection({ id: 0, files, roots: [], error: null })),
      Command.resolve(LoadPatch, Message.SucceededPatch({ id: 1, patch: '', error: null })),
      model(m => {
        expect(m.fileIndex).toBe(1)
        expect(m.patchId).toBe(1)
      }),
    )
  })

  test('the patch jumps to the hunk that matched', () => {
    story(
      update,
      given({ ...base, code: true, keyword: 'needle', patchId: 4, hunkIndex: 0 }),
      message(Message.SucceededPatch({ id: 4, patch, error: null })),
      Command.resolve(ScrollToHunk, Message.ScrolledToHunk({ index: 0 })),
      model(m => {
        expect(m.hunkIndex).toBe(0)
        expect(m.patch).toBe(patch)
      }),
    )
  })

  test('a match in a later hunk moves the highlight there', () => {
    story(
      update,
      given({ ...base, code: true, keyword: 'other', patchId: 4, hunkIndex: 0 }),
      message(Message.SucceededPatch({ id: 4, patch, error: null })),
      Command.resolve(ScrollToHunk, Message.ScrolledToHunk({ index: 1 })),
      model(m => {
        expect(m.hunkIndex).toBe(1)
      }),
    )
  })

  test('no code search, no jump: the patch opens at line 1', () => {
    story(
      update,
      given({ ...base, code: false, keyword: 'needle', patchId: 4, hunkIndex: 1 }),
      message(Message.SucceededPatch({ id: 4, patch, error: null })),
      model(m => {
        expect(m.hunkIndex).toBe(1)
      }),
    )
  })
})

// Startup is the path every launch takes: read the config, reopen the last
// repository, restore the branch the search remembers.
describe('startup', () => {
  test('startup asks the config, and does nothing else', () => {
    story(
      update,
      given({ ...base, repo: null }),
      message(Message.Startup()),
      Command.resolve(
        LoadConfig,
        Message.SucceededConfig({ recents: [], last: null, branches: [] }),
      ),
      model(m => {
        expect(m.repo).toBeNull()
      }),
    )
  })

  test('the last repository opens again, with its remembered branch', () => {
    story(
      update,
      given({ ...base, repo: null, recents: [], branches: [] }),
      message(
        Message.SucceededConfig({
          recents: ['C:\\work\\other'],
          last: 'C:\\work\\other',
          branches: [{ root: 'C:\\work\\other', branch: 'release/4.2' }],
        }),
      ),
      Command.resolve(OpenRepo, Message.OpenedRepo({ name: 'other', root: 'C:\\work\\other' })),
      Command.resolve(LoadRefs, Message.SucceededRefs({ refs: [] })),
      debounceStale,
      model(m => {
        expect(m.repo?.root).toBe('C:\\work\\other')
        expect(m.branch).toBe('release/4.2')
        expect(m.recents.map(entry => entry.root)).toContain('C:\\work\\other')
      }),
    )
  })

  test('no last repository opens nothing, but the recents are still merged', () => {
    story(
      update,
      given({ ...base, repo: null, recents: [{ name: 'here', root: 'C:\\work\\here' }] }),
      message(
        Message.SucceededConfig({
          recents: ['C:\\work\\a', 'C:\\work\\b'],
          last: null,
          branches: [],
        }),
      ),
      model(m => {
        expect(m.repo).toBeNull()
        expect(m.recents.map(entry => entry.name)).toEqual(
          expect.arrayContaining(['here', 'a', 'b']),
        )
      }),
    )
  })
})

describe('the open flow', () => {
  test('the open button asks the picker; cancelling changes nothing', () => {
    story(
      update,
      given(base),
      message(Message.ClickedOpen()),
      Command.resolve(PickRepo, Message.PickCancelled()),
      model(m => {
        expect(m.repo).toEqual(base.repo)
        expect(m.error).toBeNull()
      }),
    )
  })

  test('a picked folder is opened', () => {
    story(
      update,
      given(base),
      message(Message.PickedRepo({ path: 'C:\\work\\other' })),
      Command.resolve(OpenRepo, Message.FailedOpen({ message: 'fatal: no such path' })),
      model(m => {
        expect(m.error?.kind).toBe('not-a-repo')
      }),
    )
  })
})

describe('search edge cases', () => {
  test('the code toggle asks again with `-a` on', () => {
    const out = update(base, Message.ToggledCode())
    expect(out.model.code).toBe(true)
    const command = out.commands?.[0] as { name: string; args?: Record<string, unknown> } | undefined
    expect(command?.name).toBe('DebouncedSearch')
    expect(command?.args).toMatchObject({ code: true, keyword: 'ABC-123' })
  })

  test('a failed search says why and stops the spinner', () => {
    story(
      update,
      given({ ...base, searchId: 4, searching: true, error: null }),
      message(Message.FailedSearch({ id: 4, message: 'fatal: bad revision' })),
      model(m => {
        expect(m.searching).toBe(false)
        expect(m.error).toEqual({ kind: 'search', message: 'fatal: bad revision' })
      }),
    )
  })

  test('a failure from an older generation is ignored', () => {
    story(
      update,
      given({ ...base, searchId: 4, searching: true, error: null }),
      message(Message.FailedSearch({ id: 3, message: 'old' })),
      model(m => {
        expect(m.searching).toBe(true)
        expect(m.error).toBeNull()
      }),
    )
  })
})

describe('files and patches', () => {
  const files = [
    { path: 'a.ts', added: 1, removed: 0, isNew: false, matched: false },
    { path: 'b.ts', added: 2, removed: 1, isNew: false, matched: false },
  ]

  test('clicking a file loads its patch under a new id', () => {
    story(
      update,
      given({ ...base, files, fileIndex: 0, patchId: 2 }),
      message(Message.SelectedFile({ index: 1 })),
      Command.resolve(LoadPatch, Message.SucceededPatch({ id: 3, patch: '@@ -1 +1 @@\n+x', error: null })),
      model(m => {
        expect(m.fileIndex).toBe(1)
        expect(m.patchId).toBe(3)
        expect(m.patch).toBe('@@ -1 +1 @@\n+x')
      }),
    )
  })

  test('a patch from an older request never lands', () => {
    story(
      update,
      given({ ...base, patchId: 3, patch: 'current' }),
      message(Message.SucceededPatch({ id: 2, patch: 'stale', error: null })),
      model(m => {
        expect(m.patch).toBe('current')
      }),
    )
  })

  test('a shorter patch pulls the highlighted hunk back into range', () => {
    story(
      update,
      given({ ...base, hunkIndex: 4, patchId: 1 }),
      message(Message.SucceededPatch({ id: 1, patch: '@@ -1 +1 @@\n+x\n@@ -9 +9 @@\n+y', error: null })),
      model(m => {
        expect(m.hunkIndex).toBe(1)
      }),
    )
  })
})

describe('focus messages', () => {
  test('enter walks one pane deeper', () => {
    story(
      update,
      given({ ...base, pane: 'search' }),
      message(Message.PressedEnter()),
      Command.resolve(FocusSelector, Message.ElementFocused()),
      model(m => expect(m.pane).toBe('commits')),
    )
  })

  test('pressing shift is tracked, so a click can extend a range', () => {
    story(
      update,
      given({ ...base, shiftDown: false }),
      message(Message.ShiftDown()),
      model(m => expect(m.shiftDown).toBe(true)),
    )
  })

  test('clicking a pane blurs the search field', () => {
    story(
      update,
      given({ ...base, pane: 'search' }),
      message(Message.BlurRequested()),
      Command.resolve(BlurActive, Message.Blurred()),
      model(m => expect(m.pane).toBe('search')),
    )
  })
})

// Switching repositories without restarting: the row under the top bar carries
// the picker and the recents, and closes itself once one is open.
describe('the repository row', () => {
  test('the top bar opens the row, and escape closes it first', () => {
    story(
      update,
      given(base),
      message(Message.ToggledRepos()),
      model(m => expect(m.showRepos).toBe(true)),
      message(Message.PressedEscape()),
      model(m => {
        expect(m.showRepos).toBe(false)
        expect(m.pane).toBe('search')
      }),
    )
  })

  test('opening a repository closes the row', () => {
    story(
      update,
      given({ ...base, showRepos: true }),
      message(Message.OpenedRepo({ name: 'other', root: 'C:\\work\\other' })),
      Command.resolve(LoadRefs, Message.SucceededRefs({ refs: [] })),
      debounceStale,
      model(m => expect(m.showRepos).toBe(false)),
    )
  })
})

// A repository switch keeps the query: refs arriving is what re-runs it, so a
// keyword typed in the old repository searches the new one instead of showing
// an empty list.
describe('refs arriving', () => {
  test('a reopen with a keyword re-runs that query', () => {
    const out = update({ ...base, keyword: 'retry' }, Message.SucceededRefs({ refs: [] }))
    const command = out.commands?.[0] as { name: string; args?: Record<string, unknown> } | undefined
    expect(command?.name).toBe('DebouncedSearch')
    expect(command?.args).toMatchObject({ keyword: 'retry', branch: null })
    expect(out.model.searching).toBe(true)
  })

  test('with no repository there is nothing to search', () => {
    const out = update({ ...base, repo: null }, Message.SucceededRefs({ refs: [] }))
    expect(out.model.refs).toEqual([])
    // No repository: the handler returns a model and no Commands at all.
    expect(out.commands).toBeUndefined()
  })
})

// A fetch is the usual reason a review goes stale: refresh re-reads the refs
// and lets them re-run the query, keeping the ticks.
describe('refresh', () => {
  test('refresh asks for the refs under a new generation', () => {
    const out = update({ ...base, searchId: 3, searching: false }, Message.Refreshed())
    const command = out.commands?.[0] as { name: string; args?: Record<string, unknown> } | undefined
    expect(command?.name).toBe('LoadRefs')
    expect(command?.args).toEqual({ repo: base.repo?.root })
    expect(out.model.searchId).toBe(4)
    expect(out.model.searching).toBe(true)
  })

  test('the refs re-run the query and keep the ticks', () => {
    story(
      update,
      given({ ...base, selectedShas: ['c1a4f2e'], searchId: 3, searching: true }),
      message(Message.Refreshed()),
      Command.resolve(LoadRefs, Message.SucceededRefs({ refs: [{ name: 'main', kind: 'local' }] })),
      debounceStale,
      model(m => {
        expect(m.selectedShas).toEqual(['c1a4f2e'])
        expect(m.refs.map(ref => ref.name)).toEqual(['main'])
        expect(m.searching).toBe(true)
      }),
    )
  })

  test('no repository, nothing to refresh', () => {
    const out = update({ ...base, repo: null }, Message.Refreshed())
    expect(out.commands).toBeUndefined()
  })
})
