import { Schema } from 'effect'

export const Repo = Schema.Struct({ name: Schema.String, root: Schema.String })
export const Ref = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(['local', 'remote', 'tag']),
})
export const Commit = Schema.Struct({
  sha: Schema.String,
  date: Schema.String,
  author: Schema.String,
  subject: Schema.String,
  body: Schema.String,
})
export const FilePatch = Schema.Struct({
  path: Schema.String,
  added: Schema.Number,
  removed: Schema.Number,
  isNew: Schema.Boolean,
  // The code search's pattern occurs in this file at the commit.
  matched: Schema.Boolean,
})
export const GitError = Schema.Struct({
  kind: Schema.Literals(['git-missing', 'not-a-repo', 'search', 'io']),
  message: Schema.String,
})

// The two-slot compare: both slots set is a tree diff (`git diff A B`), which
// needs no common ancestor. One slot set is still tick mode.
export const Endpoints = Schema.Struct({
  from: Schema.NullOr(Schema.String),
  to: Schema.NullOr(Schema.String),
})

// What `git log` already offers, as one input to the search. An empty string is
// "not set"; the fields are the raw input values so the panel can keep them.
export const Filters = Schema.Struct({
  author: Schema.String,
  path: Schema.String,
  since: Schema.String,
  until: Schema.String,
  regex: Schema.Boolean,
})

export const Model = Schema.Struct({
  repo: Schema.NullOr(Repo),
  recents: Schema.Array(Repo),
  refs: Schema.Array(Ref),
  branch: Schema.NullOr(Schema.String),
  keyword: Schema.String,
  code: Schema.Boolean,
  commits: Schema.Array(Commit),
  selectedShas: Schema.Array(Schema.String),
  cursor: Schema.Number,
  anchor: Schema.NullOr(Schema.Number),
  shiftDown: Schema.Boolean,
  files: Schema.Array(FilePatch),
  fileIndex: Schema.Number,
  patch: Schema.NullOr(Schema.String),
  roots: Schema.Array(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  showKeymap: Schema.Boolean,
  pane: Schema.Literals(['search', 'commits', 'files', 'diff']),
  hunkIndex: Schema.Number,
  branches: Schema.Array(Schema.Struct({ root: Schema.String, branch: Schema.String })),
  filters: Filters,
  showFilters: Schema.Boolean,
  showRepos: Schema.Boolean,
  bodyExpanded: Schema.Boolean,
  compare: Endpoints,
  searching: Schema.Boolean,
  searchId: Schema.Number,
  selectionId: Schema.Number,
  patchId: Schema.Number,
  error: Schema.NullOr(GitError),
})
export type Model = typeof Model.Type

// What the filter button counts: the four log limits, and the regex toggle
// because it changes how the keyword is read.
export const activeFilterCount = (filters: typeof Filters.Type): number =>
  [filters.author, filters.path, filters.since, filters.until].filter(
    value => value.trim() !== '',
  ).length + (filters.regex ? 1 : 0)

export const hasFilters = (filters: typeof Filters.Type): boolean => activeFilterCount(filters) > 0
