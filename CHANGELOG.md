# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

## [0.6.0] - 2026-11-16

### Added

- **Search-to-hunk** (ANT-60): with `-a` on and a keyword, the commit the code
  search matched opens the file that contains the match (its row carries a dot)
  and the patch at the **hunk** that matched, marked by the same active-hunk
  style `n`/`p` use. A keyword that only exists in a *removed* line still opens
  at the right place once its file is open — `git grep` marks the tree, the
  patch scan covers both sides. 6 story tests (56 total).

## [0.5.0] - 2026-11-16

### Added

- **Diff pane line keys** (ANT-73): `j`/`k` and the arrows scroll the patch by
  **lines**, reading the rendered line height, while `n`/`p` keep stepping
  hunks and `g`/`shift+g` jump to the first and last. Scrolling is view state —
  the pane is one `<pre>` scroller — so the model does not change on every key;
  the hunk the keyboard is on stays where it was until `n`/`p` moves it.

### Tests

- **The e2e is a gate** (ANT-74): `continue-on-error` is gone, so a red window
  test fails the build — proven in the PR with a deliberately broken assertion.
  The smoke grew from 18 to 38 checks: clicking a file loads that file's patch,
  an arrow scrolls about a line and does *not* step the hunk, `n`/`p` move the
  active hunk, and `esc` walks diff → files → commits → search → out of the
  field.

### Removed

- `happy-dom` from the dev dependencies (ANT-62). It was only an *optional peer*
  of vitest for its browser environment, and the suite runs in `node`; removing
  it takes both open high Dependabot advisories with it. `npm audit` is clean.

## [0.4.0] - 2026-11-16

### Added

- **Filters** (ANT-64): a row under the top bar with the four things `git log`
  already does — **author**, **path**, **since**, **until** — and a **regex**
  toggle. Each field is one more input to the same debounced search, so a filter
  change is never a second search mode; the button counts what is on, the empty
  list says *with these N filters* and offers *Clear filters*.
- **Literals by default**: with regex off, the keyword and the author are
  matched literally (their extended-regex metacharacters are escaped in Rust), so
  `a.b` finds `a.b` and not `axb`. With regex on they are extended regular
  expressions, and `-a` switches from `-S` (fixed string) to `-G` (regex).
- Rust unit tests over the arguments git receives, run with `cargo test --lib`
  and in CI: literal escaping, the author pattern only when regex is on, an
  `until` date covering its whole day, the pathspec after `--`. 8 more story
  tests (47 total).

### Fixed

- **`-E` is passed unconditionally.** With an empty keyword the search used to
  pass no pattern mode, so git read the author filter as a *basic* regex, where
  `\|` is alternation — a literal `anton|dependabot` matched every commit
  instead of none. The bench e2e caught it.
- `--until=<date>` ends at `23:59:59` for a bare date instead of midnight, which
  silently dropped that day's commits.

## [0.3.0] - 2026-11-16

### Added

- **Two-endpoint compare** (ANT-66): two slots beside the search field diff any
  two tips — refs from the slots, or the commit under the cursor with `f` / `t`;
  `x` swaps them. With both set the panes show `git diff A B`, a tree diff that
  needs no common ancestor, reusing the file list, the patch pane and the roots
  divider (two different roots mean the endpoints cannot share one). The empty
  entry in a slot returns to the ticks, which are kept rather than cleared;
  ticking while comparing changes the checklist and nothing else. 8 story tests
  (39 total), and `npm run e2e` covers the compare path on the bench VM.
- Selection loads carry a generation (`selectionId`), so an answer for an older
  selection, or for an older pair of endpoints, is dropped instead of landing
  late.

### Fixed

- `npm run e2e` no longer flakes on the scroll assertion: it waits for each pane
  to actually hold focus, which arrives from a Command after the keypress,
  instead of assuming the keys were enough.

### Changed

- `files`, `patch` and `roots` take the two endpoints. Rust refuses a single
  one, because `git diff A` would silently mean *A against the worktree*.
  Compare paths pass `--no-renames`, so a rename stays a delete plus an add and
  every path in the list is a path the patch pane can answer for.

## [0.2.10] - 2026-11-16

### Added

- **Range selection in the commit list**: shift-click selects from the anchor to
  the clicked row, shift+arrow extends it, a plain click toggles one row and
  moves the anchor. Shift is tracked as state, because the view builder passes
  messages rather than events. 5 story tests (31 total).

## [0.2.9] - 2026-11-15

### Changed

