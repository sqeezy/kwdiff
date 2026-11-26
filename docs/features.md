# kwdiff — feature map

*For kwdiff 0.9.0. Everything the app does today, where it lives, and what
proves it.*

This is the **reference** page: complete, terse, one row per capability. The
user-facing story is [`guide.md`](guide.md); the reasoning behind the design is
[`spec.md`](spec.md) and the closed wayfinder map. When a ticket changes a
capability, change its row here in the same PR — `npm run docs:check` fails when
this file, the guide and the built HTML disagree about the version.

How to read a row:

| Column | Meaning |
| --- | --- |
| **Behaviour** | What the person using the app sees, as short as it can be said |
| **Code** | Where it lives: `file · symbol`, so a change is a search away |
| **Proven by** | The test that would fail if the behaviour broke (a story test in `test/update.test.ts` unless named otherwise) |

## 1. Opening a repository

| Feature | Behaviour | Code | Proven by |
| --- | --- | --- | --- |
| Picker | *Open repository…* opens the native folder dialog | `app.ts · PickRepo`, `ui.ts` launch card | the open flow |
| Any folder inside a repo | the root is resolved upward with `git rev-parse --show-toplevel` | `git.rs · open_repo` | e2e (fixture path) |
| Recents | up to 10 roots, newest first, no duplicates | `app.ts · OpenedRepo`, `config.rs · record_open` | recents (3) |
| Last repository | reopened on launch, with the branch it was left on | `app.ts · SucceededConfig` | startup (2) |
| Switch repository | the name in the top bar opens a row with the picker and the recents; `esc` closes it | `app.ts · ToggledRepos`, `ui.ts` repo row | the repository row (2), e2e |
| Drop a folder | a dropped folder (or a file inside one) opens it | `app.ts · DroppedPath` + `droppedRepo` subscription | a dropped path (2) |
| Not a repository | the error card says so and offers another folder | `ui.ts` error card, `git.rs · NotARepository` | a failed open |

## 2. Search

| Feature | Behaviour | Code | Proven by |
| --- | --- | --- | --- |
| Keyword | case-insensitive match on the message, after a 250 ms debounce | `app.ts · DebouncedSearch`, `git.rs · search` | search (4) |
| Empty field | lists everything the filters allow, so the window is never blank | `app.ts · SucceededRefs` | e2e |
| Every ref | `--all` minus `refs/stash`, newest first | `git.rs · search` | e2e |
| Branch filter | one ref narrows the search; the ticks stay | `app.ts · SelectedBranch` | the branch filter keeps the ticks |
| `-a` code search | also matches commits whose changed lines contain the keyword (`-S`, or `-G` with regex), unioned | `git.rs · search` | e2e (search-to-hunk) |
| Cap | 2 000 commits per search | `git.rs · search` (`--max-count`) | — (constant) |
| Staleness | a result for an older query or selection is dropped by generation | `app.ts · searchId`, `selectionId` | stale result, stale failure |
| Refresh | `r` or the button re-reads the refs and runs the query again | `app.ts · Refreshed` | refresh (3), e2e |

## 3. Filters

| Feature | Behaviour | Code | Proven by |
| --- | --- | --- | --- |
| Row | `filters` opens a row under the top bar; `esc` closes it; the caret goes to `author` | `app.ts · ToggledFiltersPanel` | the panel opens… |
| Author | `--author=`, matched against name and email | `git.rs · filter_args` | filters (2), Rust test |
| Path | a pathspec after `--` | `git.rs · path_args` | a pathspec…, Rust tests |
| Since / until | `--since=`, `--until=`; a bare `until` covers its whole day | `git.rs · filter_args` | an until date…, Rust test |
| Literal vs regex | off: keyword and author are literal; on: extended regex, and `-a` uses `-G` | `git.rs · literal`, `search` | story + Rust tests, e2e |
| Count and clear | the button counts active filters; *Clear filters* in the row and in the empty list | `ui.ts`, `app.ts · ClearedFilters` | every set field counts…, e2e |
| Lifetime | not persisted; dropped when another repository opens | `app.ts · OpenedRepo` | opening a repository drops filters |

