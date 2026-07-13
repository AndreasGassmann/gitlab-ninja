/**
 * Local "draft mode" for weekly-overview timelog edits.
 *
 * GitLab has no timelogUpdate mutation, so every edit is a create+delete pair.
 * Draft mode stages all drag/add/edit/delete operations locally (localStorage)
 * and collapses them to the minimal set of mutations at commit time:
 *   - a brand-new entry      -> one create
 *   - a deleted original     -> one delete
 *   - a modified original    -> one create + one delete (the irreducible pair)
 *   - a no-op                -> nothing
 *
 * The model is a *desired final state* per entry (not an operation log), so
 * dragging an entry, changing its duration, then dragging it again collapses to
 * a single diff against the original. Adding then deleting a new entry produces
 * zero mutations.
 *
 * This module is DOM-free (except its storage backend: localStorage via
 * init(), or chrome.storage.local via initShared() when state must be shared
 * across extension contexts) and carries no formatting — the caller owns
 * presentation.
 */

export type DraftStatus = 'new' | 'modified' | 'deleted';

/** Minimal timelog shape the draft engine needs. Matches options.ts TimelogDetail. */
export interface TimelogLike {
  id: string;
  issueIid: number;
  issueTitle: string;
  issueUrl: string;
  issueGid: string;
  projectName: string;
  projectId: string;
  note: string;
  timeSpent: number; // seconds
  spentAt: string; // full ISO datetime
  issueState: string;
  timeEstimate: number; // seconds
  totalTimeSpent: number; // seconds
}

/** The desired final state of an entry while staged. */
export interface DraftDesired {
  issueGid: string;
  issueIid: number;
  issueTitle: string;
  issueUrl: string;
  projectName: string;
  projectId: string;
  issueState: string;
  timeEstimate: number;
  totalTimeSpent: number;
  timeSpent: number; // seconds
  spentAt: string;
  note: string;
}

export interface DraftEntry {
  draftId: string; // local id, e.g. "draft:3"
  originId: string | null; // gid of original Timelog; null = newly added
  deleted: boolean; // original marked for removal
  desired: DraftDesired; // ignored when deleted
  original?: { timeSpent: number; spentAt: string; note: string };
}

export interface DraftState {
  enabled: boolean;
  nextId: number;
  byOrigin: Record<string, DraftEntry>; // originId -> draft (modified/deleted)
  added: DraftEntry[]; // originId === null
}

export interface PlanItem {
  kind: 'add' | 'delete' | 'modify';
  draftId: string;
  originId: string | null;
  desired: DraftDesired;
  original?: { timeSpent: number; spentAt: string; note: string };
}

const STORAGE_PREFIX = 'gn-timelog-drafts';
const UNIT_SECONDS: Record<string, number> = {
  w: 5 * 8 * 3600,
  d: 8 * 3600,
  h: 3600,
  m: 60,
  s: 1,
};

/** Parse a GitLab-style duration ("1h30m", "2h", "45m", "1.5h", "1d") to seconds. */
export function parseDurationToSeconds(input: string): number {
  if (!input) return 0;
  let total = 0;
  let matched = false;
  const re = /(\d+(?:\.\d+)?)\s*([wdhms])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    matched = true;
    total += parseFloat(m[1]) * UNIT_SECONDS[m[2].toLowerCase()];
  }
  if (!matched) {
    const n = parseFloat(input);
    if (!isNaN(n)) total = n * 3600; // bare number = hours
  }
  return Math.round(total);
}

export function isDraftId(id: string): boolean {
  return id.startsWith('draft:');
}

/** Compare two ISO datetimes ignoring seconds and timezone suffix. */
function sameInstant(a: string, b: string): boolean {
  return normInstant(a) === normInstant(b);
}

function normInstant(iso: string): string {
  const date = iso.slice(0, 10);
  const tIdx = iso.indexOf('T');
  if (tIdx === -1) return date;
  return `${date}T${iso.slice(tIdx + 1, tIdx + 6)}`; // YYYY-MM-DDTHH:MM
}

function detailToDesired(o: TimelogLike): DraftDesired {
  return {
    issueGid: o.issueGid,
    issueIid: o.issueIid,
    issueTitle: o.issueTitle,
    issueUrl: o.issueUrl,
    projectName: o.projectName,
    projectId: o.projectId,
    issueState: o.issueState,
    timeEstimate: o.timeEstimate,
    totalTimeSpent: o.totalTimeSpent,
    timeSpent: o.timeSpent,
    spentAt: o.spentAt,
    note: o.note,
  };
}

/** Field patch applied to a desired state. */
export type DraftPatch = Partial<Pick<DraftDesired, 'timeSpent' | 'spentAt' | 'note'>>;

/** Build the storage scope shared by every surface (options page, boards). */
export function draftScope(gitlabUrl: string | null, username: string | null): string {
  return `${(gitlabUrl || 'default').replace(/\/+$/, '')}|${username || ''}`;
}

export class DraftManager {
  state: DraftState = { enabled: false, nextId: 1, byOrigin: {}, added: [] };
  private key = STORAGE_PREFIX;
  private shared = false;
  private watchers: Array<() => void> = [];

