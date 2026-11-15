# CLI and next-generation VCS: one diff over unrelated commits

Companion to [desktop-clients.md](desktop-clients.md) (GUI clients). Question: what do CLI and newer
VCS/review tools do when N commits from branches **with no common ancestor** must be read as one
diff? Sources: docs, man pages, git's own source; *unconfirmed* = no vendor says so (read 2026-11-15).
Three layers: a **tree diff** (two endpoints) never needs ancestry; a **rev-list range** needs
reachability, not a common root; only **three-dot/merge-base** needs one.

| Tool | N commits in one diff | Unrelated roots | Limit |
|---|---|---|---|
| [git diff A B](https://git-scm.com/docs/git-diff) | 2 endpoints | **Yes** | no set; `git diff A..B C..D` rejected |
| [git diff A...B](https://git-scm.com/docs/git-diff) | 2 endpoints | **No** | `fatal: A...B: no merge base` |
| [git log --all --grep -p](https://git-scm.com/docs/git-log) / [format-patch](https://git-scm.com/docs/git-format-patch) | N, as N patches | **Yes** | stream, no combined view |
| [git range-diff](https://git-scm.com/docs/git-range-diff) | pairs two series | **Yes** (rev-list ranges) | diff *of* patches |
| [tig](https://jonas.github.io/tig/doc/manual.html) | per commit | any rev args | diff view = commit diff |
| [lazygit](https://github.com/jesseduffield/lazygit/blob/master/docs/keybindings/Keybindings_en.md) | 2 refs | Yes | range select is for actions |
| [jj](https://docs.jj-vcs.dev/latest/revsets/) | **yes, over a gap-free revset** | **Yes** | no cherry-picked set |
| [Sapling](https://sapling-scm.com/docs/commands/diff) | 2 revs (`-r A:B`) | Yes | stacks are linear |
| [git-branchless](https://github.com/arxanas/git-branchless/wiki/Command:-git-smartlog) | no | partly (revsets) | anchored at `main` |
| [Graphite](https://graphite.com/docs/visualize-stack) | per branch/PR | **No** | stack on `trunk` |
| [GitButler](https://docs.gitbutler.com/) | per branch/hunk | **No** | branches on one base |
| [delta](https://github.com/dandavison/delta) / [diff-so-fancy](https://github.com/so-fancy/diff-so-fancy) | formats given text | n/a | computes nothing |
| [Beyond Compare](https://www.scootersoftware.com/kb/vcs) / [Kaleidoscope](https://kaleidoscope.app/help/docs/git-changesets) / Meld | 2 endpoints | Yes for the pair | one file pair per `difftool` call |
| [Reviewable](https://docs.reviewable.io/) / [Gerrit](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html) / [Crucible](https://confluence.atlassian.com/crucible/adding-content-to-the-review-298977455.html) | per PR / change / branch | **No** | base branch is the frame |
| [GitHub compare](https://docs.github.com/en/pull-requests/reference/branches) | 2 endpoints | 2-dot yes, 3-dot (PR default) no | unrelated pair *unconfirmed* |
| [GitLab compare](https://docs.gitlab.com/user/project/repository/compare_revisions/) | 2 endpoints | **Yes, both modes** | still 2 endpoints |
| [hg diff --from --to](https://www.mercurial-scm.org/help/commands/diff) | 2 revs | **Yes** | no set |

## git itself

- **Tree diff, no ancestry; two endpoints is the ceiling.** `git diff <commit> <commit>`: "This is to
  view the changes between two arbitrary `<commit>`"; `<commit>..<commit>` is "synonymous to the
  earlier form (without the `..`)"; and "`diff` is about comparing two _endpoints_, not ranges". So
  `git diff A..B` needs **no** common ancestor (unlike `git diff A...B`), and `symdiff_prepare` in
  `builtin/diff.c` still weeds out "bogus range-based revision specifications".
- **Three-dot is the one merge-base form.** "starting at a common ancestor of both `<commit>`.
  `git diff A...B` is equivalent to `git diff $(git merge-base A B) B`"; with no base it dies
  `die(_("%s...%s: no merge base"))`, and `--merge-base` dies `die(_("no merge base found"))`.
- **Ranges don't error; they answer a different question.** `git log A..B` / `format-patch A..B` on
  unrelated A gives *all* of B's history, patches still vs their own parent (`A..B` is `^A B`,
  [gitrevisions](https://git-scm.com/docs/gitrevisions)) — quietly "everything on the other side".
- **The search already spans roots.** `--all`: "Pretend as if all the refs in `refs/`, along with
  `HEAD`, are listed"; `--grep`: "Limit the commits output to ones with a log message that matches".
  `git log --all --grep=X -p` is kwdiff's corpus as a stream: no selection, no per-file grouping.
- **`git range-diff` needs no merge base.** Ranges are rev-list ranges: `<rev1>...<rev2>` "is
  equivalent to `<rev2>..<rev1> <rev1>..<rev2>`", and `builtin/range-diff.c` calls no merge-base
  function; `A^!`/`B^!` compares two single unrelated patches. Its output "is not intended to be
  machine-readable", and it is a diff of patches, not of the set.

## Terminal viewers

tig: "The diff view — Shows either the diff of the current working tree … or the commit diff complete
with log message, diffstat and diff"; every view is fed by `git log/show/diff`, so N commits is a
*list* (`tig A..B`). lazygit has "View diffing options … diffing two refs" and range select (`v`,
`shift+↑/↓`), but the docs tie range select to squash/cherry-pick/patch building. [gitk](https://git-scm.com/docs/gitk)
takes rev-list options and `--all` ("Show all refs"), so roots appear; its diff pane stays per-commit.

## Jujutsu

- Revsets are algebra: `x..y` is "Ancestors of `y` that are not also ancestors of `x` … Note that this
  is _not_ a "path" between `x` and `y` — `x` and `y` do not need to be related by ancestry."
- `jj diff -r` gives **one total diff**: "`jj diff -r B::D` equals `jj diff --from A --to D`. Multiple
  heads and/or roots are supported, but gaps in the revset are not supported (e.g. `-r 'A|C'`)".
- Source agrees: `from_tree` is the merge of parents **outside** the revset, `to_tree` the merge of
  heads (`cli/src/commands/diff.rs`). A git root's parent is jj's virtual root ("Orphan branch: Yes …
  a virtual root commit that appears as parent of all commits Git would call root commits"), so
  unrelated roots diff from the empty tree. `--from A --to B` is any endpoint pair; `jj interdiff`
  compares patches and "will not include the changes between their parents". Limits: the set must be
  gap-free, and output is a terminal diff — no ticks, notes or window.

## Stacked-change tools

Sapling: `sl diff -r 5be761874:431ec8e07` diffs two arbitrary commits ("compare two historical
versions of a directory"); `fold`/`split`/`absorb` edit a linear stack. git-branchless: smartlog
revsets, `git move`, restack — workflow, never a diff of a set. Graphite: `gt log --stack`, one branch
and PR per layer on `trunk`, GitHub-only. GitButler: branches in one worktree, diffs per branch/hunk,
all on a base. All four are *linear*, with no vocabulary for two roots.

## Diff viewers, mergers, hosted review

delta and diff-so-fancy restyle a diff someone else made ("delta aims to make this both efficient and
enjoyable … extensive changes to the layout and styling of diffs"). Beyond Compare's documented VCS
use is `diff.tool`/`merge.tool` with `$LOCAL`/`$REMOTE` — one file pair per call. Kaleidoscope
documents `git difftool <HASH1> <HASH2>` for "two arbitrary commits"; its "comparing multiple
commits" has no N>2 command (*unconfirmed*). Meld compares two/three files or folders. All are
endpoint or single-file tools — but any can render the patch text a window composes.

Gerrit: "The change screen only presents one pair of patch sets (`Patchset A` and `Patchset B`) at a
time … If patchset 'A' is not selected a parent commit of patchset 'B' is used by default", and
relation chains are rebased onto the parent — ancestry is structural. Crucible's branch review is
base-relative: "changesets on the branch that have not yet been merged to the base branch".
Reviewable is GitHub/PR-scoped but the richest per-set tool: "Combine commits for review, or review
each commit separately". GitHub PRs "show a three-dot diff" framed by "the most recent common commit
of both branches (merge base)"; two-dot is available; unrelated pairs *unconfirmed*. GitLab alone
offers both as a choice in its compare page: default `git diff <from>...<to>` "uses the merge base",
the other "compares the actual commits directly". No tool advertises "tick N commits across roots and
read them as one diff" — only `hg diff --from/--to`, jj's "need not be related by ancestry", GitLab's
second mode, git's "two arbitrary commits" and kwdiff.

## Corrections for kwdiff's own one-pager

- `git diff A..B` **does** work on unrelated roots (docs: synonymous with `git diff A B`), and
  `range-diff` needs no merge base either; what they cannot do is one diff of a *set*. What breaks in
  clients is the three-dot default (GitHub/GitLab compare, "compare with common base").

## The gap a GUI could own

- **The selection as the unit.** git takes ≤2 endpoints or a reachability range; jj a gap-free revset;
  range-diff two series; every reviewer a PR. An arbitrary ticked set, held as state, is unoccupied.
- **Per-file composition across commits.** CLIs emit N patch headers in a stream; none groups "this
  file, as each of the five commits touched it". That grouping is the review, and it needs a model.
- **Naming the foreign-history case instead of failing.** `git diff A...B` dies; GitHub compare likely
  shows nothing. A window can say "no common ancestor — each patch against its own parent": a state,
  not an error, flagging paths from two roots at once.
- **Search-to-selection continuity.** `--grep` already spans all refs; persisting query, hits and ticks
  together is what the CLI cannot do, and delta or Beyond Compare can render the text it composes.
- **Admit the limit.** No canonical single diff of a set exists (per-commit patches or two endpoints):
  present the composed stream, never "the" diff, and keep CLI-grade filtering for sets too big to tick.
