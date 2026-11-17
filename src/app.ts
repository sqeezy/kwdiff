import { Effect, Option, Schema } from 'effect'
import { Command, Subscription, type Update } from 'foldkit'
import { focus, streamFromEventFilterMap, streamFromKeyBindings } from 'foldkit/dom'
import { modifyFields } from 'foldkit/struct'
import { open } from '@tauri-apps/plugin-dialog'

import { configApi, gitApi } from './api'
import { isTauri } from './git'
import { Message } from './message'
import { Filters } from './model'
import type { Model } from './model'
import type { Endpoints, FilePatch, RootOf } from './types'

const DEBOUNCE = '250 millis'

export const noFilters: typeof Filters.Type = {
  author: '',
  path: '',
  since: '',
  until: '',
  regex: false,
}

// Both slots set is a tree diff; anything else is the tick mode. Rust refuses a
// single endpoint, so the UI and the Command share this one reading.
const endpointsOf = (from: string | null, to: string | null): Endpoints | null =>
  from !== null && to !== null ? { from, to } : null

// ---- commands --------------------------------------------------------------

export const PickRepo = Command.define('PickRepo', {
  messages: [Message.PickedRepo, Message.PickCancelled],
  execute: Effect.promise(() =>
    isTauri()
      ? open({ directory: true, multiple: false, title: 'Open repository' }).then(
          picked =>
            typeof picked === 'string' && picked.length > 0
              ? Message.PickedRepo({ path: picked })
              : Message.PickCancelled(),
          () => Message.PickCancelled(),
        )
      : Promise.resolve(Message.PickedRepo({ path: devRepo.root })),
  ),
})

export const OpenRepo = Command.define('OpenRepo', {
  args: { path: Schema.String },
  messages: [Message.OpenedRepo, Message.FailedOpen],
  execute: ({ path }) =>
    Effect.tryPromise({ try: () => gitApi.openRepo(path), catch: error => String(error) }).pipe(
      Effect.map(repo => Message.OpenedRepo({ name: repo.name, root: repo.root })),
      Effect.catch(error => Effect.succeed(Message.FailedOpen({ message: String(error) }))),
    ),
})

export const LoadConfig = Command.define('LoadConfig', {
  messages: [Message.SucceededConfig],
  execute:
    Effect.promise(() =>
      configApi.load().then(
        config =>
          Message.SucceededConfig({
            recents: [...config.recents],
            last: config.last,
            branches: [...config.branches],
          }),
        () => Message.SucceededConfig({ recents: [], last: null, branches: [] }),
      ),
    ),
})

export const LoadRefs = Command.define('LoadRefs', {
  args: { repo: Schema.String },
  messages: [Message.SucceededRefs, Message.FailedOpen],
  execute: ({ repo }) =>
    Effect.tryPromise({ try: () => gitApi.refs(repo), catch: error => String(error) }).pipe(
      Effect.map(refs => Message.SucceededRefs({ refs: [...refs] })),
      Effect.catch(error => Effect.succeed(Message.FailedOpen({ message: String(error) }))),
    ),
})

// The debounce is a Command, not a timer in the view: it sleeps, then asks for
// a search. A keystroke bumps `searchId`, so a sleeping debounce wakes up as a
// stale id and is dropped in update.
export const DebouncedSearch = Command.define('DebouncedSearch', {
  args: {
    id: Schema.Number,
    keyword: Schema.String,
    code: Schema.Boolean,
    branch: Schema.NullOr(Schema.String),
    filters: Filters,
  },
  messages: [Message.SearchRequested],
  execute: args => Effect.sleep(DEBOUNCE).pipe(Effect.as(Message.SearchRequested(args))),
})

const RunSearch = Command.define('RunSearch', {
  args: {
    id: Schema.Number,
    repo: Schema.String,
    keyword: Schema.String,
    code: Schema.Boolean,
    branch: Schema.NullOr(Schema.String),
    filters: Filters,
  },
  messages: [Message.SucceededSearch, Message.FailedSearch],
  execute: args =>
    Effect.tryPromise({
      try: () => gitApi.search(args),
      catch: error => String(error),
    }).pipe(
      Effect.map(commits => Message.SucceededSearch({ id: args.id, commits: [...commits] })),
      Effect.catch(error =>
        Effect.succeed(Message.FailedSearch({ id: args.id, message: String(error) })),
      ),
    ),
})

