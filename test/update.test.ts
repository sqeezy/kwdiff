import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { DebouncedSearch, FocusSelector, LoadPatch, LoadRefs, LoadSelection, ScrollToHunk, update } from '../src/app'
import { hunkTargets } from '../src/viewer'
import { Message } from '../src/message'
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
  files: [],
  fileIndex: 0,
  patch: null,
  roots: [],
  lastError: null,
  showKeymap: false,
  pane: 'search',
  hunkIndex: 0,
  diffStyle: 'unified',
  branches: [],
  searching: false,
  searchId: 1,
  patchId: 0,
  error: null,
}

// A selection change loads the file list and the roots in one Command; an
// empty answer ends the cascade.
const selectionResolved = Command.resolve(
  LoadSelection,
  Message.SucceededSelection({ files: [], roots: [], error: null }),
)

// The debounce is resolved with a stale id, so update drops it and asks for
// nothing further: the test asserts the new generation, not the search.
const debounceStale = Command.resolve(
  DebouncedSearch,
  Message.SearchRequested({ id: -1, keyword: '', code: false, branch: null }),
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
      message(Message.SucceededSelection({ files: [], roots: [], error: null })),
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
      message(Message.SucceededSelection({ files, roots: [], error: null })),
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
      message(Message.SucceededSelection({ files: [], roots: ['root-1', 'root-2', 'root-1'], error: null })),
      model(m => {
        expect(m.roots).toEqual(['root-1', 'root-2'])
      }),
    )
  })

  test('one root does not raise the divider', () => {
    story(
      update,
      given(base),
      message(Message.SucceededSelection({ files: [], roots: ['root-1'], error: null })),
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
        Message.SucceededSelection({ files: [], roots: [], error: 'fatal: not a git repository' }),
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
      message(Message.SucceededSelection({ files: [], roots: [], error: null })),
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

describe('hunk targets', () => {
  test('map each hunk to its file item and added-side line', () => {
    const patch = [
      'diff --git a/a.ts b/a.ts',
      '@@ -1 +1 @@',
      '+one',
      '@@ -9 +21 @@',
      '+two',
      'diff --git a/b.ts b/b.ts',
      '@@ -0,0 +1 @@',
      '+three',
    ].join('\n')
    expect(hunkTargets(patch)).toEqual([
      { id: 'f0', line: 1 },
      { id: 'f0', line: 21 },
      { id: 'f1', line: 1 },
    ])
  })

  test('an empty patch has no targets', () => {
    expect(hunkTargets('')).toEqual([])
  })
})
