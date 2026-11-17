export type Commit = Readonly<{
  sha: string
  date: string
  author: string
  subject: string
  body: string
}>

export type FilePatch = Readonly<{
  path: string
  added: number
  removed: number
  isNew: boolean
  // The code search's pattern occurs in this file at the commit.
  matched: boolean
}>

export type RootOf = Readonly<{ sha: string; root: string }>

export type Ref = Readonly<{ name: string; kind: 'local' | 'remote' | 'tag' }>

export type Repo = Readonly<{ name: string; root: string }>

// The four `git log` limits, as typed. Empty strings mean "not set"; `regex`
// decides whether the keyword and the author are patterns or literals.
export type Filters = Readonly<{
  author: string
  path: string
  since: string
  until: string
  regex: boolean
}>

export type GitErrorKind = 'git-missing' | 'not-a-repo' | 'search' | 'io'

export type GitError = Readonly<{ kind: GitErrorKind; message: string }>

// Two endpoints and nothing else: what the file list, the patch and the roots
// are computed from while comparing. Null means "use the ticks".
export type Endpoints = Readonly<{ from: string; to: string }>

export type SearchArgs = Readonly<{
  id: number
  repo: string
  keyword: string
  code: boolean
  branch: string | null
  filters: Filters
}>

export type RepoBranch = Readonly<{ root: string; branch: string }>

export type Config = Readonly<{
  recents: ReadonlyArray<string>
  last: string | null
  branches: ReadonlyArray<RepoBranch>
}>