// One load per selection change: the file list and the roots travel together,
// so the pane can never show a file from one selection beside roots from another.
// `id` is the generation: a slower answer from an older selection, or from an
// older pair of endpoints, is dropped in update instead of landing late.
export const LoadSelection = Command.define('LoadSelection', {
  args: {
    id: Schema.Number,
    shas: Schema.Array(Schema.String),
    from: Schema.NullOr(Schema.String),
    to: Schema.NullOr(Schema.String),
    needle: Schema.NullOr(Schema.String),
    regex: Schema.Boolean,
  },
  messages: [Message.SucceededSelection],
  execute: ({ id, shas, from, to, needle, regex }) => {
    const endpoints = endpointsOf(from, to)
    return Effect.gen(function* () {
      const files = yield* Effect.tryPromise({
        try: () => gitApi.files(shas, endpoints, needle, regex),
        catch: error => String(error),
      })
      // In compare mode Rust answers with the roots of the two endpoints, so the
      // divider says "share no ancestor" only when they truly do not.
      const roots = yield* Effect.tryPromise({
        try: () => gitApi.roots(shas, endpoints),
        catch: error => String(error),
      })

      return Message.SucceededSelection({
        id,
        files: [...files],
        roots: [...new Set(roots.map(root => root.root))],
        error: null,
      })
    }).pipe(
      // A failure must reach the pane: an empty list and no explanation is the
      // worst outcome, and it is how the diff pane went blank for a whole day.
      Effect.catch(error =>
        Effect.succeed(
          Message.SucceededSelection({ id, files: [], roots: [], error: String(error) }),
        ),
      ),
    )
  },
})

export const LoadPatch = Command.define('LoadPatch', {
  args: {
    id: Schema.Number,
    shas: Schema.Array(Schema.String),
    path: Schema.String,
    from: Schema.NullOr(Schema.String),
    to: Schema.NullOr(Schema.String),
  },
  messages: [Message.SucceededPatch],
  execute: ({ id, shas, path, from, to }) =>
    Effect.tryPromise({
      try: () => gitApi.patch(shas, path, endpointsOf(from, to)),
      catch: error => String(error),
    }).pipe(
      Effect.map(patch => Message.SucceededPatch({ id, patch, error: null })),
      Effect.catch(error =>
        Effect.succeed(Message.SucceededPatch({ id, patch: '', error: String(error) })),
      ),
    ),
})

export const FocusSelector = Command.define('FocusSelector', {
  args: { selector: Schema.String },
  messages: [Message.ElementFocused],
  execute: ({ selector }) =>
    focus(selector).pipe(
      Effect.as(Message.ElementFocused()),
      Effect.catch(() => Effect.succeed(Message.ElementFocused())),
    ),
})

// The diff scrolls by lines: the pane is one <pre>, so the scroll position is
// the view's, not the model's. n/p keep jumping hunks (ScrollToHunk).
export const ScrollDiffLines = Command.define('ScrollDiffLines', {
  args: { delta: Schema.Number },
  messages: [Message.ScrolledDiffLines],
  execute: ({ delta }) =>
    Effect.sync(() => {
      const pane = document.getElementById('diff-pane')
      if (pane !== null) {
        // Read the rendered line height, so a theme change cannot make a
        // "line" mean something else than a line.
        const line = Number.parseFloat(getComputedStyle(pane).lineHeight) || 18
        pane.scrollTop += delta * line
      }
      return Message.ScrolledDiffLines({ delta })
    }),
})

export // Hunk scrolling talks to the rendered hunk anchors in our own pre.
const ScrollToHunk = Command.define('ScrollToHunk', {
  args: { index: Schema.Number },
  messages: [Message.ScrolledToHunk],
  execute: ({ index }) =>
    focus(`#hunk-${index}`).pipe(
      Effect.as(Message.ScrolledToHunk({ index })),
      Effect.catch(() => Effect.succeed(Message.ScrolledToHunk({ index }))),
    ),
})

export const BlurActive = Command.define('BlurActive', {
  messages: [Message.Blurred],
  execute: Effect.sync(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  }).pipe(Effect.as(Message.Blurred())),
})

// ---- update ----------------------------------------------------------------

const hunkCount = (patch: string | null): number =>
  patch === null ? 0 : patch.split('\n').filter(line => line.startsWith('@@')).length

