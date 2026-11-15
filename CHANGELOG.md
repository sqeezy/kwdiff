# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

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
