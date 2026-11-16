# kwdiff v1 — spec

Collapsed from the wayfinder map (`docs/wayfinder/map.md`), which closed with
every ticket resolved. Implementation tickets are cut from this file.

## What it is

A Windows desktop app for reviewing changes across **unrelated** branches: open
a repository, search commit messages (and optionally changed lines) across every
ref, tick the commits that belong together, and read their patches side by side
in one three-pane window. It never checks out, stages, commits or merges.

What it does that no client does: a repository imported from SVN next to one
imported last year share no ancestor, and kwdiff still shows their commits and
patches together, because a patch is computed against a commit's own parent.

## Scope

**In v1** — open repository (any subfolder, resolved to the root), recents,
keyword search over messages, `-a` code search checkbox, branch filter, commit
checklist, file list, per-file patch pane, **two-endpoint compare**,
**filters (author, path, dates, regex)**, six non-content states, keyboard
accelerators.

**Out of v1** — export or copy of any patch; review notes (map #2); staging,
committing, merging, rebasing; commit graph, blame; plugins; i18n; telemetry;
tabs or multiple repositories; macOS/Linux; code signing; auto-update.

## Flow

1. Launch opens the last repository, or state 01 with recents and *Open
   repository…*.
2. Type a keyword: search after a 250 ms debounce, cancelled on the next
   keystroke; `Enter` runs immediately. The branch filter (default *All refs*)
   narrows the search without clearing ticks. *filters* opens a row of `git log`
   limits — author, path, since, until, and a regex toggle — that narrow the
   same search, also after the debounce.
3. Tick commits: the file pane lists the union of their files with added and
   removed counts; the diff pane shows the selected file's patch. A divider
   appears when the selection's commits share no ancestor. With **`-a`** on and
   a keyword, a commit matched by a changed line opens the file that contains it
   (marked with a dot) and the patch at the **hunk that matched**, highlighted
   by the same active-hunk style `n`/`p` use.
4. Compare two tips: pick a ref in each of the two slots beside the search
   field, or press `f` / `t` to put the commit under the cursor into the from /
   to slot. With both set the panes show `git diff A B` — a tree diff that
   needs no ancestor — and the same file list and patch pane are reused. The
   empty entry in a slot returns to the ticks, which were kept, not cleared;
   while comparing, a tick changes the checklist and nothing else.
5. Read. v1 has no output.

## Architecture

```
Tauri 2 (Windows x64, WebView2)
├── src/            Foldkit 0.170 + Effect 4.1.4, Tailwind v4
│   ├── app.ts      Model, Messages, update, init
│   ├── main.ts     view (Runtime.makeElement — owns no document)
│   ├── git.ts      Commands wrapping the Rust API
│   └── ui/         the three panes, from Variant B
└── src-tauri/      Rust: git commands, config, window title, permissions
```

- `Runtime.makeElement`, not `makeApplication`: no `<head>`, no
  `canonical`/`ogUrl`, no Foldkit crash view. The window title is set with
  `getCurrentWindow().setTitle("kwdiff — <root>")` (permission
  `core:window:allow-set-title`); a small crash surface offers *Reopen last
  repository* instead of `location.reload()`.
- No routing, no URL, no history. One window, one screen.
- The grid is sized for a fourth rail: `minmax(0,320px) minmax(0,214px)
  minmax(0,1fr)`. The notes rail of map #2 takes the right-hand column without
  re-laying out the other three.

## Rust API (`src-tauri/src/git.rs`)

```rust
#[tauri::command] async fn open_repo(path: String) -> Result<Repo, GitError>;
#[tauri::command] async fn search(state: State<'_, GitState>, id: u64,
    repo: String, keyword: String, code: bool, branch: Option<String>,
    filters: Filters) -> Result<Vec<Commit>, GitError>;
#[tauri::command] async fn cancel_search(state: State<'_, GitState>, id: u64)
    -> Result<(), GitError>;
#[tauri::command] async fn files(state: State<'_, GitState>, shas: Vec<String>,
    from: Option<String>, to: Option<String>, needle: Option<String>, regex: bool)
    -> Result<Vec<FilePatch>, GitError>;
#[tauri::command] async fn patch(state: State<'_, GitState>, shas: Vec<String>,
    path: String, from: Option<String>, to: Option<String>)
    -> Result<tauri::ipc::Response, GitError>;
#[tauri::command] async fn roots(state: State<'_, GitState>, shas: Vec<String>,
    from: Option<String>, to: Option<String>) -> Result<Vec<RootOf>, GitError>;
#[tauri::command] async fn refs(repo: String) -> Result<Vec<Ref>, GitError>;
```

- `files` also takes the code search's `needle` (and `regex`): it marks the
  files the pattern occurs in **at the commit** (`git grep -l -i -E -e <p> <sha>`;
  exit 1 is "no match", not a failure), so the pane can open the file that
  matched. A match that only exists in a *removed* line is not marked — the
  patch scan still finds it once that file is open.
- `files`, `patch` and `roots` take the pair. Both endpoints set is a tree
  diff: `git diff --no-renames A B`, `--numstat` for the list and per path for
  the patch. One endpoint alone is refused (`compare needs two endpoints`),
  because `git diff A` would silently mean *A against the worktree*.
  `--no-renames` keeps a rename as a delete plus an add, so every path in the
  list is a path the patch command can answer for.
- `GitState` holds `Mutex<Option<(u64, tokio::process::Child)>>`. A `search`
  with a newer `id` kills the previous child; `cancel_search` does the same on
  demand; both `kill().await` then `wait().await` to reap.
- Every git invocation: `--no-pager`, `GIT_PAGER=cat`, `kill_on_drop(true)`,
  `creation_flags(0x08000000)` on Windows, fixed argv — no shell, no
  interpolation.
- Commit and ref lists return JSON; **patches return bytes** through
  `tauri::ipc::Response` (JSON serialisation of a 5 MB patch is the slow path).
- Errors are a `serde::Serialize` enum so the UI can branch: `GitMissing`,
  `NotARepository { path }`, `Search { message }`, `Io { message }`.

```ts
type Commit = { sha: string; date: string; author: string; subject: string }
type FilePatch = { path: string; added: number; removed: number; isNew: boolean }
type RootOf = { sha: string; root: string }
type Ref = { name: string; kind: 'local' | 'remote' | 'tag' }
```

## Search semantics

`git log --all -i -E --grep=<pattern> --format=…` (plus `-S<pattern>` when `-a`
is ticked, unioned not intersected), newest first by commit date, capped at
**2 000** commits with a "narrow the keyword" hint, excluding `refs/stash`.
With a branch filter, the ref replaces `--all`. Matching is case-insensitive.

### Filters

One row under the top bar, each field passed straight to `git log`:

| Field | Argument | Notes |
| --- | --- | --- |
| author | `--author=<pattern>` | matched against the author name and email |
| path | `-- <pathspec>` | last, after `--`, or git reads it as a revision |
| since / until | `--since=`, `--until=` | a bare `until` date gets ` 23:59:59`, because midnight would drop that whole day |
| regex | `-E` | see below |

`-i -E` are always passed: `--author` is matched by the same grep machinery as
`--grep`, and `-E` decides what an escaped `\|` means. With the **regex** toggle
off (the default) the keyword and the author are literals — their ERE
metacharacters are escaped in Rust, so `a.b` finds `a.b` and not `axb`; with it
on they are extended regular expressions, and the `-a` pickaxe becomes `-G`
(regex) instead of `-S` (fixed string). Filters are not persisted and are
cleared when another repository opens.

## Roots and the divider

`git rev-list --max-parents=0 -- <sha>` per selected commit, cached per
`(repo, sha)`. The list shows no root badges; the diff shows one divider —
"these commits share no ancestor" — only when the selection spans more than one
root.

In compare mode the roots are asked for the two endpoints instead: the same root
means they share an ancestor, two roots mean they cannot, and that is exactly
when the divider is shown. A tree diff needs no ancestor either way, so the
comparison itself never fails on unrelated roots.

## States

| State | Where | Action |
| --- | --- | --- |
| Nothing open | overlay, panes dimmed | *Open repository…*, recents |
| No repository here or above | overlay | *Choose another folder…* |
| git not on PATH | overlay, needs 2.28+ | *How to install git*, *Re-check* |
| No matches | commits pane | echoes keyword and the rule, or the filters with a *Clear filters* action |
| Filtered away | commits pane | *Search all refs* |
| Running / cancelled | commits pane | results kept |

Artifact: `docs/wayfinder/prototypes/non-content-states.html`.

## Keyboard

`/` focus search · `j`/`k` next/previous commit · `space` toggle ·
`enter` focus the diff · `esc` leave the field, close the keymap or the filters
row · `f`/`t` use the commit under the cursor as the compare from/to endpoint ·
`x` swap the endpoints. Never bind `Mod+F`, `Mod+P`, `Mod+R`, `F5` (WebView2
accelerators cannot be disabled).

In the diff pane `j`/`k` and the arrows scroll by **lines** — the pane is one
`<pre>` scroller, so scrolling is view state and the model does not change —
while `n`/`p` step **hunks** and `g`/`shift+g` jump to the first and last.

## Config

One JSON file in the app data dir: `recents` (up to 10 repository roots),
`lastRepo`, per-repository `branch`. A deleted or unfetched ref falls back to
*All refs*. Neither the compare endpoints nor the filters are persisted: they
name refs and history of the repository that is open, and both are cleared when
another one opens.

## Performance

2 000 commits ≈ 400 KB of JSON, one `invoke`. Patches render one file at a time;
past **5 000** lines the pane says "showing the first 5 000 lines". No
virtualisation in v1; the cap is the strategy.

## Tests

- Foldkit story tests over `update`: toggle, select-all/none, keyword filter,
  branch filter keeping ticks, roots split, states, cancelled search,
  two-endpoint compare (one slot is inert, two replace the ticks, clearing
  returns to them, ticking while comparing does not reload, a stale selection
  answer never lands), filters (each change reaches the search Command's args,
  regex counts, clear resets, whitespace does not count, escape closes the row).
- Rust unit tests (`cargo test --lib`) over the arguments git receives: the ERE
  escaping for literals, an author pattern only when regex is on, the
  `until`-covers-its-day rule, and the pathspec after `--`. A fixture-repository
  suite is still missing (the spec claimed one before it existed).
- The e2e (`e2e/smoke.mjs`) drives the real window through `tauri-driver` and is
  **a gate**: 38 checks over the commit list, search, ticks, the patch pane (one
  scroller, PageDown), a file click, line scrolling and hunk stepping, the pane
  walk with `tab`/`esc`, two-endpoint compare and filters. A red run fails the
  build.
- CI on Windows: both suites, `npm run build`, `tauri build`, and a check that
  `__setDevToolsOverlay` is absent from `dist` (the runtime's own
  `foldkit-devtools` element id is not the overlay).

## Packaging

`tauri build` → NSIS installer and `.exe`, unsigned, attached to a GitHub
Release. No auto-update, no signing.

## Risks

- WebView2 accelerator keys cannot be disabled; the key set avoids them.
- `git` may be missing or old on the colleague's machine: state 03, checked at
  startup.
- Huge patches arrive as bytes; the 5 000-line notice keeps the pane honest.
- Foldkit 0.170 is young: pinned, upgraded by its own ticket.

## Next

Map #2 (review notes): anchors `(sha, path, side, line content)`, the notes rail
the grid reserves, Markdown export, right-click menu with "note here".