// `?` never matched through the binding table on a German layout, so it gets a
// raw keydown listener that reads event.key itself.
// Shift is tracked as state so a row click can extend the selection: the view
// builder passes messages, never events, so the modifier has to arrive first.
const shiftDown = Subscription.persistentEntry(
  streamFromEventFilterMap<Document, 'keydown', Message>({
    target: () => document,
    type: 'keydown',
    filterMapEvent: (event: KeyboardEvent) =>
      event.key === 'Shift' && !event.repeat ? Option.some(Message.ShiftDown()) : Option.none(),
  }),
)

const shiftUp = Subscription.persistentEntry(
  streamFromEventFilterMap<Document, 'keyup', Message>({
    target: () => document,
    type: 'keyup',
    filterMapEvent: (event: KeyboardEvent) =>
      event.key === 'Shift' ? Option.some(Message.ShiftUp()) : Option.none(),
  }),
)

const questionMark = Subscription.persistentEntry(
  streamFromEventFilterMap<Document, 'keydown', Message>({
    // Read when the scope opens: `document` does not exist under vitest.
    target: () => document,
    type: 'keydown',
    filterMapEvent: (event: KeyboardEvent) =>
      event.key === '?' ? Option.some(Message.ToggledKeymap()) : Option.none(),
  }),
)

const paneSelector = (pane: Model['pane']): string =>
  pane === 'search'
    ? '#kw-search'
    : pane === 'commits'
      ? '#commit-list'
      : pane === 'files'
        ? '#file-list'
        : '#diff-pane'

const focusPane = (pane: Model['pane']) => FocusSelector({ selector: paneSelector(pane) })

// Every change that narrows the search — the keyword, the code toggle, the
// branch, the four `git log` filters — goes through here: bump the generation
// and ask again after the debounce, with the whole query in the message.
const refine = (model: Model) => {
  const id = model.searchId + 1
  const next = modifyFields(model, {
    searchId: () => id,
    searching: () => model.repo !== null,
    error: () => null,
  })
  return {
    model: next,
    commands:
      model.repo === null
        ? []
        : [
            DebouncedSearch({
              id,
              keyword: next.keyword,
              code: next.code,
              branch: next.branch,
              filters: next.filters,
            }),
          ],
  }
}

// Shift-click and shift-arrow extend from the anchor; everything else toggles
// one row and moves the anchor there.
const selectRange = (model: Model, from: number, to: number) => {
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const shas = model.commits.slice(lo, hi + 1).map(commit => commit.sha)
  return withSelection(model, shas)
}

// The code search's pattern, when there is one: `-a` on, and a keyword to look
// for. It is what opens a patch at the hunk that matched.
const needleOf = (model: Model): string | null =>
  model.code && model.keyword.trim() !== '' ? model.keyword.trim() : null

// The hunk a changed line contains the needle in, or -1. `-a` matched a *line*,
// so only added and removed lines count — not the file headers, not context.
export const matchingHunk = (patch: string, needle: string, regex: boolean): number => {
  let pattern: RegExp | null = null
  if (regex) {
    try {
      pattern = new RegExp(needle, 'i')
    } catch {
      return -1
    }
  }
  const lower = needle.toLowerCase()
  let hunk = -1
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      hunk += 1
      continue
    }
    if (hunk < 0 || line.startsWith('+++') || line.startsWith('---')) continue
    if (!line.startsWith('+') && !line.startsWith('-')) continue
    if (pattern !== null ? pattern.test(line) : line.toLowerCase().includes(lower)) return hunk
  }
  return -1
}

// One place turns "what the panes should show" into exactly one Command. The
// generation goes up first, so an answer that is already in flight cannot land
// on the newer selection or the newer pair of endpoints.
const reload = (model: Model) => {
  const id = model.selectionId + 1
  const next = modifyFields(model, {
    selectionId: () => id,
    patch: () => null,
    lastError: () => null,
    patchId: patchId => patchId + 1,
  })
  return {
    model: next,
    commands: [
      LoadSelection({
        id,
        shas: [...next.selectedShas],
        from: next.compare.from,
        to: next.compare.to,
        needle: needleOf(next),
        regex: next.filters.regex,
      }),
    ],
  }
}

