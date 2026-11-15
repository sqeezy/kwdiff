# Desktop git clients: diffing several arbitrary commits

Which established desktop clients can select **N arbitrary commits** (including commits from
branches with no common ancestor) and read them as **one combined diff**? Sources: vendor
docs/manuals/release notes, read 2026-11-15; anything unstated by the vendor is *unconfirmed*.
kwdiff's baseline: patches per commit against its own parent (`diff-tree`), arbitrary N across
any refs, unified patch text per file.

## Comparison

| Client (2026) | N commits in one diff | Ancestor / range needed | Message search across refs | Result view | Windows |
|---|---|---|---|---|---|
| TortoiseGit 2.x | **2** (menu switches to a 2-revision menu) | No for the pair | Yes: search box + *All branches* | **Unified diff text** (GNU patch) | Yes, Windows-only |
| Git Extensions 7.2 | **2** (ctrl-click two revisions) | No for the pair | Partial: quick filter (message/author) over full grid | File tree + per-file diff, no patch | Yes |
| SmartGit | **2** ("exactly two" documented); 3+ *unconfirmed* | No for the pair | Yes: Graph **Filter** searches whole repo | Files list, then Changes view per file | Yes |
| Fork | **2** ("diff between two selected revisions") | No (*unconfirmed*) | Commit search; all-refs scope *unconfirmed* | File list + per-file text diff | Yes |
| Tower | **2** (or hash vs hash) | No (*unconfirmed*) | *Unconfirmed* | **External diff tool** only | Yes |
| GitKraken Desktop | **2** (Shift-click pair); N only if **consecutive** | Consecutive ⇒ range; 3+ non-contiguous refused | Yes: graph search | Commit Panel list + per-file diff | Yes |
| Sourcetree | Multi-select ⇒ diff *between* selected (range); 3+ *unconfirmed* | Range | *Unconfirmed* | File list + per-file diff | Yes |
| GitHub Desktop | **Contiguous range only** | Yes (consecutive) | No | File list + per-file diff | Yes |
| JetBrains Rider/IDEA | **2** via *Compare Versions*; 3+ *unconfirmed* | No for the pair | Yes: message/regex, branch = All | Changes window: file list + per-file diff | Yes |
| VS Code (built-in graph) | **1**; commit vs branch/tag | n/a | No | Multi-file diff editor | Yes |
| GitLens | **2** (Compare mode / Compare sheet) | No | Yes: graph search with operators | Compare sheet, file level | Yes |
| Git Graph (mhutchie) | **2** (ctrl/cmd-click) | No | Yes: Find widget (message/author/hash) | File tree + per-file diff | Yes |

