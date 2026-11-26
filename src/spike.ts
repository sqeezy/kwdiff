// A spike, not the app: the three-pane screen rebuilt in @effect/ui so the
// foundation can be judged in the real Tauri window before committing to the
// migration (Linear ANT-83). It shares the app's git seam (`gitApi`), its patch
// gutter and its Tailwind classes, and keeps the same ids behind a `spike-`
// prefix so nothing collides with the Foldkit screen underneath.
//
// Everything the real app has beyond the core loop — filters, compare, the
// commit body, refresh, splitters, drag and drop — is deliberately absent: the
// question this answers is whether @effect/ui + Effect's Command/Subscription
// model fits this window, not whether the feature set can be retyped.
import { Command, Mount, UiSchema } from '@effect/ui'
import { Html, BrowserHost, HtmlSubscription } from '@effect/ui/html'
import { Effect, Layer, Schema } from 'effect'

import { gitApi } from './api'
import { Commit, FilePatch } from './model'
import { numberedLines } from './patch'

const SpikeMessage = UiSchema.TaggedEnum({
  ChangedKeyword: { value: Schema.String },
  RequestedSearch: { id: Schema.Number, keyword: Schema.String },
  SucceededSearch: { id: Schema.Number, commits: Schema.Array(Commit) },
  FailedSearch: { id: Schema.Number, message: Schema.String },
  ToggledCommit: { sha: Schema.String },
  SucceededSelection: { files: Schema.Array(FilePatch) },
  OpenedFile: { index: Schema.Number },
  SucceededPatch: { id: Schema.Number, patch: Schema.String },
  FailedPatch: { id: Schema.Number, message: Schema.String },
})

const SpikeModel = Schema.Struct({
  keyword: Schema.String,
  searchId: Schema.Number,
  searching: Schema.Boolean,
  commits: Schema.Array(Commit),
  selected: Schema.Array(Schema.String),
  files: Schema.Array(FilePatch),
  fileIndex: Schema.Number,
  patchId: Schema.Number,
  patch: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
})

// ---- commands -------------------------------------------------------------

class Debounce extends Command.Service<Debounce>()('spike/Debounce', {
  args: { id: Schema.Number, keyword: Schema.String },
  success: SpikeMessage,
  mode: 'queue',
}) {
  static readonly layer = this.toLayer(({ id, keyword }: { id: number; keyword: string }) =>
    Effect.sleep('250 millis').pipe(Effect.as(SpikeMessage.RequestedSearch({ id, keyword }))),
  )
}

class Search extends Command.Service<Search>()('spike/Search', {
  args: { id: Schema.Number, keyword: Schema.String, repo: Schema.String },
  success: SpikeMessage,
  mode: 'queue',
}) {
  static readonly layer = this.toLayer(
    ({ id, keyword, repo }: { id: number; keyword: string; repo: string }) =>
      Effect.tryPromise({
        try: () =>
          gitApi.search({
            id,
            repo,
            keyword,
            code: false,
            branch: null,
            filters: { author: '', path: '', since: '', until: '', regex: false },
          }),
        catch: error => String(error),
      }).pipe(
        Effect.match({
          onSuccess: commits => SpikeMessage.SucceededSearch({ id, commits: [...commits] }),
          onFailure: message => SpikeMessage.FailedSearch({ id, message }),
        }),
      ),
  )
}

class LoadSelection extends Command.Service<LoadSelection>()('spike/LoadSelection', {
  args: { shas: Schema.Array(Schema.String) },
  success: SpikeMessage,
  mode: 'queue',
}) {
  static readonly layer = this.toLayer(({ shas }: { shas: ReadonlyArray<string> }) =>
    Effect.tryPromise({
      try: () => gitApi.files([...shas], null, null, false),
      catch: error => String(error),
    }).pipe(
      Effect.match({
        onSuccess: files => SpikeMessage.SucceededSelection({ files: [...files] }),
        onFailure: message => SpikeMessage.FailedSearch({ id: -1, message }),
      }),
    ),
  )
}

class LoadPatch extends Command.Service<LoadPatch>()('spike/LoadPatch', {
  args: { id: Schema.Number, shas: Schema.Array(Schema.String), path: Schema.String },
  success: SpikeMessage,
  mode: 'queue',
}) {
  static readonly layer = this.toLayer(
    ({ id, shas, path }: { id: number; shas: ReadonlyArray<string>; path: string }) =>
      Effect.tryPromise({
        try: () => gitApi.patch([...shas], path, null),
        catch: error => String(error),
      }).pipe(
        Effect.match({
          onSuccess: patch => SpikeMessage.SucceededPatch({ id, patch }),
          onFailure: message => SpikeMessage.FailedPatch({ id, message }),
        }),
      ),
  )
}

