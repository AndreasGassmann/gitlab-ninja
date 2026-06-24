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
 * This module is DOM-free (except localStorage) and carries no formatting — the
 * caller owns presentation.
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

export class DraftManager {
  state: DraftState = { enabled: false, nextId: 1, byOrigin: {}, added: [] };
  private key = STORAGE_PREFIX;

  /** Bind to a localStorage key scoped per gitlab instance + user, and load. */
  init(scope: string): void {
    this.key = `${STORAGE_PREFIX}:${scope}`;
    const raw = localStorage.getItem(this.key);
    if (!raw) return;
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
    localStorage.setItem(this.key, JSON.stringify(this.state));
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

/**
 * Overlay drafts onto the fetched originals, tagging each result with its
 * draftStatus. Deleted originals are kept (tagged) so callers can show them
 * faded; callers exclude them from totals.
 */
export function applyDrafts<T extends TimelogLike>(
  originals: T[],
  state: DraftState
): (T & { draftStatus?: DraftStatus })[] {
  const out: (T & { draftStatus?: DraftStatus })[] = [];
  for (const o of originals) {
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
  for (const a of state.added) {
    out.push({
      id: a.draftId,
      issueIid: a.desired.issueIid,
      issueTitle: a.desired.issueTitle,
      issueUrl: a.desired.issueUrl,
      issueGid: a.desired.issueGid,
      projectName: a.desired.projectName,
      projectId: a.desired.projectId,
      note: a.desired.note,
      timeSpent: a.desired.timeSpent,
      spentAt: a.desired.spentAt,
      issueState: a.desired.issueState,
      timeEstimate: a.desired.timeEstimate,
      totalTimeSpent: a.desired.totalTimeSpent,
      draftStatus: 'new',
    } as T & { draftStatus?: DraftStatus });
  }
  return out;
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