  /** Bind to a localStorage key scoped per gitlab instance + user, and load. */
  init(scope: string): void {
    this.key = `${STORAGE_PREFIX}:${scope}`;
    this.adopt(localStorage.getItem(this.key));
  }

  /**
   * Bind to chrome.storage.local instead, so the same staged state is visible
   * from every extension context (options page, popup, content scripts on the
   * gitlab tab). Migrates a legacy localStorage store when present.
   */
  async initShared(scope: string): Promise<void> {
    this.key = `${STORAGE_PREFIX}:${scope}`;
    this.shared = true;
    let raw = await new Promise<string | null>((resolve) =>
      chrome.storage.local.get(this.key, (items) => resolve(items[this.key] ?? null))
    );
    if (!raw && typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(this.key);
      if (raw) {
        chrome.storage.local.set({ [this.key]: raw });
        localStorage.removeItem(this.key);
      }
    }
    this.adopt(raw);
  }

  /**
   * Reload state and invoke cb whenever another context writes this scope's
   * drafts. Self-writes are ignored (their payload matches current state).
   * Multiple watchers share one storage listener so each cb fires exactly
   * once per external change.
   */
  watch(cb: () => void): void {
    this.watchers.push(cb);
    if (this.watchers.length > 1) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const change = changes[this.key];
      if (!change) return;
      const raw = change.newValue ?? null;
      if (raw === JSON.stringify(this.state)) return;
      this.adopt(raw);
      this.watchers.forEach((w) => w());
    });
  }

  private adopt(raw: string | null): void {
    if (!raw) {
      this.state = { enabled: false, nextId: 1, byOrigin: {}, added: [] };
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      this.state = {
        enabled: !!parsed.enabled,
        nextId: parsed.nextId || 1,
        byOrigin: parsed.byOrigin || {},
        added: parsed.added || [],
      };
    } catch {
      // corrupt store — start fresh
    }
  }

  persist(): void {
    const raw = JSON.stringify(this.state);
    if (this.shared) chrome.storage.local.set({ [this.key]: raw });
    else localStorage.setItem(this.key, raw);
  }

  isEnabled(): boolean {
    return this.state.enabled;
  }

  setEnabled(v: boolean): void {
    this.state.enabled = v;
    this.persist();
  }

  private genId(): string {
    return `draft:${this.state.nextId++}`;
  }

  private isModified(d: DraftEntry): boolean {
    if (!d.original) return true;
    return (
      d.original.timeSpent !== d.desired.timeSpent ||
      !sameInstant(d.original.spentAt, d.desired.spentAt) ||
      (d.original.note || '') !== (d.desired.note || '')
    );
  }

  pendingCount(): number {
    let n = this.state.added.length;
    for (const id in this.state.byOrigin) {
      const d = this.state.byOrigin[id];
      if (d.deleted || this.isModified(d)) n++;
    }
    return n;
  }

  hasPending(): boolean {
    return this.pendingCount() > 0;
  }

  addNew(desired: DraftDesired): string {
    const draftId = this.genId();
    this.state.added.push({ draftId, originId: null, deleted: false, desired });
    this.persist();
    return draftId;
  }

  editAdded(draftId: string, patch: DraftPatch): void {
    const d = this.state.added.find((a) => a.draftId === draftId);
    if (!d) return;
    Object.assign(d.desired, patch);
    this.persist();
  }

  deleteAdded(draftId: string): void {
    this.state.added = this.state.added.filter((a) => a.draftId !== draftId);
    this.persist();
  }

  editOriginal(orig: TimelogLike, patch: DraftPatch): void {
    let d = this.state.byOrigin[orig.id];
    if (!d) {
      d = {
        draftId: this.genId(),
        originId: orig.id,
        deleted: false,
        desired: detailToDesired(orig),
        original: { timeSpent: orig.timeSpent, spentAt: orig.spentAt, note: orig.note },
      };
      this.state.byOrigin[orig.id] = d;
    }
    d.deleted = false;
    Object.assign(d.desired, patch);
    // Reverted back to the original values -> drop the draft entirely.
    if (!this.isModified(d)) delete this.state.byOrigin[orig.id];
    this.persist();
  }

  deleteOriginal(orig: TimelogLike): void {
    const existing = this.state.byOrigin[orig.id];
    if (existing) {
      existing.deleted = true;
    } else {
      this.state.byOrigin[orig.id] = {
        draftId: this.genId(),
        originId: orig.id,
        deleted: true,
        desired: detailToDesired(orig),
        original: { timeSpent: orig.timeSpent, spentAt: orig.spentAt, note: orig.note },
      };
    }
    this.persist();
  }

  /** Clear a single staged change after it commits successfully. */
  clear(item: PlanItem): void {
    if (item.originId) delete this.state.byOrigin[item.originId];
    else this.state.added = this.state.added.filter((a) => a.draftId !== item.draftId);
    this.persist();
  }

  /** Drop a single staged change against an original, restoring it to its
   * fetched state (works for both 'modified' and 'deleted' drafts). */
  revertOriginal(originId: string): void {
    delete this.state.byOrigin[originId];
    this.persist();
  }

  discardAll(): void {
    this.state.byOrigin = {};
    this.state.added = [];
    this.persist();
  }
}

