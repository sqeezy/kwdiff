# kwdiff — notes for agents

A Windows desktop app for reviewing patches across git branches that share no
ancestor. Tauri 2 shell, Foldkit 0.170 on Effect 4.1.4, Rust owns git.

`docs/spec.md` is the source of truth for scope. The wayfinder map in
`docs/wayfinder/` is closed — decisions live there, new scope starts a new map.

## Commands

See `package.json` scripts; `npm run tauri dev` needs Rust and a real
repository, `npm run dev` runs the UI against the fixture in `src/mock.ts`.

## Rules the compiler cannot enforce

- **One Model, fact-named Messages, pure `update`.** Effects go in Commands;
  `update` returns data, never performs.
- **One Command per dispatch.** Foldkit's story runner resolves a single
  pending Command per message; if one message produces two, the second is
  silently dropped in tests and the state they answer goes stale. Merge them
  into one Command (see `LoadSelection`).
- **Command `execute` shape:** with `args`, `execute: (args) => Effect`;
  without args, `execute: <Effect>` — not a thunk. Getting this wrong surfaces
  as "no overload matches this call".
- **Staleness is explicit.** `searchId` and `patchId` increment on every
  request; results carrying an older id are ignored. Never trust arrival order.
- **IPC:** commit and ref lists are JSON; a patch travels as bytes through
  `tauri::ipc::Response`. Do not add a JSON path for large text.
- **Rust owns config.** `open_repo` and `search` record recents, last repo and
  the branch filter. The UI must not dispatch a config write — it would be a
  second Command on a message that already has one.
- **The window owns no document** (`Runtime.makeElement`). No `<head>`, no
  `document.title`; the OS title is set from Rust. Do not switch to
  `makeApplication` for a convenience.
- **Keys** stay clear of WebView2 accelerators: never bind `Mod+F`, `Mod+P`,
  `Mod+R`, `F5` (tauri#7418).

## Tests

`test/update.test.ts` runs `update` through `foldkit/story`. Every Command a
message emits needs a resolver in the story; a missing one fails loudly, which
is the point. New behaviour gets a test there before it gets a screenshot.

## Experimental

`prototype/foldkit-gui` holds the three-variant UI prototype that produced this
design. It is a reference, never merged.

## The test bench

The Windows checkout under test must be a **full clone**. A `git fetch --depth=N`
leaves a shallow boundary that silently truncates history: `git log main` shows
the depth, not the repository, and every "why is history missing" report becomes
a false alarm. `git rev-parse --is-shallow-repository` answers it; `git fetch
--unshallow https://github.com/sqeezy/kwdiff.git '+refs/heads/*:refs/remotes/origin/*'`
fixes it. Prefer HTTPS on the bench: its `origin` (an SSH alias) may have no key.
