/**
 * Export / import of all extension data (settings, notes, templates, …) so a
 * user can set up another browser/profile. Dumps chrome.storage.sync and
 * chrome.storage.local wholesale — future keys are included automatically.
 *
 * The API token is excluded unless explicitly requested (it grants full
 * GitLab access). Transient staging state (drafts) never travels.
 */

export interface ExportBundle {
  app: 'gitlab-ninja';
  version: string;
  exportedAt: string;
  sync: Record<string, unknown>;
  local: Record<string, unknown>;
}

const TOKEN_KEY = 'apiToken';

/** Machine-local staging state — wrong to copy to another install. */
function isTransientKey(key: string): boolean {
  return key === 'newTicketDraft' || key.startsWith('gn-timelog-drafts');
}

function getAll(area: chrome.storage.StorageArea): Promise<Record<string, unknown>> {
  return new Promise((resolve) => area.get(null, (items) => resolve(items)));
}

function filterKeys(
  items: Record<string, unknown>,
  includeToken: boolean
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(items)) {
    if (isTransientKey(key)) continue;
    if (key === TOKEN_KEY && !includeToken) continue;
    out[key] = value;
  }
  return out;
}

export async function buildExport(opts: {
  includeToken: boolean;
  version: string;
  exportedAt: string;
}): Promise<ExportBundle> {
  const [sync, local] = await Promise.all([
    getAll(chrome.storage.sync),
    getAll(chrome.storage.local),
  ]);
  return {
    app: 'gitlab-ninja',
    version: opts.version,
    exportedAt: opts.exportedAt,
    sync: filterKeys(sync, opts.includeToken),
    local: filterKeys(local, opts.includeToken),
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parse and validate an export file. Throws with a user-facing message. */
export function parseImport(json: string): ExportBundle {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Not a valid JSON file.');
  }
  if (!isPlainObject(data) || data.app !== 'gitlab-ninja') {
    throw new Error('Not a GitLab Ninja export file.');
  }
  if (!isPlainObject(data.sync) || !isPlainObject(data.local)) {
    throw new Error('Export file is malformed (missing sync/local data).');
  }
  return data as unknown as ExportBundle;
}

function setAll(area: chrome.storage.StorageArea, items: Record<string, unknown>): Promise<void> {
  if (Object.keys(items).length === 0) return Promise.resolve();
  return new Promise((resolve) => area.set(items, () => resolve()));
}

/**
 * Merge the bundle into storage: keys present in the file are written, keys
 * absent from it are left untouched. Token is imported only if the file has it.
 */
export async function applyImport(bundle: ExportBundle): Promise<void> {
  await Promise.all([
    setAll(chrome.storage.sync, filterKeys(bundle.sync, true)),
    setAll(chrome.storage.local, filterKeys(bundle.local, true)),
  ]);
}