// The spike starts its own first search: a mount on the root, so the window is
// never empty and the mount primitive is exercised too.
const StartSearch = Mount.make('spike/Start', { args: {} }, () =>
  Effect.succeed(SpikeMessage.ChangedKeyword({ value: '' })),
)

// ---- the component --------------------------------------------------------

const Spike = Html.component({
  name: 'Spike',
  props: Schema.Struct({ repo: Schema.String }),
  model: SpikeModel,
  message: SpikeMessage,
}).make({
  init: () => ({
    keyword: '',
    searchId: 0,
    searching: true,
    commits: [],
    selected: [],
    files: [],
    fileIndex: 0,
    patchId: 0,
    patch: null,
    error: null,
  }),

  // Nothing is loaded until the window is up: the first search runs as a
  // command so the spike exercises the same path as every later one.
  subscriptions: () => [],

  update: {
    ChangedKeyword: ($, { value }) => {
      const id = $.model.searchId + 1
      return $.evolve({ keyword: value, searchId: id, searching: true }).run(
        Debounce.make({ id, keyword: value }),
      )
    },
    RequestedSearch: ($, { id, keyword }) =>
      id === $.model.searchId
        ? $.run(Search.make({ id, keyword, repo: $.props.repo }))
        : $.model,
    SucceededSearch: ($, { id, commits }) =>
      id !== $.model.searchId ? $.model : $.evolve({ commits, searching: false }),
    FailedSearch: ($, { id, message }) =>
      id !== $.model.searchId ? $.model : $.evolve({ searching: false, error: message }),

    ToggledCommit: ($, { sha }) => {
      const selected = $.model.selected.includes(sha)
        ? $.model.selected.filter(other => other !== sha)
        : [...$.model.selected, sha]
      const id = $.model.patchId + 1
      return $.evolve({
        selected,
        files: [],
        fileIndex: 0,
        patch: null,
        patchId: id,
      }).run(LoadSelection.make({ shas: selected }))
    },

    SucceededSelection: ($, { files }) => {
      const first = files[0]
      if (first === undefined) return $.evolve({ files: [], patch: null })
      const id = $.model.patchId + 1
      return $.evolve({ files, fileIndex: 0, patch: null, patchId: id }).run(
        LoadPatch.make({ id, shas: $.model.selected, path: first.path }),
      )
    },

    OpenedFile: ($, { index }) => {
      const file = $.model.files[index]
      if (file === undefined) return $.model
      const id = $.model.patchId + 1
      return $.evolve({ fileIndex: index, patch: null, patchId: id }).run(
        LoadPatch.make({ id, shas: $.model.selected, path: file.path }),
      )
    },

    SucceededPatch: ($, { id, patch }) =>
      id !== $.model.patchId ? $.model : $.evolve({ patch }),
    FailedPatch: ($, { id, message }) =>
      id !== $.model.patchId ? $.model : $.evolve({ patch: null, error: message }),
  },

  view: (h, model) =>
    h.div
      .attrs({
        id: 'spike-root',
        class:
          'fixed inset-0 z-[60] flex flex-col bg-[#0b0e14] font-sans text-[#c9d1d9] antialiased',
      })
      .onMount(StartSearch().pipe(Mount.map(message => message)))
      .children(
        h.div
          .attrs({
            class:
              'flex flex-wrap items-center gap-2 border-b border-[#1f2733] bg-[#11151d] px-3 py-2',
          })
          .children(
            h.span
              .attrs({ class: 'rounded border border-[#3fb950]/50 px-1.5 py-0.5 font-mono text-[10px] text-[#3fb950]' })
              .children('effect-ui spike'),
            h.span.attrs({ class: 'font-mono text-[11px] text-[#7d8b9e]' }).children(model.keyword === '' ? 'all commits' : 'search'),
            h.input
              .attrs({
                id: 'spike-search',
                type: 'text',
                placeholder: 'search commit messages…',
                spellcheck: 'false',
                class:
                  'min-w-[160px] flex-1 rounded border border-[#2b3543] bg-[#0b0e14] px-2.5 py-1.5 font-mono text-[12px] text-[#e6edf3] outline-none focus:border-[#3fb950]',
              })
              .value(model.keyword)
              .on('input', ({ value }) => SpikeMessage.ChangedKeyword({ value })),
            h.span
              .attrs({ class: 'font-mono text-[11px] text-[#7d8b9e]' })
              .children(
                `${model.selected.length}/${model.commits.length}${model.searching ? ' · searching…' : ''}`,
              ),
            h.span
              .attrs({ class: 'font-mono text-[10px] text-[#556176]' })
              .children('F2 closes the spike'),
          ),

        model.error === null
          ? null
          : h.p
              .attrs({
                class:
                  'border-b border-[#2b3543] bg-[#2d1417] px-3 py-2 font-mono text-[11px] text-[#f0a19b]',
              })
              .children(model.error),

        h.div
          .attrs({
            class:
              'grid min-h-0 flex-1 grid-cols-[minmax(0,320px)_minmax(0,214px)_minmax(0,1fr)]',
          })
          .children(
            h.section
              .attrs({ class: 'flex min-h-0 flex-col border-r border-[#1f2733]' })
              .children(
                h.div
                  .attrs({ class: 'border-b border-[#1f2733] px-3 py-1.5 font-mono text-[10.5px] text-[#7d8b9e]' })
                  .children(`Commits · ${model.commits.length}`),
                h.ul
                  .attrs({ id: 'spike-commits', class: 'min-h-0 flex-1 overflow-auto py-1' })
                  .children(
                    ...model.commits.map(commit =>
                      h.li.children(
                        h.button
                          .attrs({
                            type: 'button',
                            'aria-checked': model.selected.includes(commit.sha) ? 'true' : 'false',
                            role: 'checkbox',
                            class: `flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left hover:bg-[#161b22] ${
                              model.selected.includes(commit.sha) ? 'bg-[#131b26]' : ''
                            }`,
                          })
                          .on('click', SpikeMessage.ToggledCommit({ sha: commit.sha }))
                          .children(
                            h.span.attrs({ class: 'w-full truncate text-[12px] text-[#e6edf3]' }).children(commit.subject),
                            h.span
                              .attrs({ class: 'font-mono text-[10.5px] text-[#7d8b9e]' })
                              .children(`${commit.sha} ${commit.date}`),
                          ),
                      ),
                    ),
                  ),
              ),
            h.section
              .attrs({ class: 'flex min-h-0 flex-col border-r border-[#1f2733]' })
              .children(
                h.div
                  .attrs({ class: 'border-b border-[#1f2733] px-3 py-1.5 font-mono text-[10.5px] text-[#7d8b9e]' })
                  .children(`Files · ${model.files.length}`),
                h.ul
                  .attrs({ id: 'spike-files', class: 'min-h-0 flex-1 overflow-auto py-1' })
                  .children(
                    ...model.files.map((file, index) =>
                      h.li.children(
                        h.button
                          .attrs({
                            type: 'button',
                            class: `flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[11.5px] ${
                              index === model.fileIndex
                                ? 'bg-[#1a2432] text-[#e6edf3]'
                                : 'text-[#9aa7b8] hover:bg-[#161b22]'
                            }`,
                          })
                          .on('click', SpikeMessage.OpenedFile({ index }))
                          .children(
                            h.span.attrs({ class: 'truncate' }).children(file.path),
                            h.span
                              .attrs({ class: 'ml-auto shrink-0 text-[10.5px] text-[#3fb950]' })
                              .children(`+${file.added}`),
                            h.span
                              .attrs({ class: 'shrink-0 text-[10.5px] text-[#f85149]' })
                              .children(`−${file.removed}`),
                          ),
                      ),
                    ),
                  ),
              ),
            h.section
              .attrs({ class: 'flex min-h-0 flex-col' })
              .children(
                model.patch === null
                  ? h.p
                      .attrs({ class: 'px-4 py-10 text-center font-mono text-[11.5px] text-[#6b7889]' })
                      .children(model.selected.length === 0 ? 'Tick a commit.' : 'Loading patch…')
                  : h.pre
                      .attrs({
                        id: 'spike-diff',
                        class: 'min-h-0 flex-1 overflow-auto py-1.5 font-mono text-[11.5px] leading-[1.6]',
                      })
                      .children(
                        ...numberedLines(model.patch).map(row =>
                          h.div
                            .attrs({
                              class: `flex gap-2 whitespace-pre px-3 ${
                                row.kind === 'add'
                                  ? 'bg-[#0f2a1d] text-[#8fe0ad]'
                                  : row.kind === 'del'
                                    ? 'bg-[#2d1417] text-[#f0a19b]'
                                    : row.kind === 'hunk'
                                      ? 'bg-[#131a24] text-[#8fa3bd]'
                                      : 'text-[#9aa7b8]'
                              }`,
                            })
                            .children(
                              h.span
                                .attrs({
                                  class: 'w-9 shrink-0 select-none text-right tabular-nums text-[#8b98a9]',
                                })
                                .children(String(row.newLine ?? row.oldLine ?? '')),
                              h.span.children(row.text),
                            ),
                        ),
                      ),
              ),
          ),
      ),
})

// The spike's own Layers: each command's implementation, merged into the mount.
const SpikeLayers = Layer.mergeAll(Search.layer, LoadSelection.layer, LoadPatch.layer, Debounce.layer)

export const mountSpike = (repo: string, element: HTMLElement) =>
  BrowserHost.mount(Spike, { repo }, element).pipe(Layer.provide(SpikeLayers))