- **The diff pane is ours again.** @pierre/diffs' CodeView virtualises against
  its own viewport while the pane scrolled the full content, so the two
  positions desynced and the scrollbar disconnected after a hunk jump. The pane
  is now a single `<pre>` scroller with hunk anchors; verified on a Windows
  machine (one scroller, 1207 px content in a 362 px viewport, PageDown 0 → 316).

### Removed

- `@pierre/diffs`, the split-view toggle (`v`) and the dead `diffStyle` model
  field. Split view and syntax colour return in their own effort, not in v1.

## [0.2.8] - 2026-11-15

### Fixed

- **The diff pane scrolls.** It was `overflow-hidden`, so the viewer's full
  height was clipped and there was no scroll surface at all — j, k and the
  arrows now move it by lines (verified on a Windows machine: 0 → 216 px over
  three presses).
- Hunk jumps (`n` / `p`) address the viewer's own scroll targets, by file item
  and added-side line.

### Added

- A long fixture patch, so scrolling has something to scroll in the browser.

## [0.2.7] - 2026-11-15

### Fixed

- `?` opens the keymap on every layout: it is read from a raw keydown listener
  instead of the binding table, whose shift matching missed it.
- `n` / `p` / `g` scroll Pierre's viewer to the right place: each hunk now
  carries its file item id as well as its line, and the scroll is instant.

## [0.2.6] - 2026-11-15

### Changed

- The diff pane is Pierre's `CodeView` (@pierre/diffs): syntax colouring through
  Shiki, line numbers, per-line virtualisation, file headers with change counts.
- `v` toggles unified and split view.

### Known

- `dist` grows to ~12 MB of lazy Shiki language chunks; the window loads only
  what it uses, but the installer carries them all. Trimming is a follow-up.

## [0.2.5] - 2026-11-15

### Added

- Keyboard navigation across panes: `tab` / `shift+tab` walk search → commits →
  files → diff; `enter` goes one deeper, `esc` one back; `j` / `k` or the
  arrows move inside the focused pane; `n` / `p` step hunks, `g` / `shift+g`
  jump to the first or last. The focused pane carries a ring, the focused hunk
  a highlight.

## [0.2.4] - 2026-11-15

### Added

- An empty search field is a full search: everything on the ref, newest first,
  and opening a repository searches immediately so the window is never empty.

### Fixed

- `?` opens the keymap even while the search field has focus, which is how it
  was dead before: single-key bindings are suppressed inside inputs.
- Clicking a pane blurs the field, so `j`, `k` and `space` stop typing into the
  search box after you have used it.


## [0.2.3] - 2026-11-15

### Added

- A visible `?` button in the toolbar and an `F1` binding open the keymap, so
  it no longer depends on a keyboard layout or on which build is installed.
- The status bar shows the app version, so a report can name its build.


## [0.2.2] - 2026-11-15

### Fixed

- The diff pane no longer goes blank: the patch bridge decodes every shape the
  IPC layer returns, and a failed file or patch load shows git's message in
  the pane instead of an empty list.

### Added

- `?` opens the in-app keymap; `esc` closes it.
- 5 more story tests (22 total): error surfacing and the keymap.

### Added

- The native folder picker (`tauri-plugin-dialog`) behind *Open repository…*,
  and the recents list on the launch card, each entry opening its root.
- 3 more story tests: recents order, no duplicates, the ten-entry cap.

## [0.2.1] - 2026-11-14

## [0.2.0] - 2026-11-14

### Added

- kwdiff as a Windows desktop app: Tauri 2 shell, Foldkit 0.170 on Effect
  4.1.4, a three-pane review window.
- Rust git commands (`open_repo`, `refs`, `search`, `cancel_search`, `files`,
  `patch`, `roots`) with fixed argv, no shell, and cancellation that kills the
  previous child.
- 12 story tests over the update loop: ticks, select-all, filters, roots,
  stale results, file-list clamping.
- Windows CI that builds the installer.

### Removed

- The `git-kwdiff` shell subcommand, its tests and its CI. It lives on tag
  `v0.1.0`.

## [0.1.0] - 2026-11-13

### Added

- `git kwdiff <keyword>`: one unified diff for every commit whose message
  matches, across all branches, connected or not.
- `-n`: net cumulative diff, applied in a throwaway index.
- `-a`: also match commits whose changed lines contain the keyword.
- `-s`, `-o FILE`, `-V`.
- Merge commits diffed against their first parent.
- Tests and CI on Linux, macOS and Windows.

[Unreleased]: https://github.com/sqeezy/git-kwdiff/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sqeezy/git-kwdiff/releases/tag/v0.1.0