function desiredToDisplay(id: string, desired: DraftDesired, status: DraftStatus): TimelogLike & {
  draftStatus?: DraftStatus;
} {
  return {
    id,
    issueIid: desired.issueIid,
    issueTitle: desired.issueTitle,
    issueUrl: desired.issueUrl,
    issueGid: desired.issueGid,
    projectName: desired.projectName,
    projectId: desired.projectId,
    note: desired.note,
    timeSpent: desired.timeSpent,
    spentAt: desired.spentAt,
    issueState: desired.issueState,
    timeEstimate: desired.timeEstimate,
    totalTimeSpent: desired.totalTimeSpent,
    draftStatus: status,
  };
}

/**
 * Overlay drafts onto the fetched originals, tagging each result with its
 * draftStatus. Deleted originals are kept (tagged) so callers can show them
 * faded; callers exclude them from totals.
 *
 * byOrigin drafts whose original is NOT in `originals` are appended from their
 * desired state: the fetch is range-scoped, so an entry dragged into another
 * week must still surface when that week is viewed.
 */
export function applyDrafts<T extends TimelogLike>(
  originals: T[],
  state: DraftState
): (T & { draftStatus?: DraftStatus })[] {
  const out: (T & { draftStatus?: DraftStatus })[] = [];
  const seenOrigins = new Set<string>();
  for (const o of originals) {
    seenOrigins.add(o.id);
    const d = state.byOrigin[o.id];
    if (!d) {
      out.push({ ...o });
    } else if (d.deleted) {
      out.push({ ...o, draftStatus: 'deleted' });
    } else {
      out.push({
        ...o,
        timeSpent: d.desired.timeSpent,
        spentAt: d.desired.spentAt,
        note: d.desired.note,
        draftStatus: 'modified',
      });
    }
  }
  for (const id in state.byOrigin) {
    const d = state.byOrigin[id];
    if (d.deleted || seenOrigins.has(id)) continue;
    out.push(desiredToDisplay(id, d.desired, 'modified') as T & { draftStatus?: DraftStatus });
  }
  for (const a of state.added) {
    out.push(desiredToDisplay(a.draftId, a.desired, 'new') as T & { draftStatus?: DraftStatus });
  }
  return out;
}

/**
 * The GitLab-side operations commitPlan needs. The caller owns the actual
 * network calls, duration formatting, and clearing a committed draft — this
 * keeps the commit logic DOM/network-free and unit-testable.
 */
export interface CommitApi {
  createTimelog(
    issueGid: string,
    durationStr: string,
    spentAt: string,
    note: string
  ): Promise<void>;
  deleteTimelog(timelogId: string): Promise<void>;
  formatDuration(seconds: number): string;
  clear(item: PlanItem): void;
}

export interface CommitResult {
  ok: number;
  failed: { item: PlanItem; error: string }[];
  dupes: PlanItem[]; // created but old copy could not be deleted
}

/**
 * Apply a mutation plan to GitLab. Each committed item is cleared as it
 * succeeds, so a partial failure leaves only the failed items staged.
 * A 'modify' is a create-then-delete pair: if the delete fails after the
 * create succeeded, the old copy survives → flagged as a duplicate (and the
 * draft is still cleared so a re-commit won't make yet another copy).
 */
export async function commitPlan(plan: PlanItem[], api: CommitApi): Promise<CommitResult> {
  const result: CommitResult = { ok: 0, failed: [], dupes: [] };
  for (const item of plan) {
    try {
      if (item.kind === 'add') {
        await api.createTimelog(
          item.desired.issueGid,
          api.formatDuration(item.desired.timeSpent),
          item.desired.spentAt,
          item.desired.note
        );
        api.clear(item);
        result.ok++;
      } else if (item.kind === 'delete') {
        await api.deleteTimelog(item.originId!);
        api.clear(item);
        result.ok++;
      } else {
        // modify: create the new entry first, then remove the old one.
        await api.createTimelog(
          item.desired.issueGid,
          api.formatDuration(item.desired.timeSpent),
          item.desired.spentAt,
          item.desired.note
        );
        try {
          await api.deleteTimelog(item.originId!);
          api.clear(item);
          result.ok++;
        } catch {
          api.clear(item);
          result.dupes.push(item);
        }
      }
    } catch (err: any) {
      result.failed.push({ item, error: err?.message || String(err) });
    }
  }
  return result;
}

/** Build the minimal mutation plan from the current draft state. */
export function buildPlan(state: DraftState): PlanItem[] {
  const items: PlanItem[] = [];
  for (const a of state.added) {
    items.push({ kind: 'add', draftId: a.draftId, originId: null, desired: a.desired });
  }
  for (const id in state.byOrigin) {
    const d = state.byOrigin[id];
    items.push({
      kind: d.deleted ? 'delete' : 'modify',
      draftId: d.draftId,
      originId: d.originId,
      desired: d.desired,
      original: d.original,
    });
  }
  return items;
}
