// The whole git surface of kwdiff: seven commands, fixed argv, no shell.
//
// Not compiled in the session that wrote it (no Rust toolchain on the phone);
// the Windows CI job is its first build.
use std::path::Path;
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("git is not on PATH")]
    GitMissing,
    #[error("not a git repository: {path}")]
    NotARepository { path: String },
    #[error("{message}")]
    Search { message: String },
    #[error("{message}")]
    Io { message: String },
}

// The UI branches on `kind`, so it is serialised flat, not as a Rust enum.
impl Serialize for GitError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (kind, message) = match self {
            GitError::GitMissing => ("git-missing", self.to_string()),
            GitError::NotARepository { .. } => ("not-a-repo", self.to_string()),
            GitError::Search { .. } => ("search", self.to_string()),
            GitError::Io { .. } => ("io", self.to_string()),
        };
        let mut state = serializer.serialize_struct("GitError", 2)?;
        state.serialize_field("kind", kind)?;
        state.serialize_field("message", &message)?;
        state.end()
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub sha: String,
    pub date: String,
    pub author: String,
    pub subject: String,
    /// The message body: the part a reviewer reads for the *why*.
    pub body: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FilePatch {
    pub path: String,
    pub added: u32,
    pub removed: u32,
    pub is_new: bool,
    /// The code search's pattern occurs in this file **at the commit**, so the
    /// patch pane can open at the hunk that matched instead of line 1.
    pub matched: bool,
}

#[derive(Serialize, Clone)]
pub struct RootOf {
    pub sha: String,
    pub root: String,
}

#[derive(Serialize, Clone)]
pub struct Ref {
    pub name: String,
    pub kind: String,
}

#[derive(Serialize, Clone)]
pub struct Repo {
    pub name: String,
    pub root: String,
}

// What `git log` already offers: author pattern, date range, pathspec, and
// whether the keyword/author are patterns or literals. Empty means unset.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Filters {
    pub author: String,
    pub path: String,
    pub since: String,
    pub until: String,
    pub regex: bool,
}

