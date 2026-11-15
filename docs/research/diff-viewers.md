# Rendering the patch pane: what we can embed

What can kwdiff adopt for its diff pane — a **single unified patch text**, possibly concatenating
several commits and files — without React, in a Tauri 2 webview (WebView2 = Chromium), and
**without `innerHTML` of untrusted repository content**. Versions read 2026-11-15 from the npm
registry, the shipped bundles on jsDelivr and each project's docs/source; anything a project does
not state is marked *unconfirmed*.

## Comparison

| Option (version) | Input | Framework | Output | Side-by-side | Syntax colour | 5k+ lines | Licence | Untrusted text |
|---|---|---|---|---|---|---|---|---|
| [diff2html](https://github.com/rtfpessoa/diff2html) 3.4.56 | patch text, **concatenate files/commits** | none | **HTML string** | yes (`outputFormat`) | highlight.js only (optional dep), or none | no virtualisation; per-file collapse | MIT | lines escaped, **file paths not** → avoid `innerHTML` |
| [@pierre/diffs](https://diffs.com/docs) 1.6.4 | patch (`parsePatchFiles`) **or** two contents | none (vanilla `FileDiff`/`CodeView`), React optional | HTML strings → **Shadow DOM** custom element | yes (`diffStyle: 'split'\|'unified'`) | Shiki (js/wasm engine) or Highlights | yes — line virtualisation in `CodeView` | Apache-2.0 | escaped by hast serialisation; no published security note |
| [Shiki](https://shiki.style/guide/grammar-state) 4.6.0 | one string of code, per language | none | **token arrays** (`codeToTokens`) or HTML | n/a | yes, the point | ours to solve (DOM) | MIT | tokens = no HTML at all |
| [jsdiff](https://github.com/kpdecker/jsdiff) 9.0.0 | **two strings**, but also `parsePatch(patchText)` | none | data | n/a | none | n/a | BSD-3-Clause | no HTML |
| [Monaco](https://github.com/microsoft/monaco-editor) DiffEditor 0.57.0 | **two `ITextModel`s** (`setModel({original, modified})`), not a patch | none | canvas/DOM editor | yes (`renderSideBySide`) | built-in TextMate | viewport-rendered | MIT | text models, no HTML from us |
| [CodeMirror 6 merge](https://codemirror.net/docs/ref/#merge) 6.12.3 | **two docs** (`MergeView a/b`, `unifiedMergeView({original})`), not a patch | none | DOM editor | yes (two-editor `MergeView`) | via `@codemirror/language` + Lezer | viewport-rendered | MIT | DOM text nodes |
| [react-diff-view](https://github.com/otakustay/react-diff-view) 3.3.3 | patch text (`parseDiff`) | **React ≥16.14** | React elements | yes | tokens/refractor | lazy-load yourself | MIT | React escapes |
| [git-diff-view](https://github.com/MrWangJustToDo/git-diff-view) `@git-diff-view/core` 0.1.8 | hunks + both file contents | React/Vue/Solid/Svelte wrappers (**no vanilla package**) | framework elements | yes | lowlight / Shiki / Lezer | worker + "template mode" | MIT | hast-based |
| [diff-view-element](https://github.com/KonnorRogers/diff-view-element) 1.0.2 | **two strings** | Lit web component | Shadow DOM | two panes only, no unified patch | Prism, *unconfirmed* quality | no | MIT | Lit escapes |

## Per option

**diff2html** — README: "accepts the text contents of a unified diff or the superset format git
diff… To provide multiple files as input just concatenate the diffs (just like the output of
`git diff`)". So a multi-commit, multi-file patch is its native input. API is either
`Diff2Html.html(patch, config)` → **an HTML string you must inject**, or `Diff2Html.parse()` → data.
Config: `outputFormat: 'line-by-line' | 'side-by-side'`, `drawFileList`, `matching: 'lines' |
'words' | 'none'`, `diffStyle`, `colorScheme`, `renderNothingWhenEmpty`.
Colouring is **highlight.js only** (an `optionalDependencies` entry; `diff2html-ui` variants bundle
it, `…-ui-base` lets you pass your own). No Shiki path. Its own troubleshooting page says large
diffs are slow and advises `matching: 'none'`; there is no virtualisation.
Licence MIT, bundle `bundles/js/diff2html.min.js` **77.7 KB** (parser + HTML generator).
Untrusted text: line *content* goes through `escapeForHtml` in `deconstructLine`
(`src/render-utils.ts`), but the file header is `{{{filePath}}}` fed by `filenameDiff(file)` with no
escaping in `line-by-line-renderer.js`, so a path containing `<` reaches the HTML raw. On Windows
(`<>:"|?*` illegal in filenames) that is hard to reach, but the parser is stateless per
`diff --git` block, so a crafted patch string is enough. Treat its output as untrusted HTML.
Also: one card per `diff --git` block — the same path in two commits appears twice (verified in
`src/diff-parser.ts`; the parser never merges blocks).

**@pierre/diffs** — exists, is significant, and is the only mature **framework-free** patch viewer
here. Vanilla API: `parsePatchFiles(patch)` → `FileDiffMetadata[]`, then `new FileDiff(options)`
per file, or `new CodeView({...})` for one virtualised scroll region (`setup`, `setItems`,
`scrollTo`). Options of interest: `diffStyle: 'unified' | 'split'`, `overflow: 'scroll' | 'wrap'`,
`theme`, `disableLineNumbers`, `diffIndicators`; `loadDiffFiles` is only needed for
*expanding* unchanged regions or editing. Rendering model: lower layers produce HAST/HTML strings,
higher layers paint them into **Shadow DOM** with CSS grid; `CodeView` does per-line virtualisation
with their "inverse sticky" technique, and the blog post names Tauri as a target they cared about.
Highlighting: Shiki with a JS regex engine by default, wasm or their own wasm lexers optionally; a
worker-pool export exists. Bundle: `dist` is **2.74 MB** of JS+CSS across 244 chunks (lazy, a 1.3 MB
worker chunk dominates); actually imported route will be a fraction *unconfirmed*.
Licence Apache-2.0 (npm metadata); React is an **optional** peer dep. No public security statement
about hostile input — escaping is by construction (`hast-util-to-html` + text nodes), *unconfirmed*
by test or advisory. Caveat for us: Shadow DOM means Tailwind classes do not apply inside; theming
goes through its own CSS variables, and the package is 1.x and moving fast.

**Shiki** — the right piece if we keep our own renderer. `highlighter.codeToTokens(code, {lang,
theme})` returns `TokensResult` (`tokens: ThemedToken[][]`, each token `{content, offset, color,
fontStyle, htmlStyle}`), i.e. **data we can turn into `h` elements** — no innerHTML, no sanitiser.
Patches are not whole files, but grammar continuity is documented: `getLastGrammarState(tokens)` →
`grammarState` option on the next `codeToTokens` call, plus `grammarContextCode` to re-seed a hunk
that starts mid-construct. Cost: `@shikijs/core` entry 51 KB plus lazy chunks, **one grammar per
language** (`@shikijs/langs/typescript` 190 KB), loaded on demand; the 466 KB `onig.wasm` is skipped
with the JS regex engine. MIT. The DOM cost is ours: a 5k-line patch is ~40k spans.

**jsdiff** — partly a category error, partly a gift. Its diff functions compare two strings, so they
cannot consume a patch; but the same package ships **`parsePatch(patchText)`** → structured
`{oldFileName, newFileName, hunks[{oldStart, newStart, lines}]}`, with Git fields
(`isGit`, `isRename`, `isCreate`…), plus `applyPatch` and `diffWords`/`diffChars` for intra-line
emphasis. That is the cheapest way to get hunk structure and word-level highlighting without a
renderer, and it composes with Shiki. BSD-3-Clause, `diff.min.js` 37 KB.

**Monaco DiffEditor** — `createDiffEditor(el, options)` then `setModel({original, modified})`: it
needs **two `ITextModel`s**, never a patch, so we would have to keep both file contents (or
reconstruct them by applying hunks). It brings its own keyboard model, focus handling and workers,
which fights a Foldkit keymap (`n`/`p`/`g`), and `min/vs` is **24.4 MB across 151 files** (lazy
chunks, 2.7 KB loader). MIT, but the wrong shape for a read-only review pane.

**CodeMirror 6 merge** — same shape problem: `MergeView({a: {doc}, b: {doc}})` and
`unifiedMergeView({original: text})` both want documents, and it computes its own diff; there is no
patch entry point (a `setChunks` effect exists internally but is not a supported import path
*unconfirmed*). Cost: `@codemirror/merge` 71.7 KB + `@codemirror/view` 484 KB unminified + state.
MIT. Good if we later want accept/reject per hunk, not for showing a patch we already have.

**react-diff-view** — the best-shaped API of all (`parseDiff(patchText)`, `viewType: 'unified' |
'split'`, decoration and widget hooks) and it is **React-only** (`peerDependencies: react >=16.14`);
no vanilla adapter. MIT.

**git-diff-view** — good engine, and `@git-diff-view/core` is framework-free, but it is a *model +
data* layer: the shipped UI packages are React/Vue/Solid/Svelte/Lynx, and a `packages/dom` folder
exists in the repo containing only a `package.json` (`@git-diff-view/dom` is **not on npm**). Its
core constructor is `new DiffFile(oldFileName, oldFileContent, newFileName, newFileContent,
hunkStrings[], oldLang, newLang)`. MIT, core ESM 197 KB.

**diff-view-element** — a Lit web component comparing **two strings**, two panes, no unified patch,
no file concept, no commit context. Wrong input, though it is the friendliest embedding story (a tag).
MIT, deps `lit` + `diff` + `prism-esm`.

**Mergely** — CodeMirror 5 + jQuery era; its own docs say it has no syntax highlighting "out of the
box" and needs custom builds. Skip; `@codemirror/merge` is the maintained descendant.

## Recommendation

For a vanilla-TS app that refuses `innerHTML` on repository content:

1. **Do the rendering ourselves, and buy only the hard parts.** `jsdiff.parsePatch` for hunk
   structure (35 KB), Shiki `codeToTokens` + `getLastGrammarState` for colour, Foldkit `h` for the
   DOM: tokens become `h.span` with `style: color`. Nothing untrusted is ever a string of markup.
   This keeps the existing hunk `id`s and `n`/`p`/`g` keymap intact, which is kwdiff's actual feature.
2. **Virtualise with CSS, not with a library.** Wrap each file block in
   `content-visibility: auto; contain-intrinsic-size: auto 400px` (Chromium ≥85, i.e. WebView2) so
   off-screen files skip layout/paint; `n`/`p` still scroll by `id`.
3. **Adopt `@pierre/diffs` (vanilla `FileDiff`/`CodeView`) only if we want split view, sticky file
   headers, line selection and true virtualisation before we build them.** It is the one option here
   that takes a patch, has no framework requirement, and solves scale. Plan for its Shadow DOM (own
   theme variables, no Tailwind inside) and for a 1.x API that moves.
4. **Do not ship diff2html into `innerHTML`.** Its file-header path is unescaped, and it has no
   virtualisation; if we ever want its GitHub look, take `Diff2Html.parse()` (data) and render that
   with our own `h`, or run the HTML through a sanitiser **and** rebuild the file headers.
5. **Reject Monaco and CodeMirror merge for this pane:** both need both sides of every file, bring
   an editor's keyboard/focus model, and neither accepts a patch.

Worth a spike: Shiki-tokenised DOM at 5 000 lines in WebView2 with `content-visibility`, at 390 px
and 1280 px, against a 30-line prototype of `@pierre/diffs` `FileDiff` on the same patch.