Windows: [TortoiseGit](https://tortoisegit.org/) · [Git Extensions](https://gitextensions.github.io/) · [SmartGit](https://www.smartgit.dev/) · [Fork](https://git-fork.com/) · [Tower](https://www.git-tower.com/features/all-features) · [GitKraken](https://www.gitkraken.com/download) · [Sourcetree](https://www.sourcetreeapp.com/) · [GitHub Desktop](https://docs.github.com/en/desktop/installing-and-authenticating-to-github-desktop/supported-operating-systems) · [JetBrains](https://www.jetbrains.com/rider/) · [VS Code](https://code.visualstudio.com/download) · [GitLens](https://help.gitkraken.com/gitlens/).

## Per tool

**TortoiseGit** — the only client that emits patch text for a selection: "Show differences
as unified diff … between the two selected revisions … works for files and folders". With 3+
selected only *Combine to one commit* / *Cherry Pick* remain, so N = 2. *Format Patch…* is
range-based ("Range is choose range of from commit to to", git-format-patch), not a set.
Search covers messages and action summaries, plus *All branches* / *All* ref filter.
<https://tortoisegit.org/docs/tortoisegit/tgit-dug-showlog.html> ·
<https://tortoisegit.org/docs/tortoisegit/tgit-dug-patch.html>

**Git Extensions** — "You can show the difference between **any two** revisions by selecting
them using ctrl-click." No 3+ diff and no patch text: the Diff tab shows one file's visual diff,
the File tree tab the tree. Quick filter covers message/author/committer; branch filter accepts
raw `git log` args; grid shows all branches by default.
<https://git-extensions-documentation.readthedocs.io/en/main/browse_repository.html>

**SmartGit** — "Once **exactly two** commits are selected, the Files view will show the
changes from the older to the younger commit", read per file in the Changes view. The Log page
says "select one or more commits … to compare changes between commits" but defines behaviour
only for two, so 3+ is *unconfirmed*. Graph **Filter** searches "the entire repository".
<https://docs.smartgit.dev/latest/how-tos/workflows/how-to-compare-two-branches-commits> · <https://docs.smartgit.dev/latest/manual/gui/log> · <https://docs.smartgit.dev/latest/manual/gui/graph-view>

**Fork** — release notes 1.0.37 (6 Feb 2017): "Implemented possibility to see **diff between
two selected revisions**." Nothing later adds N-commit diffs; "Squash, drop and cherry pick for
multiple commits" (1.0.83) is actions, not diff. Unrelated pairs and all-refs search are
*unconfirmed*; output is a file list plus per-file text diff. <https://fork.dev/releasenotes>

**Tower** — select both commits and click *Compare*, or *Compare \<hash\> with Revision…* and
type the other hash; **the diff opens in the configured external diff tool**, so Tower renders
no combined patch itself. No documented 3+ selection; search scope *unconfirmed*.
<https://www.git-tower.com/help/guides/commit-history/compare-branches-revisions/mac>

**GitKraken Desktop** — "Selecting 2 commits shows the differences between them" (the quick
start uses Shift + click, i.e. adjacent). "Select **consecutive** commits … to show their
combined changes … titled *Viewing diff of N commits*." "If you select more than 2
**nonconsecutive** items, GitKraken Desktop explains why it cannot show a combined diff." The
only mainstream N-commit view, but along one line of history.
<https://help.gitkraken.com/gitkraken-desktop/diff/>

**Sourcetree** — "When selecting multiple commits in this view, you'll be able to view the
changes that have been made **between those commits**." Range semantics; nothing on
non-contiguous selection or 3+; per-file diffs, no patch text. (Atlassian page dated 2018 —
still the current doc.)
<https://confluence.atlassian.com/get-started-with-sourcetree/repository-history-and-code-diffs-847359147.html>

**GitHub Desktop** — History supports "a **range of multiple consecutive commits** using Ctrl
or Shift", then review the range's files. No message search, no patch output, no
non-contiguous selection.
<https://docs.github.com/en/desktop/making-changes-in-a-branch/viewing-the-branch-history-in-github-desktop>

**JetBrains (Rider/IDEA)** — "Select **any two** commits in the Log tab … and choose **Compare
Versions**. The Changes tool window with a list of files modified between the selected commits
opens", per-file diff via Ctrl+D. The Log accepts multi-selection beyond two and aggregates
changes, but the help documents only two — 3+ is *unconfirmed*. Search: message/hash/regex,
branch filter incl. *All*. <https://www.jetbrains.com/help/rider/Investigate_changes.html> ·
<https://www.jetbrains.com/help/idea/log-tab.html>

**VS Code — built-in Source Control Graph** — single commit: expand files, or right-click
*Open Changes* for a multi-file diff; commit vs ref via *Compare with…*, *Compare with Remote*,
*Compare with Merge Base*. No multi-commit selection, no message search.
<https://code.visualstudio.com/docs/sourcecontrol/history>

**GitLens** — Compare mode / Compare sheet compares **branches or commits** (two); *Compare
with Common Base* uses the merge base. No combined N-commit diff — the request is open
upstream. Graph search covers messages with operators. <https://help.gitkraken.com/gitlens/gl-commit-graph> ·
<https://github.com/gitkraken/vscode-gitlens/discussions/3469>

**Git Graph (mhutchie)** — "Compare any **two** commits by clicking on a commit, and then
CTRL/CMD clicking on another"; multi-select for other purposes is still an open request, so no
N-commit diff. Find widget searches message/date/author/hash/ref names.
<https://github.com/mhutchie/vscode-git-graph> · <https://github.com/mhutchie/vscode-git-graph/issues/182>

**Visual Studio 2026** (for completeness) — Ctrl-select two commits to compare; a 2025 update
added commit ↔ working tree. Still two-endpoint diffs.
<https://learn.microsoft.com/en-us/visualstudio/version-control/git-browse-repository?view=visualstudio>

## What none of them do

1. **Tick N>2 arbitrary commits and get one view.** The ceiling is 2 (TortoiseGit, Git
   Extensions, SmartGit, Fork, Tower, JetBrains, GitLens, Git Graph) or a *contiguous* range
   (GitKraken, GitHub Desktop, Sourcetree). GitKraken alone combines more than two, and refuses
   exactly the interesting case: non-consecutive commits.
2. **Drop the ancestry assumption.** Pairwise diffs need no merge base in git (`git diff A B`),
   but only TortoiseGit and Git Extensions even describe an arbitrary pair; every N>2 path is a
   range (`A^..B`, `A..B`, git-format-patch), which silently requires a common ancestor. On
   unrelated roots you get a whole-tree diff, an empty result or an error — undocumented, with
   no per-commit fallback.
3. **Combine message search with the selection.** TortoiseGit, SmartGit, JetBrains, GitLens
   and Git Graph search messages across refs, but none lets you search all refs, tick hits
   from different roots, and read *that set* as one result.
4. **Give unified patch text for a selection.** Only TortoiseGit emits a unified diff, and
   only for two commits; everyone else gives a file tree plus per-file diff panes, so
   reviewing a set means clicking through files.
5. **Say that the selection has no merge base.** No client surfaces "these commits share no
   ancestor" as a state, or treats it as normal rather than as an error. Range semantics are
documented git behaviour: <https://git-scm.com/docs/git-format-patch>, <https://git-scm.com/docs/git-range-diff>.