## 4. Selecting commits

| Feature | Behaviour | Code | Proven by |
| --- | --- | --- | --- |
| Tick | click a row or `space`; the file list and patch follow | `app.ts · ToggledCommit`, `PressedSpace` | selection (4) |
| Range | shift-click selects anchor → row; shift+arrow extends | `app.ts · selectRange`, `MovedInPane` | range selection (5) |
| All / none | one button in the commits header | `app.ts · ToggledAll` | select all takes every result |
| Cursor | `j`/`k` and the arrows move it; it is what `f`/`t` use | `app.ts · MovedInPane` | cursor (2) |
| While comparing | ticks are kept but do not drive the panes | `app.ts · withSelection` | ticking while comparing… |

## 5. Files

| Feature | Behaviour | Code | Proven by |
| --- | --- | --- | --- |
| List | the union of the ticked commits' files, `+added`/`−removed` per path | `git.rs · files` | a shrunk file list… |
| Real paths | directory dim and truncating, file name whole, full path in the tooltip | `ui.ts · directoryOf`/`fileNameOf` | screenshot + e2e |
| Code-search mark | a dot on files the `-a` keyword occurs in, and that file opens first | `git.rs · grep_paths`, `git.rs · files` | a code search opens the file…, e2e |
| Select | clicking a file loads its patch under a new id | `app.ts · SelectedFile`, `openFile` | clicking a file loads its patch |
| While comparing | the tree diff's file list, from the two endpoints | `git.rs · files` (endpoints) | e2e (compare) |

## 6. Reading the patch

| Feature | Behaviour | Code | Proven by |
| --- | --- | --- | --- |
| One file at a time | the selected file's patch, one scroller, plain `<pre>` | `ui.ts · renderPatch` | e2e (one scroller, PageDown) |
| Line numbers | gutter from the hunk headers; new side, old side for deletions; `select-none` | `patch.ts · numberedLines` | `test/patch.test.ts` (5), e2e |
| Hunks | `@@` headers carry ids; the active hunk is highlighted | `ui.ts · renderPatch`, `app.ts · ScrollToHunk` | n/p moves the hunk, e2e |
| Lines | `j`/`k` and the arrows scroll by lines (rendered line height) | `app.ts · ScrollDiffLines` | diff scrolling (3), e2e |
| Roots divider | shown only when the selection spans more than one root | `app.ts · roots`, `ui.ts` | two roots are kept… |
| Errors | git's message appears above the patch, never a blank pane | `ui.ts` alert, `app.ts · lastError` | failures are visible (3) |
| Cap | past 5 000 lines the pane says *showing the first 5 000 of N lines* and offers *show all*; a new patch starts capped | `patch.ts · cappedRows`, `ui.ts` cap bar | `test/patch.test.ts` (cappedRows), a capped patch (2), e2e |
| Commit body | the first ticked commit's message above the patch, 3 lines with *more* | `ui.ts` body strip, `app.ts · ToggledBody` | the commit body strip (3), e2e |

## 7. Comparing two tips

| Feature | Behaviour | Code | Proven by |
| --- | --- | --- | --- |
| Two slots | any ref from the dropdown, or the cursor commit with `f`/`t`; `x` swaps | `app.ts · ChoseEndpoint`, `UsedCommitAsEndpoint`, `SwappedEndpoints` | two-endpoint compare (9) |
| Tree diff | `git diff --no-renames A B` fills the same panes; no ancestor needed | `git.rs · files`, `patch` | e2e (compare) |
| One endpoint | refused in Rust (`compare needs two endpoints`) | `git.rs · endpoints` | — (Rust) |
| No changes | the pane says so by name | `ui.ts` | screenshot |
| Ticks kept | a tick changes the checklist only while comparing; clearing a slot returns | `app.ts · withSelection`, `setEndpoints` | ticking while comparing…, clearing a slot… |
| Divider | two roots mean they cannot share an ancestor — the existing divider is exactly true | `git.rs · roots` | e2e (compare) |
| Lifetime | not persisted; dropped when another repository opens | `app.ts · OpenedRepo` | — |

