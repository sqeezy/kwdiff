# kwdiff

[![CI](https://github.com/sqeezy/kwdiff/actions/workflows/ci.yml/badge.svg)](https://github.com/sqeezy/kwdiff/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A desktop app for reviewing changes across branches that share no ancestor.**

Open a repository, search commit messages across every ref — including a 2019
SVN import sitting next to `main` — tick the commits that belong together, and
read their patches side by side. A patch is computed against a commit's own
parent, so no merge base is needed anywhere.

## Why

```
git diff A B        two endpoints, no ancestry needed (A..B is the same thing)
git diff A...B      three-dot: needs a merge base
git log --all -p    every ref, as N separate patches
git log A..B        the set you wanted — on unrelated roots it quietly means
                    "all of B", which is why the wrong answer is invisible
```

No client offers the **set**: two endpoints, or a range, or a PR. Unrelated
imports, vendored histories and orphan branches are exactly where a range has
no meaning, so kwdiff composes the patches per commit instead — each is
diffed against its own parent, which needs nothing from the graph.

The competitive picture, with sources: [docs/research/competitive-landscape.md](docs/research/competitive-landscape.md).

## Run it

Needs Node 22+, Rust stable, and git 2.28+ on `PATH`.

```sh
npm install
npm run dev          # browser, with the fixture repository (no git needed)
npm run tauri dev    # the real window, against real git
npm test             # the update loop's story tests
npm run typecheck
```

Build the Windows installer:

```sh
npm run tauri build  # src-tauri/target/release/bundle/nsis/*.exe
```

## Shape

```
src/            Foldkit 0.170 on Effect 4.1.4
  app.ts        Model, Messages, update, Commands (debounce, cancel, load)
  ui.ts         the three panes
  api.ts        the seam: mockGit in the browser, tauriGit in the window
src-tauri/      Rust: seven git commands, cancellation, window
docs/spec.md    what v1 is and is not
docs/wayfinder/ the decision map this was built from
```

- The UI is one `Model`, fact-named `Message`s and a pure `update`. Effects are
  `Command`s: a 250 ms debounced search, a stale-result guard
  (`searchId`), a file-list load, a patch load.
- Rust owns git: `open_repo`, `refs`, `search`, `cancel_search`, `files`,
  `patch`, `roots`. Fixed argv, `--no-pager`, `kill_on_drop`, no shell.
- Patches cross the IPC bridge as bytes (`tauri::ipc::Response`), never as JSON.
- `Runtime.makeElement`: the window owns no document, sets its own title, and
  has its own crash surface.

## Status

v1 in progress. The UI, the update loop and its 14 story tests run today; the
Rust side is written and gets its first build in Windows CI.

## License

MIT.
