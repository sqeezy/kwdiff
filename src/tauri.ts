import { invoke } from '@tauri-apps/api/core'

import type { GitApi } from './git'
import type { Commit, Config, FilePatch, Ref, Repo, RootOf, SearchArgs } from './types'

// A patch comes back as `ipc::Response` bytes. Depending on the bridge and the
// build, that arrives as an ArrayBuffer, a typed array, or a plain number[] —
// decoding only the first shape is how the diff pane goes silently blank.
const decode = (bytes: unknown): string => {
  if (typeof bytes === 'string') return bytes
  if (bytes instanceof ArrayBuffer) return new TextDecoder().decode(bytes)
  if (ArrayBuffer.isView(bytes)) {
    const view = bytes as ArrayBufferView
    return new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  }
  if (Array.isArray(bytes)) return new TextDecoder().decode(new Uint8Array(bytes as number[]))
  return String(bytes ?? '')
}

export const tauriGit: GitApi = {
  openRepo: (path: string) => invoke<Repo>('open_repo', { path }),

  refs: (repo: string) => invoke<ReadonlyArray<Ref>>('refs', { repo }),

  search: (args: SearchArgs) => invoke<ReadonlyArray<Commit>>('search', { ...args }),

  cancelSearch: (id: number) => invoke<null>('cancel_search', { id }).then(() => undefined),

  files: (shas: ReadonlyArray<string>) => invoke<ReadonlyArray<FilePatch>>('files', { shas }),

  patch: (shas: ReadonlyArray<string>, path: string) =>
    invoke<unknown>('patch', { shas, path }).then(decode),

  roots: (shas: ReadonlyArray<string>) => invoke<ReadonlyArray<RootOf>>('roots', { shas }),
}

export const tauriConfig = {
  load: () => invoke<Config>('load_config'),
  save: (config: Config) => invoke<null>('save_config', { config }).then(() => undefined),
}
