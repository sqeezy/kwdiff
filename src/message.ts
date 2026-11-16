import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { Commit, FilePatch, Filters } from './model'

export const Message = defineMessageUnion({
  // repository
  ClickedOpen: {},
  PickCancelled: {},
  PickedRepo: { path: Schema.String },
  OpenedRepo: { name: Schema.String, root: Schema.String },
  FailedOpen: { message: Schema.String },
  SucceededRefs: { refs: Schema.Array(Schema.Struct({ name: Schema.String, kind: Schema.Literals(['local', 'remote', 'tag']) })) },

  // search
  ChangedKeyword: { value: Schema.String },
  ToggledCode: {},
  SelectedBranch: { branch: Schema.NullOr(Schema.String) },
  SearchRequested: {
    id: Schema.Number,
    keyword: Schema.String,
    code: Schema.Boolean,
    branch: Schema.NullOr(Schema.String),
    filters: Filters,
  },
  ChangedFilters: { filters: Filters },
  ToggledRegex: {},
  ClearedFilters: {},
  ToggledFiltersPanel: {},
  SucceededSearch: { id: Schema.Number, commits: Schema.Array(Commit) },
  FailedSearch: { id: Schema.Number, message: Schema.String },

  // selection
  ToggledCommit: { sha: Schema.String },
  ClickedCommit: { index: Schema.Number },
  ShiftDown: {},
  ShiftUp: {},
  ToggledAll: { on: Schema.Boolean },
  MovedCursor: { delta: Schema.Number },
  SelectedFile: { index: Schema.Number },
  SucceededSelection: {
    id: Schema.Number,
    files: Schema.Array(FilePatch),
    roots: Schema.Array(Schema.String),
    error: Schema.NullOr(Schema.String),
  },
  SucceededPatch: { id: Schema.Number, patch: Schema.String, error: Schema.NullOr(Schema.String) },

  // compare: two endpoints make a tree diff, whatever their ancestry
  ChoseEndpoint: {
    slot: Schema.Literals(['from', 'to']),
    value: Schema.NullOr(Schema.String),
  },
  UsedCommitAsEndpoint: { slot: Schema.Literals(['from', 'to']) },
  SwappedEndpoints: {},

  Startup: {},
  SucceededConfig: {
    recents: Schema.Array(Schema.String),
    last: Schema.NullOr(Schema.String),
    branches: Schema.Array(Schema.Struct({ root: Schema.String, branch: Schema.String })),
  },
  ConfigSaved: {},

  // chrome
  PressedSpace: {},
  PressedEnter: {},
  PressedEscape: {},
  ToggledKeymap: {},
  FocusedSearch: {},
  SearchFocused: {},
  DiffFocused: {},
  Blurred: {},
  BlurRequested: {},
  FocusedPane: { pane: Schema.Literals(['search', 'commits', 'files', 'diff']) },
  MovedInPane: { delta: Schema.Number },
  Descended: {},
  Ascended: {},
  MovedHunk: { delta: Schema.Number },
  JumpedHunk: { to: Schema.Literals(['top', 'bottom']) },
  ScrolledToHunk: { index: Schema.Number },
  ScrolledDiff: {},
  ElementFocused: {},
  DiffMounted: {},

})
export type Message = typeof Message.Type