## 8. Chrome, keyboard, focus

| Feature | Behaviour | Code | Proven by |
| --- | --- | --- | --- |
| Panes | commits · files · diff, a fourth rail reserved for notes | `ui.ts` grid | screenshot |
| Resizable panes | drag the 5 px line between two panes; on a narrow window the panes stack and the same lines resize their heights; double-click resets to 320/214 px (34/26 % stacked) | `app.ts · StartedSplit`/`MovedSplit`, `ui.ts` splitters, `model.ts · Split` | resizing panes (5), e2e (drag + reset) |
| Window size | starts at 1280×800, can shrink to **720×480**; the layout stacks under 1024 px | `tauri.conf.json`, `ui.ts` breakpoints | screenshot at 720 px |
| Focus | `tab` walks search → commits → files → diff; `esc` walks back, then closes keymap/filters/repo row | `app.ts · Descended`, `Ascended`, `PressedEscape` | pane navigation (4), e2e (esc walk) |
| Keymap | `?` or `F1` opens the list; `esc`/`?` closes it | `app.ts · questionMark`, `ToggledKeymap` | keymap (2), e2e |
| Slash | `/` puts the caret in the search field | `app.ts · FocusedSearch` | e2e |
| No WebView2 accelerators | `Mod+F`, `Mod+P`, `Mod+R`, `F5` are never bound | `app.ts` bindings | review |

## 9. Persistence

| What | Where | Code |
| --- | --- | --- |
| Recents (≤10), last repository, branch per repository | `%APPDATA%\dev.sqeezy.kwdiff\config.json`, written by Rust only | `config.rs` |
| Filters, compare endpoints, body expansion, panel state | memory only | `app.ts` Model |
| Window size/position | not remembered (opens at 1280×800) | `tauri.conf.json` |
| Pane sizes | memory only, reset on launch | `app.ts · DEFAULT_SPLIT` |

## 10. Error and empty states

| State | Where it shows | Code |
| --- | --- | --- |
| Nothing open | overlay with *Open repository…* and the recents | `ui.ts` card |
| Not a repository / failed open | error card with git's message | `ui.ts` card |
| git missing | card title *git is not on PATH*, offers another folder | `ui.ts` |
| No matches | commits pane echoes the keyword, or names the filter count, with *Clear filters* | `ui.ts` |
| No changes between endpoints | patch pane | `ui.ts` |
| Search running / failed | `searching…` in the commits header; git's message in the patch pane | `ui.ts` |

## 11. Limits

| Limit | Value | Consequence |
| --- | --- | --- |
| Commits per search | 2 000 | narrow the keyword or the filters |
| Patch rendering | one file at a time, capped at **5 000** lines with a visible notice and *show all* | a larger patch needs one click to be read whole; no virtualisation |
| Files | one at a time | ticks select commits, not files |
| Windows only | WebView2 (Windows 10/11 x64) | macOS/Linux are out of scope |
| Signing | none | SmartScreen warns once per download; Smart App Control blocks it |

## 12. Deliberately not in the app

Export or copy of patches (the map closed it: "a review tool, why would one need
this?"), review notes (map #2), staging / committing / merging, commit graph,
blame, PR hosting integration, multi-repo tabs, plugins, i18n, telemetry,
macOS/Linux, signing and auto-update (Later). The reasoning is in
[`spec.md`](spec.md) and the closed wayfinder map.

## 13. Verification

| Suite | Count | Command |
| --- | --- | --- |
| Update loop | 92 | `npm test` |
| Patch gutter and cap | 7 | `npm test` |
| Rust unit tests | 7 | `cargo test --manifest-path src-tauri/Cargo.toml --lib` |
| Window e2e (gate) | 57 checks | `npm run e2e` (needs a desktop session) |
| Docs | this map, the guide and the built HTML agree | `npm run docs:check` |