// git's --grep and --author are regular expressions. With the regex toggle off
// the field is a literal, so its metacharacters are escaped — in extended
// syntax, where `\\.` is a dot and `\\+` is a plus.
fn literal(pattern: &str) -> String {
    let mut escaped = String::with_capacity(pattern.len());
    for ch in pattern.chars() {
        if "\\.^$|?*+()[]{}".contains(ch) {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

fn filter_args(filters: &Filters) -> Vec<String> {
    let mut args = Vec::new();

    let author = filters.author.trim();
    if !author.is_empty() {
        let author = if filters.regex { author.to_string() } else { literal(author) };
        args.push(format!("--author={author}"));
    }

    let since = filters.since.trim();
    if !since.is_empty() {
        args.push(format!("--since={since}"));
    }

    let until = filters.until.trim();
    if !until.is_empty() {
        // A bare date is midnight, which would silently drop that whole day:
        // "until the 16th" has to include the 16th.
        let until = if until.len() == 10 && until.as_bytes()[4] == b'-' {
            format!("{until} 23:59:59")
        } else {
            until.to_string()
        };
        args.push(format!("--until={until}"));
    }

    args
}

// The pathspec goes last, after a `--`, or git reads it as a revision.
fn path_args(filters: &Filters) -> Vec<String> {
    let path = filters.path.trim();
    if path.is_empty() {
        Vec::new()
    } else {
        vec!["--".to_string(), path.to_string()]
    }
}

// One record per commit, NUL-terminated, fields separated by unit separators:
// a body is multi-line and may contain tabs, so neither newline nor tab can be
// the delimiter. `splitn(5, …)` keeps a stray separator inside the body.
const LOG_FORMAT: &str = "--format=%H%x1f%ad%x1f%an%x1f%s%x1f%b%x00";

fn parse_commits(raw: &str) -> Vec<Commit> {
    let mut commits: Vec<Commit> = Vec::new();
    for record in raw.split('\0') {
        // git appends a newline after each record's terminating NUL.
        let record = record.trim_matches('\n');
        if record.is_empty() {
            continue;
        }
        let mut fields = record.splitn(5, '\u{1f}');
        let (Some(sha), Some(date), Some(author), Some(subject)) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        if commits.iter().any(|commit| commit.sha == sha) {
            continue;
        }
        commits.push(Commit {
            sha: sha.to_string(),
            date: date.to_string(),
            author: author.to_string(),
            subject: subject.to_string(),
            body: fields.next().unwrap_or("").trim_matches('\n').to_string(),
        });
    }
    commits
}

// At most one search runs at a time; a newer id kills the older child.
#[derive(Default)]
pub struct GitState {
    repo: Mutex<Option<String>>,
    current: Mutex<Option<(u64, Child)>>,
}

async fn repo_of(state: &GitState) -> Result<String, GitError> {
    state
        .repo
        .lock()
        .await
        .clone()
        .ok_or_else(|| GitError::Io { message: "no repository open".into() })
}

fn base(repo: &str) -> Command {
    let mut command = Command::new("git");
    command
        .current_dir(repo)
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .arg("--no-pager")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn io_error(error: std::io::Error) -> GitError {
    if error.kind() == std::io::ErrorKind::NotFound {
        GitError::GitMissing
    } else {
        GitError::Io { message: error.to_string() }
    }
}

async fn output(repo: &str, args: &[String]) -> Result<String, GitError> {
    let out = base(repo)
        .args(args)
        .output()
        .await
        .map_err(io_error)?;
    if !out.status.success() {
        return Err(GitError::Io {
            message: String::from_utf8_lossy(&out.stderr).trim().to_string(),
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

async fn kill_current(state: &GitState) {
    let taken = { state.current.lock().await.take() };
    if let Some((_, mut child)) = taken {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

// Both endpoints or neither. A single one is a UI bug, and git diff would
// silently read it as "worktree against a commit", which is not what was asked.
fn endpoints(
    from: &Option<String>,
    to: &Option<String>,
) -> Result<Option<(String, String)>, GitError> {
    match (from, to) {
        (None, None) => Ok(None),
        (Some(from), Some(to)) => Ok(Some((from.clone(), to.clone()))),
        _ => Err(GitError::Io { message: "compare needs two endpoints".into() }),
    }
}

// `git diff --numstat` lines are `added\tremoved\tpath`; a binary file has `-`
// for both counts. `--no-renames` keeps a rename as a delete plus an add, so
// the path in the list is always a path the patch command can answer for.
fn numstat(raw: &str) -> Vec<(u32, u32, String)> {
    raw.lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let (Some(added), Some(removed), Some(path)) =
                (fields.next(), fields.next(), fields.next())
            else {
                return None;
            };
            Some((
                added.parse().unwrap_or(0),
                removed.parse().unwrap_or(0),
                path.to_string(),
            ))
        })
        .collect()
}

// Spawns a git process, registers it as the live one, reads it to the end.
async fn run_tracked(state: &GitState, id: u64, repo: &str, args: &[String]) -> Result<String, GitError> {
    kill_current(state).await;

    let mut child = base(repo)
        .args(args)
        .spawn()
        .map_err(io_error)?;
    let mut stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            return Err(GitError::Io { message: "git produced no stdout".into() });
        }
    };

    {
        let mut slot = state.current.lock().await;
        *slot = Some((id, child));
    }

    let mut buffer = Vec::new();
    let read = stdout.read_to_end(&mut buffer).await;

    let taken = { state.current.lock().await.take() };
    if let Some((_, mut child)) = taken {
        let _ = child.wait().await;
    }
    read.map_err(io_error)?;

    Ok(String::from_utf8_lossy(&buffer).into_owned())
}

#[tauri::command]
pub async fn open_repo(
    state: tauri::State<'_, GitState>,
    app: tauri::AppHandle,
    path: String,
) -> Result<Repo, GitError> {
    let root = base(&path)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .await
        .map_err(io_error)?;

    if !root.status.success() {
        return Err(GitError::NotARepository { path });
    }
    let root = String::from_utf8_lossy(&root.stdout).trim().to_string();
    let name = Path::new(&root)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.clone());

    *state.repo.lock().await = Some(root.clone());
    crate::config::record_open(&app, &root);

    Ok(Repo { name, root })
}

#[tauri::command]
pub async fn refs(repo: String) -> Result<Vec<Ref>, GitError> {
    let raw = output(&repo, &["for-each-ref".into(), "--format=%(refname)".into()]).await?;

    Ok(raw
        .lines()
        .filter_map(|line| {
            let (name, kind) = if let Some(rest) = line.strip_prefix("refs/heads/") {
                (rest, "local")
            } else if let Some(rest) = line.strip_prefix("refs/remotes/") {
                (rest, "remote")
            } else if let Some(rest) = line.strip_prefix("refs/tags/") {
                (rest, "tag")
            } else {
                return None;
            };
            Some(Ref { name: name.to_string(), kind: kind.to_string() })
        })
        .collect())
}

#[tauri::command]
pub async fn search(
    app: tauri::AppHandle,
    state: tauri::State<'_, GitState>,
    id: u64,
    repo: String,
    keyword: String,
    code: bool,
    branch: Option<String>,
    filters: Filters,
) -> Result<Vec<Commit>, GitError> {
    crate::config::record_branch(&app, &repo, branch.as_deref());
    let needle = keyword.trim().to_string();
    // Literal unless the regex toggle says otherwise, for the message search
    // and the author alike.
    let pattern = if filters.regex { needle.clone() } else { literal(&needle) };
    let mut args: Vec<String> = vec!["log".into()];
    match &branch {
        Some(branch) => args.push(branch.clone()),
        None => args.push("--all".into()),
    }
    // `-i` and `-E` belong to the whole grep machinery, not just --grep: the
    // author pattern is matched with the same syntax, and an escaped `\|` is a
    // literal pipe only in extended mode. Passing them unconditionally is what
    // keeps `--author` and `--grep` reading the same way.
    args.extend(["-i".into(), "-E".into()]);
    // An empty field is a full search: no --grep, everything the filters allow.
    if !needle.is_empty() {
        args.push(format!("--grep={pattern}"));
    }
    args.extend(filter_args(&filters));
    args.extend([
        "--date=short".into(),
        LOG_FORMAT.into(),
        "--max-count=2000".into(),
        "--exclude=refs/stash".into(),
    ]);
    args.extend(path_args(&filters));

    let mut raw = run_tracked(&state, id, &repo, &args).await?;

    // -a is a union, not an intersection: messages and changed lines separately.
    // The pickaxe is a fixed string unless the regex toggle is on, where -G
    // takes the same extended pattern as --grep.
    if code && !needle.is_empty() {
        let mut code_args: Vec<String> = vec!["log".into()];
        match &branch {
            Some(branch) => code_args.push(branch.clone()),
            None => code_args.push("--all".into()),
        }
        code_args.extend(["-i".into(), "-E".into()]);
        code_args.push(if filters.regex { format!("-G{pattern}") } else { format!("-S{needle}") });
        code_args.extend(filter_args(&filters));
        code_args.extend([
            "--date=short".into(),
            LOG_FORMAT.into(),
            "--max-count=2000".into(),
        ]);
        code_args.extend(path_args(&filters));
        raw.push('\n');
        raw.push_str(&run_tracked(&state, id, &repo, &code_args).await?);
    }

    Ok(parse_commits(&raw))
}

#[tauri::command]
pub async fn cancel_search(state: tauri::State<'_, GitState>, _id: u64) -> Result<(), GitError> {
    kill_current(&state).await;
    Ok(())
}

// Which paths of a commit contain the pattern. `git grep <rev>` searches the
// tree at that commit, which is where an added line lives; a keyword that only
// occurs in a *removed* line is not listed here, and the patch scan still finds
// it once that file is open. Exit code 1 means "no match", not a failure.
async fn grep_paths(repo: &str, sha: &str, pattern: &str) -> Result<Vec<String>, GitError> {
    let out = base(repo)
        .args(["grep", "-l", "-i", "-E", "-e", pattern, sha, "--"])
        .output()
        .await
        .map_err(io_error)?;
    if !out.status.success() && out.status.code() != Some(1) {
        return Err(GitError::Io {
            message: String::from_utf8_lossy(&out.stderr).trim().to_string(),
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| line.split_once(':').map(|(_, path)| path.to_string()))
        .collect())
}

#[tauri::command]
pub async fn files(
    state: tauri::State<'_, GitState>,
    shas: Vec<String>,
    from: Option<String>,
    to: Option<String>,
    needle: Option<String>,
    regex: bool,
) -> Result<Vec<FilePatch>, GitError> {
    let repo = repo_of(&state).await?;
    let pattern = needle
        .as_deref()
        .map(str::trim)
        .filter(|needle| !needle.is_empty())
        .map(|needle| if regex { needle.to_string() } else { literal(needle) });

    // A tree diff with no ancestry: this is the whole of two-endpoint compare.
    if let Some((from, to)) = endpoints(&from, &to)? {
        let raw = output(
            &repo,
            &[
                "diff".into(),
                "--numstat".into(),
                "--no-renames".into(),
                from,
                to,
            ],
        )
        .await?;
        return Ok(numstat(&raw)
            .into_iter()
            .map(|(added, removed, path)| FilePatch {
                path,
                added,
                removed,
                is_new: added > 0 && removed == 0,
                matched: false,
            })
            .collect());
    }

    let mut files: Vec<FilePatch> = Vec::new();
    for sha in &shas {
        let raw = output(
            &repo,
            &[
                "show".into(),
                "--numstat".into(),
                "--format=".into(),
                sha.clone(),
            ],
        )
        .await?;
        let matched = match &pattern {
            Some(pattern) => grep_paths(&repo, sha, pattern).await?,
            None => Vec::new(),
        };
        for (added, removed, path) in numstat(&raw) {
            let hit = matched.iter().any(|candidate| candidate == &path);
            match files.iter_mut().find(|file| file.path == path) {
                Some(existing) => {
                    existing.added += added;
                    existing.removed += removed;
                    existing.matched = existing.matched || hit;
                }
                None => files.push(FilePatch {
                    path,
                    added,
                    removed,
                    is_new: added > 0 && removed == 0,
                    matched: hit,
                }),
            }
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

#[tauri::command]
pub async fn patch(
    state: tauri::State<'_, GitState>,
    shas: Vec<String>,
    path: String,
    from: Option<String>,
    to: Option<String>,
) -> Result<tauri::ipc::Response, GitError> {
    let repo = repo_of(&state).await?;
    let mut text = String::new();

    if let Some((from, to)) = endpoints(&from, &to)? {
        text.push_str(&format!("# {from} → {to}\n"));
        text.push_str(
            &output(
                &repo,
                &[
                    "diff".into(),
                    "--no-renames".into(),
                    from,
                    to,
                    "--".into(),
                    path.clone(),
                ],
            )
            .await?,
        );
        return Ok(tauri::ipc::Response::new(text.into_bytes()));
    }

    for sha in &shas {
        text.push_str(&output(
            &repo,
            &[
                "show".into(),
                "--format=# %h %s".into(),
                sha.clone(),
                "--".into(),
                path.clone(),
            ],
        )
        .await?);
        text.push('\n');
    }
    Ok(tauri::ipc::Response::new(text.into_bytes()))
}

#[tauri::command]
pub async fn roots(
    state: tauri::State<'_, GitState>,
    shas: Vec<String>,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<RootOf>, GitError> {
    let repo = repo_of(&state).await?;
    // Two endpoints with the same root share an ancestor; two different roots
    // cannot, and that is exactly when the divider is true.
    let targets = match endpoints(&from, &to)? {
        Some((from, to)) => vec![from, to],
        None => shas,
    };
    let mut roots = Vec::new();
    for sha in &targets {
        let raw = output(
            &repo,
            &["rev-list".into(), "--max-parents=0".into(), sha.clone()],
        )
        .await?;
        if let Some(root) = raw.lines().next() {
            roots.push(RootOf { sha: sha.clone(), root: root.to_string() });
        }
    }
    Ok(roots)
}

#[cfg(test)]
mod tests {
    use super::*;

    // The bug this guards: with an empty keyword the search passed no -E, so git
    // read the author pattern as a *basic* regex, where `\|` is alternation and
    // a literal filter matched everything instead of nothing.
    #[test]
    fn commits_parse_with_multiline_bodies() {
        let raw = "aaa\u{1f}2026-01-01\u{1f}Anton\u{1f}subject one\u{1f}first line\n\nsecond\twith tab\0\n\
bbb\u{1f}2026-01-02\u{1f}Bot\u{1f}subject two\u{1f}\0\n";
        let commits = parse_commits(raw);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].body, "first line\n\nsecond\twith tab");
        assert_eq!(commits[0].subject, "subject one");
        assert_eq!(commits[1].subject, "subject two");
        assert!(commits[1].body.is_empty());
    }

    // -a unions two logs; the same commit can arrive twice.
    #[test]
    fn duplicate_commits_are_dropped() {
        let record = "aaa\u{1f}2026-01-01\u{1f}Anton\u{1f}subject\u{1f}\0\n";
        assert_eq!(parse_commits(&format!("{record}{record}")).len(), 1);
    }

    #[test]
    fn literals_escape_extended_regex_metacharacters() {
        assert_eq!(literal("anton|dependabot"), "anton\\|dependabot");
        assert_eq!(literal("src/app.ts"), "src/app\\.ts");
        assert_eq!(literal("(v1)+ [x]"), "\\(v1\\)\\+ \\[x\\]");
        assert_eq!(literal("plain-name"), "plain-name");
    }

    #[test]
    fn the_author_is_a_literal_unless_regex_is_on() {
        let literal_author = Filters { author: " a|b ".into(), ..Default::default() };
        assert_eq!(filter_args(&literal_author), vec!["--author=a\\|b".to_string()]);

        let pattern = Filters { author: "a|b".into(), regex: true, ..Default::default() };
        assert_eq!(filter_args(&pattern), vec!["--author=a|b".to_string()]);
    }

    // "until the 16th" has to include the 16th: a bare date is midnight.
    #[test]
    fn an_until_date_covers_its_whole_day() {
        let filters = Filters {
            since: "2026-11-01".into(),
            until: "2026-11-16".into(),
            ..Default::default()
        };
        assert_eq!(
            filter_args(&filters),
            vec!["--since=2026-11-01".to_string(), "--until=2026-11-16 23:59:59".to_string()],
        );
    }

    // Binary files report `-` for both counts and must not poison the list.
    #[test]
    fn numstat_reads_counts_and_skips_noise() {
        let raw = "12\t3\tsrc/app.ts\n-\t-\tassets/logo.png\nbroken line\n";
        assert_eq!(
            numstat(raw),
            vec![
                (12, 3, "src/app.ts".to_string()),
                (0, 0, "assets/logo.png".to_string()),
            ],
        );
        assert!(numstat("").is_empty());
    }

    #[test]
    fn a_pathspec_goes_after_a_double_dash() {
        let filters = Filters { path: " src/http ".into(), ..Default::default() };
        assert_eq!(path_args(&filters), vec!["--".to_string(), "src/http".to_string()]);
        assert!(path_args(&Filters::default()).is_empty());
    }
}
