import type { Html, HtmlBuilder } from 'foldkit/html'

import { Message } from './message'
import { activeFilterCount } from './model'
import type { Model } from './model'
import type { Endpoints } from './types'

const bg = 'bg-[#0b0e14] text-[#c9d1d9]'
const border = 'border-[#1f2733]'
const panel = 'bg-[#11151d]'
const dim = 'text-[#7d8b9e]'
const quiet = 'text-[#6b7889]'

const lineClass = (text: string): string =>
  text.startsWith('+')
    ? 'bg-[#0f2a1d] text-[#8fe0ad]'
    : text.startsWith('-')
      ? 'bg-[#2d1417] text-[#f0a19b]'
      : text.startsWith('@@')
        ? 'bg-[#131a24] text-[#8fa3bd]'
        : text.startsWith('#') || text.startsWith('diff --git')
          ? 'text-[#7d8b9e]'
          : 'text-[#9aa7b8]'

const tick = (on: boolean, h: HtmlBuilder<Message>) =>
  h.span(
    [
      h.Attribute('aria-hidden', 'true'),
      h.Class(
        `grid size-4 shrink-0 place-items-center rounded-[4px] border font-mono text-[10px] ${
          on ? 'border-[#3fb950] bg-[#1f6f3a] text-white' : 'border-[#3a4453] text-transparent'
        }`,
      ),
    ],
    ['✓'],
  )

const card = (title: string, body: Html, h: HtmlBuilder<Message>) =>
  h.div([h.Class('absolute inset-0 grid place-items-center bg-[#0b0e14]/92 p-5 text-center')], [
    h.div([h.Class('max-w-xs')], [
      h.h2([h.Class('text-[13.5px] font-semibold text-[#e6edf3]')], [title]),
      body,
    ]),
  ])

const primary = (label: string, message: Message, h: HtmlBuilder<Message>) =>
  h.button(
    [
      h.OnClick(message),
      h.Class('mt-3 rounded-md bg-[#1f6f3a] px-3 py-1.5 text-[12px] font-semibold text-[#eaf7ee]'),
    ],
    [label],
  )

// One `git log` limit: a label and its field, so the row reads as the command.
const filterField = (
  id: string,
  label: string,
  value: string,
  type: 'text' | 'date',
  onInput: (value: string) => Message,
  h: HtmlBuilder<Message>,
) =>
  h.label([h.Class('flex items-center gap-1')], [
    h.span([h.Class(`font-mono text-[10px] ${dim}`)], [label]),
    h.input([
      h.Attribute('id', id),
      h.Attribute('type', type),
      h.Attribute('spellcheck', 'false'),
      h.Attribute('aria-label', label),
      h.Value(value),
      h.OnInput(onInput),
      h.Class(
        `rounded border border-[#2b3543] bg-[#0b0e14] px-1.5 py-1 font-mono text-[11px] text-[#e6edf3] outline-none focus:border-[#3fb950] ${
          type === 'date' ? 'w-[128px]' : 'w-[136px]'
        }`,
      ),
    ]),
  ])

// Two endpoints make a tree diff; one or none is the tick mode.
const endpointsOf = (model: Model): Endpoints | null =>
  model.compare.from !== null && model.compare.to !== null
    ? { from: model.compare.from, to: model.compare.to }
    : null

// A ref keeps its name; a commit is shortened and, while the search still
// lists it, carries its subject.
const endpointLabel = (model: Model, value: string): string => {
  if (model.refs.some(ref => ref.name === value)) return value
  const commit = model.commits.find(entry => entry.sha === value)
  if (commit !== undefined) return `${value.slice(0, 7)} ${commit.subject}`
  return /^[0-9a-f]{7,}$/.test(value) ? value.slice(0, 7) : value
}

// The same, without a subject: it has to fit a 214 px pane header.
const shortLabel = (model: Model, value: string): string =>
  model.refs.some(ref => ref.name === value) ? value : endpointLabel(model, value).split(' ')[0] ?? value