// A tick is a selection change. While comparing, the tree diff owns the panes
// and the ticks wait: no load, no blank patch.
const withSelection = (model: Model, selectedShas: ReadonlyArray<string>) => {
  const next = modifyFields(model, { selectedShas: () => [...selectedShas] })
  return endpointsOf(next.compare.from, next.compare.to) === null
    ? reload(next)
    : { model: next, commands: [] }
}

// Choosing endpoints: picking the first slot changes nothing on screen, so it
// costs no load; a full pair, or clearing one back to the ticks, does.
const setEndpoints = (model: Model, compare: Model['compare']) => {
  const before = endpointsOf(model.compare.from, model.compare.to)
  const after = endpointsOf(compare.from, compare.to)
  const next = modifyFields(model, { compare: () => compare })
  return before === null && after === null ? { model: next } : reload(next)
}

// Selecting a file always reloads its patch under a new id, from the same
// endpoints the file list came from.
const openFile = (model: Model, index: number) => {
  const file = model.files[index]
  if (file === undefined) return { model }
  const id = model.patchId + 1
  return {
    model: modifyFields(model, { fileIndex: () => index, patchId: () => id, patch: () => null }),
    commands: [
      LoadPatch({
        id,
        shas: [...model.selectedShas],
        path: file.path,
        from: model.compare.from,
        to: model.compare.to,
      }),
    ],
  }
}

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    PickedRepo: ({ path }) => ({ model, commands: [OpenRepo({ path })] }),

    ClickedOpen: () => ({ model, commands: [PickRepo()] }),

    PickCancelled: () => ({ model }),

    OpenedRepo: ({ name, root }) => {
      const repo = { name, root }
      const remembered = model.branches.find(entry => entry.root === root)
      const next = modifyFields(model, {
        repo: () => repo,
        recents: list => [repo, ...list.filter(r => r.root !== root)].slice(0, 10),
        branch: () => remembered?.branch ?? null,
        error: () => null,
        commits: () => [],
        selectedShas: () => [],
        files: () => [],
        patch: () => null,
        roots: () => [],
        // The endpoints name refs, and the filters were typed for the history
        // that is leaving: both belong to the repository, not the window.
        compare: () => ({ from: null, to: null }),
        filters: () => ({ ...noFilters }),
        showRepos: () => false,
        selectionId: id => id + 1,
      })
      return {
        model: next,
        commands: [LoadRefs({ repo: root })],
      }
    },

    Startup: () => ({ model, commands: [LoadConfig()] }),

    SucceededConfig: ({ recents, last, branches }) => {
      const roots = [...new Set(recents)]
      const next = modifyFields(model, {
        // The browser has no config file; keep the fixture repository listed.
        recents: list => {
          const known = list.map(entry => entry.root)
          const extra = roots
            .filter(root => !known.includes(root))
            .map(root => ({ name: root.split(/[\\/]/).pop() ?? root, root }))
          return [...list, ...extra]
        },
        branches: () => [...branches],
        branch: () => {
          const remembered = branches.find(entry => entry.root === last)
          return remembered?.branch ?? model.branch
        },
      })
      return {
        model: next,
        commands: last === null ? [] : [OpenRepo({ path: last })],
      }
    },

    ConfigSaved: () => ({ model }),

    FailedOpen: ({ message }) => ({
      model: modifyFields(model, {
        error: () => ({ kind: 'not-a-repo' as const, message }),
      }),
    }),

    SucceededRefs: ({ refs }) => {
      const withRefs = modifyFields(model, { refs: () => [...refs] })
      // Opening a repository searches straight away — with the field as it is,
      // so an empty field lists everything on the current ref (the window is
      // never a blank shell) and switching repositories with a keyword typed
      // runs that query again instead of showing nothing.
      if (model.repo === null) return { model: withRefs }
      return refine(withRefs)
    },

    ChangedKeyword: ({ value }) => refine(modifyFields(model, { keyword: () => value })),

    ToggledCode: () => refine(modifyFields(model, { code: () => !model.code })),

    ChangedFilters: ({ filters }) => refine(modifyFields(model, { filters: () => ({ ...filters }) })),

    ToggledRegex: () =>
      refine(modifyFields(model, { filters: () => ({ ...model.filters, regex: !model.filters.regex }) })),

    ClearedFilters: () => refine(modifyFields(model, { filters: () => ({ ...noFilters }) })),

    // Opening the panel puts the caret in the first field: the search box keeps
    // focus otherwise, and every single-key shortcut would type into it.
    // The recents live under the top bar, like the filters: one row, no overlay
    // to click away.
    ToggledRepos: () => ({ model: modifyFields(model, { showRepos: () => !model.showRepos }) }),

    ToggledFiltersPanel: () => {
      const showFilters = !model.showFilters
      return {
        model: modifyFields(model, { showFilters: () => showFilters }),
        commands: showFilters ? [FocusSelector({ selector: '#filter-author' })] : [],
      }
    },

    SelectedBranch: ({ branch }) => {
      const branches =
        branch === null || model.repo === null
          ? model.branches.filter(entry => entry.root !== model.repo?.root)
          : [
              ...model.branches.filter(entry => entry.root !== model.repo?.root),
              { root: model.repo.root, branch },
            ]
      return refine(modifyFields(model, { branch: () => branch, branches: () => branches }))
    },

    SearchRequested: ({ id, keyword, code, branch, filters }) =>
      id === model.searchId && model.repo !== null
        ? {
            model,
            commands: [RunSearch({ id, repo: model.repo.root, keyword, code, branch, filters })],
          }
        : { model },

    SucceededSearch: ({ id, commits }) =>
      id !== model.searchId
        ? { model }
        : {
            model: modifyFields(model, {
              commits: () => [...commits],
              searching: () => false,
              cursor: () => 0,
            }),
          },

    FailedSearch: ({ id, message }) =>
      id !== model.searchId
        ? { model }
        : {
            model: modifyFields(model, {
              searching: () => false,
              error: () => ({ kind: 'search' as const, message }),
            }),
          },

    ToggledCommit: ({ sha }) => {
      const selected = model.selectedShas.includes(sha)
        ? model.selectedShas.filter(other => other !== sha)
        : [...model.selectedShas, sha]
      return withSelection(model, selected)
    },

    ToggledAll: ({ on }) =>
      withSelection(model, on ? model.commits.map(commit => commit.sha) : []),

    MovedCursor: ({ delta }) => {
      const last = Math.max(0, model.commits.length - 1)
      const cursor = Math.min(last, Math.max(0, model.cursor + delta))
      return { model: modifyFields(model, { cursor: () => cursor }) }
    },

    SelectedFile: ({ index }) => openFile(model, index),

    // Choosing the same endpoint again is not a change, and must not reload.
    ChoseEndpoint: ({ slot, value }) => {
      const compare = { ...model.compare, [slot]: value }
      if (compare.from === model.compare.from && compare.to === model.compare.to) {
        return { model }
      }
      return setEndpoints(model, compare)
    },

    UsedCommitAsEndpoint: ({ slot }) => {
      const commit = model.commits[model.cursor]
      if (commit === undefined || model.compare[slot] === commit.sha) return { model }
      return setEndpoints(model, { ...model.compare, [slot]: commit.sha })
    },

    SwappedEndpoints: () => {
      const { from, to } = model.compare
      if (from === null && to === null) return { model }
      return setEndpoints(model, { from: to, to: from })
    },

    SucceededSelection: ({ id, files, roots, error }) => {
      if (id !== model.selectionId) return { model }
      const list = [...files]
      const rootList = [...new Set(roots)]
      const withList = modifyFields(model, {
        files: () => list,
        roots: () => rootList,
        lastError: () => error,
      })
      if (list.length === 0) {
        return {
          model: modifyFields(withList, { patch: () => null, fileIndex: () => 0 }),
        }
      }
      // A code search matched a line: open the file that contains it, not
      // whichever path sorts first.
      const matched = list.findIndex(file => file.matched)
      const index = matched >= 0 ? matched : Math.min(model.fileIndex, list.length - 1)
      return openFile(withList, index)
    },

    SucceededPatch: ({ id, patch, error }) => {
      if (id !== model.patchId) return { model }
      // A shorter patch cannot keep the old hunk highlighted: the pane would
      // point at a hunk that no longer exists.
      const last = Math.max(0, hunkCount(patch) - 1)
      const next = modifyFields(model, {
        patch: () => patch,
        lastError: () => error,
        hunkIndex: index => Math.min(index, last),
      })
      const needle = needleOf(model)
      if (needle === null || patch === '' || error !== null) return { model: next }
      // `-a` matched a changed line: open the patch where it matched, and let
      // the active-hunk highlight mark it.
      const hunk = matchingHunk(patch, needle, model.filters.regex)
      if (hunk < 0) return { model: next }
      return {
        model: modifyFields(next, { hunkIndex: () => hunk }),
        commands: [ScrollToHunk({ index: hunk })],
      }
    },

    ClickedCommit: ({ index }) => {
      if (model.shiftDown && model.anchor !== null) {
        return selectRange(model, model.anchor, index)
      }
      const commit = model.commits[index]
      if (commit === undefined) return { model }
      const selected = model.selectedShas.includes(commit.sha)
        ? model.selectedShas.filter(other => other !== commit.sha)
        : [...model.selectedShas, commit.sha]
      const outcome = withSelection(model, selected)
      return { ...outcome, model: modifyFields(outcome.model, { anchor: () => index }) }
    },

    ShiftDown: () => ({ model: modifyFields(model, { shiftDown: () => true }) }),
    ShiftUp: () => ({ model: modifyFields(model, { shiftDown: () => false }) }),

    PressedSpace: () => {
      if (model.pane !== 'commits') return { model }
      const commit = model.commits[model.cursor]
      if (commit === undefined) return { model }
      const selected = model.selectedShas.includes(commit.sha)
        ? model.selectedShas.filter(other => other !== commit.sha)
        : [...model.selectedShas, commit.sha]
      return withSelection(model, selected)
    },

    FocusedSearch: () => ({
      model: modifyFields(model, { pane: () => 'search' as const }),
      commands: [focusPane('search')],
    }),

    FocusedPane: ({ pane }) => ({
      model: modifyFields(model, { pane: () => pane }),
      commands: [focusPane(pane)],
    }),

    MovedInPane: ({ delta }) => {
      if (model.pane === 'commits') {
        const last = Math.max(0, model.commits.length - 1)
        const cursor = Math.min(last, Math.max(0, model.cursor + delta))
        if (model.shiftDown && model.anchor !== null) {
          const extended = selectRange(model, model.anchor, cursor)
          return {
            ...extended,
            model: modifyFields(extended.model, { cursor: () => cursor }),
          }
        }
        return { model: modifyFields(model, { cursor: () => cursor }) }
      }
      if (model.pane === 'files') {
        const last = Math.max(0, model.files.length - 1)
        const index = Math.min(last, Math.max(0, model.fileIndex + delta))
        const outcome = openFile(model, index)
        return outcome.commands === undefined
          ? outcome
          : { ...outcome, model: modifyFields(outcome.model, { hunkIndex: () => 0 }) }
      }
      if (model.pane === 'diff') {
        // Lines, not hunks: n / p stay the hunk keys.
        return { model, commands: [ScrollDiffLines({ delta })] }
      }
      return { model }
    },

    Descended: () => {
      const next: Model['pane'] =
        model.pane === 'search' ? 'commits' : model.pane === 'commits' ? 'files' : 'diff'
      return {
        model: modifyFields(model, { pane: () => next }),
        commands: [focusPane(next)],
      }
    },

    Ascended: () => {
      const next: Model['pane'] =
        model.pane === 'diff' ? 'files' : model.pane === 'files' ? 'commits' : 'search'
      return {
        model: modifyFields(model, { pane: () => next }),
        commands: [focusPane(next)],
      }
    },

    MovedHunk: ({ delta }) => {
      const last = Math.max(0, hunkCount(model.patch) - 1)
      const index = Math.min(last, Math.max(0, model.hunkIndex + delta))
      return {
        model: modifyFields(model, { hunkIndex: () => index }),
        commands: [ScrollToHunk({ index })],
      }
    },

    JumpedHunk: ({ to }) => {
      const index = to === 'top' ? 0 : Math.max(0, hunkCount(model.patch) - 1)
      return {
        model: modifyFields(model, { hunkIndex: () => index }),
        commands: [ScrollToHunk({ index })],
      }
    },

    PressedEnter: () => {
      const next: Model['pane'] =
        model.pane === 'search' ? 'commits' : model.pane === 'commits' ? 'files' : 'diff'
      return {
        model: modifyFields(model, { pane: () => next }),
        commands: [focusPane(next)],
      }
    },

    PressedEscape: () =>
      model.showKeymap
        ? { model: modifyFields(model, { showKeymap: () => false }) }
        : model.showRepos
          ? { model: modifyFields(model, { showRepos: () => false }) }
          : model.showFilters
          ? { model: modifyFields(model, { showFilters: () => false }) }
          : model.pane === 'search'
            ? { model, commands: [BlurActive()] }
            : {
                model: modifyFields(model, {
                  pane: () =>
                    (model.pane === 'diff'
                      ? 'files'
                      : model.pane === 'files'
                        ? 'commits'
                        : 'search') as Model['pane'],
                }),
                commands: [
                  focusPane(model.pane === 'diff' ? 'files' : model.pane === 'files' ? 'commits' : 'search'),
                ],
              },

    ScrolledToHunk: () => ({ model }),
    ScrolledDiffLines: () => ({ model }),
    ElementFocused: () => ({ model }),
    DiffMounted: () => ({ model }),


    ToggledKeymap: () => ({
      model: modifyFields(model, { showKeymap: () => !model.showKeymap }),
    }),

    // Clicking a pane is how you leave the search field; without this the field
    // keeps focus and every single-key shortcut types into it instead.
    BlurRequested: () => ({ model, commands: [BlurActive()] }),

    SearchFocused: () => ({ model }),
    DiffFocused: () => ({ model }),
    Blurred: () => ({ model }),
  })