// One slot of the compare picker: every ref, plus whichever commit the slot
// holds so a sha never disappears when the search moves on.
const endpointSelect = (slot: 'from' | 'to', model: Model, h: HtmlBuilder<Message>) => {
  const value = model.compare[slot]
  const knownRef = value !== null && model.refs.some(ref => ref.name === value)
  return h.select(
    [
      h.Attribute('id', `compare-${slot}`),
      h.Attribute('aria-label', `Compare ${slot}`),
      h.Value(value ?? ''),
      h.OnInput(next => Message.ChoseEndpoint({ slot, value: next === '' ? null : next })),
      h.Class(
        'max-w-[150px] truncate rounded border border-[#2b3543] bg-[#0b0e14] px-1.5 py-1 font-mono text-[11px] text-[#c9d1d9]',
      ),
      h.Attribute('title', value === null ? `Compare ${slot}` : endpointLabel(model, value)),
    ],
    [
      h.option([h.Attribute('value', '')], [slot]),
      ...model.refs.map(ref => h.option([h.Attribute('value', ref.name)], [ref.name])),
      ...(value !== null && !knownRef
        ? [h.option([h.Attribute('value', value)], [endpointLabel(model, value)])]
        : []),
    ],
  )
}

export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const selected = model.commits.filter(commit => model.selectedShas.includes(commit.sha))
  const added = model.files.reduce((sum, file) => sum + file.added, 0)
  const removed = model.files.reduce((sum, file) => sum + file.removed, 0)
  const allTicked = model.commits.length > 0 && selected.length === model.commits.length
  const compare = endpointsOf(model)
  const filterCount = activeFilterCount(model.filters)
  const noMatch =
    model.commits.length === 0 &&
    !model.searching &&
    model.error === null &&
    (model.keyword !== '' || filterCount > 0)

  return h.div([h.Class(`${bg} flex h-screen flex-col font-sans antialiased`)], [
    // ---- top bar ---------------------------------------------------------
    h.div(
      [h.Class(`flex flex-wrap items-center gap-2 border-b ${border} ${panel} px-3 py-2`)],
      [
        h.span([h.Class('font-mono text-[12px] font-bold text-[#e6edf3]')], ['kwdiff']),
        h.span([h.Class('font-mono text-[12px] text-[#556176]')], ['/']),
        h.span([h.Class('truncate font-mono text-[12px] text-[#e6edf3]')], [
          model.repo?.name ?? 'no repository',
        ]),
        h.select(
          [
            h.Attribute('aria-label', 'Branch filter'),
            h.Value(model.branch ?? ''),
            h.OnInput(value => Message.SelectedBranch({ branch: value === '' ? null : value })),
            h.Class(
              'rounded border border-[#2b3543] bg-[#0b0e14] px-1.5 py-1 font-mono text-[11px] text-[#c9d1d9]',
            ),
          ],
          [
            h.option([h.Attribute('value', '')], ['All refs']),
            ...model.refs.map(ref => h.option([h.Attribute('value', ref.name)], [ref.name])),
          ],
        ),
        h.div([h.Class('relative min-w-[160px] flex-1')], [
          h.input([
            h.Attribute('id', 'kw-search'),
            h.Attribute('type', 'text'),
            h.Attribute('placeholder', 'search commit messages…'),
            h.Attribute('spellcheck', 'false'),
            h.Value(model.keyword),
            h.OnInput(value => Message.ChangedKeyword({ value })),
            h.Class(
              'w-full rounded border border-[#2b3543] bg-[#0b0e14] px-2.5 py-1.5 font-mono text-[12px] text-[#e6edf3] outline-none placeholder:text-[#6b7889] focus:border-[#3fb950]',
            ),
          ]),
        ]),
        h.button(
          [
            h.OnClick(Message.ToggledCode()),
            h.Attribute('id', 'code-toggle'),
            h.Attribute('aria-pressed', model.code ? 'true' : 'false'),
            h.Class(
              `rounded border px-1.5 py-1 font-mono text-[11px] ${
                model.code
                  ? 'border-[#3fb950] text-[#3fb950]'
                  : 'border-[#2b3543] text-[#7d8b9e] hover:text-[#c9d1d9]'
              }`,
            ),
          ],
          ['-a code'],
        ),
        h.button(
          [
            h.OnClick(Message.ToggledFiltersPanel()),
            h.Attribute('id', 'filters-toggle'),
            h.Attribute('aria-expanded', model.showFilters ? 'true' : 'false'),
            h.Attribute('title', 'Author, path, dates, regex — git log filters'),
            h.Class(
              `rounded border px-1.5 py-1 font-mono text-[11px] ${
                filterCount > 0 || model.showFilters
                  ? 'border-[#3fb950] text-[#3fb950]'
                  : 'border-[#2b3543] text-[#7d8b9e] hover:text-[#c9d1d9]'
              }`,
            ),
          ],
          [filterCount > 0 ? `filters · ${filterCount}` : 'filters'],
        ),
        h.div([h.Class('flex items-center gap-1')], [
          endpointSelect('from', model, h),
          h.span([h.Class('font-mono text-[11px] text-[#556176]')], ['→']),
          endpointSelect('to', model, h),
          h.button(
            [
              h.OnClick(Message.SwappedEndpoints()),
              h.Attribute('aria-label', 'Swap the two endpoints'),
              h.Attribute('title', 'Swap the two endpoints (x)'),
              h.Class(
                'rounded border border-[#2b3543] px-1.5 py-1 font-mono text-[11px] text-[#7d8b9e] hover:border-[#3fb950] hover:text-[#3fb950]',
              ),
            ],
            ['swap'],
          ),
        ]),
        h.button(
          [
            h.OnClick(Message.ToggledKeymap()),
            h.Attribute('aria-label', 'Keyboard shortcuts'),
            h.Attribute('title', 'Keyboard shortcuts (?)'),
            h.Class(
              'rounded border border-[#2b3543] px-1.5 py-1 font-mono text-[11px] text-[#7d8b9e] hover:border-[#3fb950] hover:text-[#3fb950]',
            ),
          ],
          ['?'],
        ),
        h.span([h.Class('font-mono text-[11px] text-[#7d8b9e]')], [
          `${selected.length}/${model.commits.length}`,
        ]),
        h.span([h.Class('hidden font-mono text-[11px] sm:inline')], [
          `${model.files.length} files `,
          h.span([h.Class('text-[#3fb950]')], [`+${added}`]),
          ' ',
          h.span([h.Class('text-[#f85149]')], [`−${removed}`]),
        ]),
      ],
    ),

    // ---- filter row ------------------------------------------------------
    model.showFilters
      ? h.div(
          [
            h.Attribute('id', 'filter-row'),
            h.Class(`flex flex-wrap items-center gap-2 border-b ${border} ${panel} px-3 py-1.5`),
          ],
          [
            filterField(
              'filter-author',
              'author',
              model.filters.author,
              'text',
              value => Message.ChangedFilters({ filters: { ...model.filters, author: value } }),
              h,
            ),
            filterField(
              'filter-path',
              'path',
              model.filters.path,
              'text',
              value => Message.ChangedFilters({ filters: { ...model.filters, path: value } }),
              h,
            ),
            filterField(
              'filter-since',
              'since',
              model.filters.since,
              'date',
              value => Message.ChangedFilters({ filters: { ...model.filters, since: value } }),
              h,
            ),
            filterField(
              'filter-until',
              'until',
              model.filters.until,
              'date',
              value => Message.ChangedFilters({ filters: { ...model.filters, until: value } }),
              h,
            ),
            h.button(
              [
                h.OnClick(Message.ToggledRegex()),
                h.Attribute('id', 'filter-regex'),
                h.Attribute('aria-pressed', model.filters.regex ? 'true' : 'false'),
                h.Attribute('title', 'Treat the keyword and the author as regular expressions'),
                h.Class(
                  `rounded border px-1.5 py-1 font-mono text-[11px] ${
                    model.filters.regex
                      ? 'border-[#3fb950] text-[#3fb950]'
                      : 'border-[#2b3543] text-[#7d8b9e] hover:text-[#c9d1d9]'
                  }`,
                ),
              ],
              ['regex'],
            ),
            h.button(
              [
                h.OnClick(Message.ClearedFilters()),
                h.Attribute('id', 'filter-clear'),
                h.Attribute('title', 'Clear every filter'),
                h.Class(
                  'rounded border border-[#2b3543] px-1.5 py-1 font-mono text-[11px] text-[#9aa7b8] hover:border-[#3fb950] hover:text-[#3fb950]',
                ),
              ],
              ['clear'],
            ),
            h.span([h.Class(`font-mono text-[10px] ${quiet}`)], ['git log · applies after 250 ms']),
          ],
        )
      : h.span([]),

    // ---- three panes -----------------------------------------------------
    h.div(
      [h.Class('relative grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,214px)_minmax(0,1fr)]')],
      [
        // commits
        h.section([h.Class(`flex min-h-0 flex-col border-b ${border} lg:border-b-0 lg:border-r`)], [
          h.div([h.Class(`flex items-center gap-2 border-b ${border} px-3 py-1.5`)], [
            h.span([h.Class(`font-mono text-[10.5px] ${dim}`)], ['Commits']),
            model.searching ? h.span([h.Class(`font-mono text-[10px] ${quiet}`)], ['searching…']) : h.span([]),
            compare === null
              ? h.span([])
              : h.span(
                  [
                    h.Attribute('id', 'compare-chip'),
                    h.Attribute('title', 'Ticks wait while two endpoints are compared'),
                    h.Class('rounded border border-[#3fb950]/40 px-1 font-mono text-[10px] text-[#3fb950]'),
                  ],
                  ['compare'],
                ),
            h.button(
              [
                h.OnClick(Message.ToggledAll({ on: !allTicked })),
                h.Class(
                  'ml-auto rounded border border-[#2b3543] px-1.5 py-0.5 font-mono text-[10.5px] text-[#9aa7b8] hover:border-[#3fb950] hover:text-[#3fb950]',
                ),
              ],
              ['all / none'],
            ),
          ]),
          h.ul(
            [
              h.Attribute('id', 'commit-list'),
              h.Attribute('tabindex', '0'),
              h.Attribute('aria-label', 'Commits'),
              h.Class(
                `max-h-[34vh] overflow-auto py-1 outline-none lg:max-h-none ${
                  model.pane === 'commits' ? 'ring-1 ring-inset ring-[#3fb950]/50' : ''
                }`,
              ),
            ],
            [
              ...model.commits.map((commit, index) => {
                const on = model.selectedShas.includes(commit.sha)
                return h.li([], [
                  h.button(
                    [
                      h.Attribute('role', 'checkbox'),
                      h.Attribute('aria-checked', on ? 'true' : 'false'),
                      h.Attribute('aria-selected', on ? 'true' : 'false'),
                      h.OnClick(Message.ClickedCommit({ index })),
                      h.Class(
                        `flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-[#161b22] ${
                          index === model.cursor ? 'bg-[#161b22]' : ''
                        } ${on ? 'bg-[#131b26]' : 'opacity-80'}`,
                      ),
                    ],
                    [
                      tick(on, h),
                      h.span([h.Class('flex min-w-0 flex-col gap-1')], [
                        h.span([h.Class('truncate text-[12px] leading-4 text-[#e6edf3]')], [commit.subject]),
                        h.span([h.Class('flex items-center gap-1.5 font-mono text-[10.5px] text-[#7d8b9e]')], [
                          commit.sha,
                          commit.date,
                        ]),
                      ]),
                    ],
                  ),
                ])
              }),
              ...(noMatch
                ? [
                    h.li([h.Class('px-3 py-4 text-[11.5px] leading-5 text-[#7d8b9e]')], [
                      filterCount > 0
                        ? `No match with these ${filterCount} filter${filterCount === 1 ? '' : 's'}${
                            model.branch === null ? '' : ` on ${model.branch}`
                          }.`
                        : model.branch === null
                          ? `No commit message contains “${model.keyword}”. Case-insensitive; every ref is searched.`
                          : `No match on ${model.branch}.`,
                      ...(model.branch === null
                        ? []
                        : [
                            h.button(
                              [
                                h.OnClick(Message.SelectedBranch({ branch: null })),
                                h.Class('mt-2 mr-2 rounded border border-[#2b3543] px-2 py-1 font-mono text-[10.5px] text-[#9aa7b8]'),
                              ],
                              ['Search all refs'],
                            ),
                          ]),
                      ...(filterCount > 0
                        ? [
                            h.button(
                              [
                                h.OnClick(Message.ClearedFilters()),
                                h.Class('mt-2 rounded border border-[#2b3543] px-2 py-1 font-mono text-[10.5px] text-[#9aa7b8]'),
                              ],
                              ['Clear filters'],
                            ),
                          ]
                        : []),
                    ]),
                  ]
                : []),
            ],
          ),
        ]),

        // files
        h.section([h.Class(`flex min-h-0 flex-col border-b ${border} lg:border-b-0 lg:border-r`)], [
          h.div([h.Class(`flex items-center gap-2 border-b ${border} px-3 py-1.5`)], [
            h.span([h.Class(`font-mono text-[10.5px] ${dim}`)], [`Files · ${model.files.length}`]),
            compare === null
              ? h.span([])
              : h.span(
                  [
                    h.Attribute('id', 'compare-note'),
                    h.Attribute('title', `${compare.from} → ${compare.to}`),
                    h.Class(`ml-auto min-w-0 truncate font-mono text-[10px] ${dim}`),
                  ],
                  [`${shortLabel(model, compare.from)} → ${shortLabel(model, compare.to)}`],
                ),
          ]),
          h.ul(
            [
              h.Attribute('id', 'file-list'),
              h.Attribute('tabindex', '0'),
              h.Attribute('aria-label', 'Files'),
              h.Class(
                `max-h-[26vh] overflow-auto py-1 outline-none lg:max-h-none ${
                  model.pane === 'files' ? 'ring-1 ring-inset ring-[#3fb950]/50' : ''
                }`,
              ),
            ],
            model.files.map((file, index) =>
              h.li([], [
                h.button(
                  [
                    h.OnClick(Message.SelectedFile({ index })),
                    h.Class(
                      `flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[11.5px] ${
                        index === model.fileIndex
                          ? 'bg-[#1a2432] text-[#e6edf3]'
                          : 'text-[#9aa7b8] hover:bg-[#161b22]'
                      }`,
                    ),
                  ],
                  [
                    file.matched
                      ? h.span(
                          [
                            h.Attribute('aria-label', 'the code search matched a changed line here'),
                            h.Attribute('title', 'the code search matched a changed line here'),
                            h.Class('shrink-0 text-[10.5px] text-[#3fb950]'),
                          ],
                          ['•'],
                        )
                      : h.span([]),
                    h.span([h.Class('truncate')], [file.path.replace(/^src\//, '')]),
                    h.span([h.Class('ml-auto shrink-0 text-[10.5px] text-[#3fb950]')], [`+${file.added}`]),
                    h.span([h.Class('shrink-0 text-[10.5px] text-[#f85149]')], [`−${file.removed}`]),
                  ],
                ),
              ]),
            ),
          ),
        ]),

        // diff
        h.section([h.Class('flex min-h-0 flex-col'), h.OnClick(Message.BlurRequested())], [
          h.div([h.Class(`flex items-center gap-2 border-b ${border} ${panel} px-3 py-1.5`)], [
            h.span([h.Class('truncate font-mono text-[11.5px] text-[#e6edf3]')], [
              // Pierre renders its own file header inside the patch pane.
              model.patch === null ? model.files[model.fileIndex]?.path ?? 'no file' : '',
            ]),
          ]),
          model.lastError === null
            ? h.span([])
            : h.p(
                [
                  h.Attribute('role', 'alert'),
                  h.Class(
                    'whitespace-pre-wrap border-b border-[#2b3543] bg-[#2d1417] px-3 py-2 font-mono text-[11px] text-[#f0a19b]',
                  ),
                ],
                [`git: ${model.lastError}`],
              ),
          model.roots.length > 1
            ? h.div(
                [h.Class(`flex items-center gap-2 border-b ${border} bg-[#131720] px-3 py-1`)],
                [
                  h.span([h.Class('h-px flex-1 bg-[#2b3543]')]),
                  h.span([h.Class(`font-mono text-[10.5px] ${dim}`)], [
                    `these ${model.roots.length} roots share no ancestor`,
                  ]),
                  h.span([h.Class('h-px flex-1 bg-[#2b3543]')]),
                ],
              )
            : h.span([]),
          model.patch === null
            ? h.p([h.Class(`px-4 py-10 text-center font-mono text-[11.5px] ${quiet}`)], [
                compare !== null && model.lastError === null
                  ? model.files.length === 0
                    ? `No changes between ${shortLabel(model, compare.from)} and ${shortLabel(model, compare.to)}.`
                    : 'Loading patch…'
                  : model.selectedShas.length === 0
                    ? 'Tick a commit to see its patch.'
                    : 'Loading patch…',
              ])
            : h.pre(
                [
                  h.Attribute('id', 'diff-pane'),
                  h.Attribute('tabindex', '0'),
                  h.Attribute('aria-label', 'Diff'),
                  h.Class(
                    'min-h-0 flex-1 overflow-auto py-1.5 font-mono text-[11.5px] leading-[1.6] outline-none focus-visible:ring-1 focus-visible:ring-[#3fb950]',
                  ),
                ],
                renderPatch(model.patch, model.hunkIndex, h),
              ),
        ]),

        // states over the panes
        model.repo === null
          ? card(
              'Nothing open yet',
              h.div([], [
                h.p([h.Class(`mt-1 text-[11.5px] ${dim}`)], [
                  'Pick a repository; the last one comes back on launch.',
                ]),
                primary('Open repository…', Message.ClickedOpen(), h),
                ...(model.recents.length === 0
                  ? []
                  : [
                      h.div([h.Class('mt-4 border-t border-[#1f2733] pt-2 text-left')], [
                        h.span([h.Class(`font-mono text-[10px] ${quiet}`)], ['Recent']),
                        ...model.recents.map(entry =>
                          h.button(
                            [
                              h.OnClick(Message.PickedRepo({ path: entry.root })),
                              h.Class(
                                'mt-1 flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-[#161b22]',
                              ),
                            ],
                            [
                              h.span([h.Class('truncate font-mono text-[11px] text-[#e6edf3]')], [
                                entry.name,
                              ]),
                              h.span([h.Class(`truncate font-mono text-[10px] ${quiet}`)], [entry.root]),
                            ],
                          ),
                        ),
                      ]),
                    ]),
              ]),
              h,
            )
          : model.error !== null
            ? card(
                model.error.kind === 'git-missing' ? 'git is not on PATH' : 'Could not open that repository',
                h.div([], [
                  h.p([h.Class(`mt-1 text-[11.5px] ${dim}`)], [model.error.message]),
                  primary('Choose another folder…', Message.ClickedOpen(), h),
                ]),
                h,
              )
            : h.span([]),
      ],
    ),

    // ---- status bar ------------------------------------------------------
    h.div(
      [h.Class(`hidden items-center gap-3 border-t ${border} ${panel} px-3 py-1 font-mono text-[10.5px] ${dim} sm:flex`)],
      [
        h.span([], [model.repo?.root ?? 'no repository']),
        h.span([h.Class('ml-auto')], [
          `${selected.length} selected · ${model.files.length} files · `,
          h.span([h.Class('text-[#3fb950]')], [`+${added}`]),
          ' ',
          h.span([h.Class('text-[#f85149]')], [`−${removed}`]),
        ]),
        h.span([h.Class('text-[#2b3543]')], ['|']),
        h.span([], [`kwdiff ${__APP_VERSION__} · effect 4.1.4 · foldkit 0.170`]),
      ],
    ),

    // ---- keymap ----------------------------------------------------------
    model.showKeymap
      ? h.div(
          [
            h.Attribute('role', 'dialog'),
            h.Attribute('aria-label', 'Keyboard shortcuts'),
            h.OnClick(Message.ToggledKeymap()),
            h.Class(
              'fixed inset-0 z-50 grid place-items-center bg-[#05070a]/80 p-4 backdrop-blur-sm',
            ),
          ],
          [
            h.div(
              [h.Class('w-full max-w-sm rounded-xl border border-[#2b3543] bg-[#11151d] p-4 shadow-2xl')],
              [
                h.div([h.Class('flex items-baseline justify-between')], [
                  h.span([h.Class('text-[13px] font-semibold text-[#e6edf3]')], ['Keyboard']),
                  h.span([h.Class(`font-mono text-[10.5px] ${quiet}`)], ['esc or ? to close']),
                ]),
                h.dl([h.Class('mt-3 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2')], [
                  ...keymapRows.flatMap(([keys, what]) => [
                    h.dt([h.Class(`font-mono text-[11px] text-[#e6edf3]`)], [keys]),
                    h.dd([h.Class(`text-[12px] ${dim}`)], [what]),
                  ]),
                ]),
              ],
            ),
          ],
        )
      : h.span([]),
  ])
}

// The patch is rendered as hunks so the keyboard can jump between them: each
// '@@' opens a hunk with an id the scroll command focuses.
const renderPatch = (patch: string, activeHunk: number, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  let hunk = -1
  return patch.split('\n').map(text => {
    if (text.startsWith('@@')) hunk += 1
    const isHunk = text.startsWith('@@')
    const active = isHunk && hunk === activeHunk
    return h.div(
      isHunk
        ? [
            h.Attribute('id', `hunk-${hunk}`),
            h.Attribute('tabindex', '-1'),
            h.Class(
              `whitespace-pre px-3 outline-none ${active ? 'bg-[#1d3350] text-[#c9e2ff]' : lineClass(text)}`,
            ),
          ]
        : [h.Class(`whitespace-pre px-3 ${lineClass(text)}`)],
      [text],
    )
  })
}

const keymapRows: ReadonlyArray<readonly [string, string]> = [
  ['tab / shift+tab', 'next / previous pane: search, commits, files, diff'],
  ['j / k  ·  ↓ / ↑', 'move inside the focused pane; scroll lines in the diff'],
  ['space', 'tick or untick the commit under the cursor'],
  ['enter', 'one pane deeper'],
  ['esc', 'one pane back, close the keymap or the filters'],
  ['n / p', 'next / previous hunk in the diff'],
  ['g / shift+g', 'first / last hunk'],
  ['f / t', 'compare from / to the commit under the cursor'],
  ['x', 'swap the two compared endpoints'],
  ['/', 'jump to the search field'],
  ['?', 'this list'],
]