// ---- init and keys ---------------------------------------------------------

// In the browser (the dev server, the tests) there is no Tauri bridge and no
// config file, so the window opens the fixture repository and runs one search.
// The desktop build starts on state 01 and lets Rust answer `open_repo`.
const devRepo = { name: 'acme-api', root: 'C:\\work\\acme-api' }

export { devRepo }

const emptyModel: Model = {
  repo: null,
  recents: [],
  refs: [],
  branch: null,
  keyword: '',
  code: false,
  commits: [],
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
  searchId: 0,
  selectionId: 0,
  patchId: 0,
  error: null,
}

export const init = (): Update.Return<Model, Message> => {
  if (isTauri()) return { model: emptyModel, commands: [LoadConfig()] }

  return {
    model: {
      ...emptyModel,
      repo: devRepo,
      recents: [devRepo],
      refs: [
        { name: 'main', kind: 'local' },
        { name: 'release/4.2', kind: 'local' },
        { name: 'svn/legacy', kind: 'local' },
      ],
      keyword: '',
      searching: true,
      searchId: 1,
    },
    commands: [DebouncedSearch({ id: 1, keyword: '', code: false, branch: null, filters: noFilters })],
  }
}

export const subscriptions = Subscription.make<Model, Message>()(_entry => ({
  questionMark,
  shiftDown,
  shiftUp,
  keys: Subscription.persistentEntry(
    streamFromKeyBindings<Message>({
      bindings: [
        { keys: '/', whileTyping: 'Allow', mapEvent: () => Message.FocusedSearch() },
        { keys: 'Tab', mapEvent: () => Message.Descended() },
        { keys: 'Shift+Tab', mapEvent: () => Message.Ascended() },
        { keys: 'Enter', whileTyping: 'Allow', mapEvent: () => Message.PressedEnter() },
        { keys: 'Escape', whileTyping: 'Allow', mapEvent: () => Message.PressedEscape() },
        { keys: 'ArrowDown', mapEvent: () => Message.MovedInPane({ delta: 1 }) },
        { keys: 'ArrowUp', mapEvent: () => Message.MovedInPane({ delta: -1 }) },
        { keys: 'j', mapEvent: () => Message.MovedInPane({ delta: 1 }) },
        { keys: 'k', mapEvent: () => Message.MovedInPane({ delta: -1 }) },
        { keys: 'n', mapEvent: () => Message.MovedHunk({ delta: 1 }) },
        { keys: 'p', mapEvent: () => Message.MovedHunk({ delta: -1 }) },
        { keys: 'g', mapEvent: () => Message.JumpedHunk({ to: 'top' }) },
        { keys: 'Shift+G', mapEvent: () => Message.JumpedHunk({ to: 'bottom' }) },
        { keys: 'f', mapEvent: () => Message.UsedCommitAsEndpoint({ slot: 'from' }) },
        { keys: 't', mapEvent: () => Message.UsedCommitAsEndpoint({ slot: 'to' }) },
        { keys: 'x', mapEvent: () => Message.SwappedEndpoints() },
        { keys: 'Space', mapEvent: () => Message.PressedSpace() },
        { keys: 'F1', mapEvent: () => Message.ToggledKeymap() },
      ],
    }),
  ),
}))
