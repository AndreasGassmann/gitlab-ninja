import { describe, it, expect, beforeEach } from 'vitest';
import { installLocalStorageMock } from '../test/localStorageMock';
import { installChromeMock } from '../test/chromeMock';
import {
  parseDurationToSeconds,
  isDraftId,
  applyDrafts,
  buildPlan,
  commitPlan,
  CommitApi,
  DraftManager,
  draftScope,
  TimelogLike,
} from './timelogDrafts';

type Call = { op: 'create' | 'delete'; args: string[] };

/** Recording fake CommitApi. failOn lets a specific call reject. */
function makeApi(
  mgr: DraftManager,
  failOn?: (call: Call) => boolean
): { api: CommitApi; calls: Call[] } {
  const calls: Call[] = [];
  const record = (call: Call): Promise<void> => {
    calls.push(call);
    return failOn?.(call) ? Promise.reject(new Error('boom')) : Promise.resolve();
  };
  const api: CommitApi = {
    createTimelog: (gid, dur, spentAt, note) =>
      record({ op: 'create', args: [gid, dur, spentAt, note] }),
    deleteTimelog: (id) => record({ op: 'delete', args: [id] }),
    formatDuration: (s) => `${s}s`,
    clear: (item) => mgr.clear(item),
  };
  return { api, calls };
}

function makeOriginal(over: Partial<TimelogLike> = {}): TimelogLike {
  return {
    id: 'gid://gitlab/Timelog/1',
    issueIid: 42,
    issueTitle: 'Fix the thing',
    issueUrl: 'https://gitlab.example/group/proj/-/issues/42',
    issueGid: 'gid://gitlab/Issue/100',
    projectName: 'proj',
    projectId: 'gid://gitlab/Project/7',
    note: 'worked',
    timeSpent: 3600,
    spentAt: '2026-06-20T10:00:00.000Z',
    issueState: 'opened',
    timeEstimate: 7200,
    totalTimeSpent: 3600,
    ...over,
  };
}

function makeDesired(over: Partial<TimelogLike> = {}) {
  return {
    issueGid: 'g',
    issueIid: 1,
    issueTitle: 't',
    issueUrl: 'u',
    projectName: 'p',
    projectId: 'pid',
    issueState: 'opened',
    timeEstimate: 0,
    totalTimeSpent: 0,
    timeSpent: 3600,
    spentAt: '2026-06-20T10:00:00.000Z',
    note: '',
    ...over,
  };
}

describe('parseDurationToSeconds', () => {
  it('parses single units', () => {
    expect(parseDurationToSeconds('2h')).toBe(7200);
    expect(parseDurationToSeconds('45m')).toBe(2700);
    expect(parseDurationToSeconds('1d')).toBe(8 * 3600);
    expect(parseDurationToSeconds('1w')).toBe(5 * 8 * 3600);
    expect(parseDurationToSeconds('30s')).toBe(30);
  });

  it('sums compound durations', () => {
    expect(parseDurationToSeconds('1h30m')).toBe(5400);
    expect(parseDurationToSeconds('1h 30m')).toBe(5400);
  });

  it('handles fractional values', () => {
    expect(parseDurationToSeconds('1.5h')).toBe(5400);
  });

  it('treats a bare number as hours', () => {
    expect(parseDurationToSeconds('2')).toBe(7200);
    expect(parseDurationToSeconds('0.5')).toBe(1800);
  });

  it('returns 0 for empty or garbage input', () => {
    expect(parseDurationToSeconds('')).toBe(0);
    expect(parseDurationToSeconds('abc')).toBe(0);
  });
});

describe('isDraftId', () => {
  it('detects local draft ids', () => {
    expect(isDraftId('draft:3')).toBe(true);
    expect(isDraftId('gid://gitlab/Timelog/1')).toBe(false);
  });
});

describe('DraftManager state transitions', () => {
  let mgr: DraftManager;

  beforeEach(() => {
    installLocalStorageMock();
    mgr = new DraftManager();
    mgr.init('instance:user');
  });

  it('starts empty', () => {
    expect(mgr.pendingCount()).toBe(0);
    expect(mgr.hasPending()).toBe(false);
  });

  it('add then delete the new entry collapses to zero mutations', () => {
    const id = mgr.addNew({
      issueGid: 'g',
      issueIid: 1,
      issueTitle: 't',
      issueUrl: 'u',
      projectName: 'p',
      projectId: 'pid',
      issueState: 'opened',
      timeEstimate: 0,
      totalTimeSpent: 0,
      timeSpent: 3600,
      spentAt: '2026-06-20T10:00:00.000Z',
      note: '',
    });
    expect(mgr.pendingCount()).toBe(1);
    mgr.deleteAdded(id);
    expect(mgr.pendingCount()).toBe(0);
    expect(buildPlan(mgr.state)).toHaveLength(0);
  });

  it('a new entry produces one add in the plan', () => {
    mgr.addNew({
      issueGid: 'g',
      issueIid: 1,
      issueTitle: 't',
      issueUrl: 'u',
      projectName: 'p',
      projectId: 'pid',
      issueState: 'opened',
      timeEstimate: 0,
      totalTimeSpent: 0,
      timeSpent: 3600,
      spentAt: '2026-06-20T10:00:00.000Z',
      note: '',
    });
    const plan = buildPlan(mgr.state);
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe('add');
  });

  it('editing an original stages a modify', () => {
    const orig = makeOriginal();
    mgr.editOriginal(orig, { timeSpent: 7200 });
    expect(mgr.pendingCount()).toBe(1);
    const plan = buildPlan(mgr.state);
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe('modify');
    expect(plan[0].originId).toBe(orig.id);
  });

  it('editing an original back to its values drops the draft', () => {
    const orig = makeOriginal();
    mgr.editOriginal(orig, { timeSpent: 7200 });
    expect(mgr.pendingCount()).toBe(1);
    mgr.editOriginal(orig, { timeSpent: orig.timeSpent });
    expect(mgr.pendingCount()).toBe(0);
  });

  it('ignores sub-minute differences in spentAt', () => {
    const orig = makeOriginal({ spentAt: '2026-06-20T10:00:00.000Z' });
    mgr.editOriginal(orig, { spentAt: '2026-06-20T10:00:45.000Z' });
    // same minute -> not modified -> no draft
    expect(mgr.pendingCount()).toBe(0);
  });

  it('deleting an original stages a delete', () => {
    const orig = makeOriginal();
    mgr.deleteOriginal(orig);
    const plan = buildPlan(mgr.state);
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe('delete');
  });

  it('clear removes a committed item', () => {
    const orig = makeOriginal();
    mgr.deleteOriginal(orig);
    const [item] = buildPlan(mgr.state);
    mgr.clear(item);
    expect(mgr.pendingCount()).toBe(0);
  });

  it('revertOriginal drops a staged change', () => {
    const orig = makeOriginal();
    mgr.editOriginal(orig, { timeSpent: 99 });
    mgr.revertOriginal(orig.id);
    expect(mgr.pendingCount()).toBe(0);
  });

  it('discardAll wipes every draft', () => {
    mgr.editOriginal(makeOriginal({ id: 'a' }), { timeSpent: 1 });
    mgr.deleteOriginal(makeOriginal({ id: 'b' }));
    expect(mgr.pendingCount()).toBe(2);
    mgr.discardAll();
    expect(mgr.pendingCount()).toBe(0);
  });

  it('persists across init on the same scope', () => {
    mgr.setEnabled(true);
    mgr.editOriginal(makeOriginal(), { timeSpent: 7200 });
    const reloaded = new DraftManager();
    reloaded.init('instance:user');
    expect(reloaded.isEnabled()).toBe(true);
    expect(reloaded.pendingCount()).toBe(1);
  });
});

describe('draft mode gating: API only fires on commit', () => {
  let mgr: DraftManager;

  beforeEach(() => {
    installLocalStorageMock();
    mgr = new DraftManager();
    mgr.init('s');
    mgr.setEnabled(true);
  });

  it('staging edits/adds/deletes touches no API', () => {
    const { api, calls } = makeApi(mgr);
    mgr.addNew(makeDesired());
    mgr.editOriginal(makeOriginal({ id: 'a' }), { timeSpent: 7200 });
    mgr.deleteOriginal(makeOriginal({ id: 'b' }));
    // Nothing committed yet → api untouched.
    expect(calls).toHaveLength(0);
    expect(mgr.pendingCount()).toBe(3);
    void api; // api exists but was never invoked pre-commit
  });

  it('commit flushes all staged changes through the API and clears them', async () => {
    mgr.addNew(makeDesired());
    const { api, calls } = makeApi(mgr);
    const result = await commitPlan(buildPlan(mgr.state), api);
    expect(result.ok).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe('create');
    expect(mgr.pendingCount()).toBe(0);
  });
});

describe('commitPlan mutation semantics', () => {
  let mgr: DraftManager;

  beforeEach(() => {
    installLocalStorageMock();
    mgr = new DraftManager();
    mgr.init('s');
    mgr.setEnabled(true);
  });

  it('an add issues a single create', async () => {
    mgr.addNew(makeDesired({ timeSpent: 3600 }));
    const { api, calls } = makeApi(mgr);
    const r = await commitPlan(buildPlan(mgr.state), api);
    expect(calls).toEqual([{ op: 'create', args: ['g', '3600s', expect.any(String), ''] }]);
    expect(r.ok).toBe(1);
  });

  it('a delete issues a single delete against the original id', async () => {
    mgr.deleteOriginal(makeOriginal({ id: 'orig-1' }));
    const { api, calls } = makeApi(mgr);
    const r = await commitPlan(buildPlan(mgr.state), api);
    expect(calls).toEqual([{ op: 'delete', args: ['orig-1'] }]);
    expect(r.ok).toBe(1);
  });

  it('a modify creates the new entry BEFORE deleting the old one', async () => {
    mgr.editOriginal(makeOriginal({ id: 'orig-2' }), { timeSpent: 7200 });
    const { api, calls } = makeApi(mgr);
    const r = await commitPlan(buildPlan(mgr.state), api);
    expect(calls.map((c) => c.op)).toEqual(['create', 'delete']);
    expect(calls[1].args[0]).toBe('orig-2');
    expect(r.ok).toBe(1);
  });

  it('leaves an item staged when its create fails', async () => {
    mgr.addNew(makeDesired());
    const { api } = makeApi(mgr, (c) => c.op === 'create');
    const r = await commitPlan(buildPlan(mgr.state), api);
    expect(r.ok).toBe(0);
    expect(r.failed).toHaveLength(1);
    expect(mgr.pendingCount()).toBe(1); // not cleared → still pending
  });

  it('flags a duplicate when modify creates but the delete fails', async () => {
    mgr.editOriginal(makeOriginal({ id: 'orig-3' }), { timeSpent: 7200 });
    const { api, calls } = makeApi(mgr, (c) => c.op === 'delete');
    const r = await commitPlan(buildPlan(mgr.state), api);
    expect(calls.map((c) => c.op)).toEqual(['create', 'delete']);
    expect(r.ok).toBe(0);
    expect(r.dupes).toHaveLength(1);
    // Draft cleared so a re-commit won't create yet another copy.
    expect(mgr.pendingCount()).toBe(0);
  });

  it('commits independent items even when one fails', async () => {
    mgr.addNew(makeDesired({ issueGid: 'good' }));
    mgr.deleteOriginal(makeOriginal({ id: 'orig-4' }));
    const { api } = makeApi(mgr, (c) => c.op === 'delete');
    const r = await commitPlan(buildPlan(mgr.state), api);
    expect(r.ok).toBe(1); // the add
    expect(r.failed).toHaveLength(1); // the delete
    expect(mgr.pendingCount()).toBe(1); // failed delete still staged
  });
});

describe('applyDrafts overlay', () => {
  it('passes through untouched originals', () => {
    const out = applyDrafts([makeOriginal()], {
      enabled: true,
      nextId: 1,
      byOrigin: {},
      added: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].draftStatus).toBeUndefined();
  });

  it('tags deleted, overlays modified, and appends added', () => {
    installLocalStorageMock();
    const mgr = new DraftManager();
    mgr.init('s');
    const modified = makeOriginal({ id: 'mod' });
    const deleted = makeOriginal({ id: 'del' });
    mgr.editOriginal(modified, { timeSpent: 9999, note: 'changed' });
    mgr.deleteOriginal(deleted);
    mgr.addNew({
      issueGid: 'g',
      issueIid: 5,
      issueTitle: 'new one',
      issueUrl: 'u',
      projectName: 'p',
      projectId: 'pid',
      issueState: 'opened',
      timeEstimate: 0,
      totalTimeSpent: 0,
      timeSpent: 600,
      spentAt: '2026-06-21T08:00:00.000Z',
      note: '',
    });

    const out = applyDrafts([modified, deleted], mgr.state);
    const byId = Object.fromEntries(out.map((o) => [o.id, o]));
    expect(byId['mod'].draftStatus).toBe('modified');
    expect(byId['mod'].timeSpent).toBe(9999);
    expect(byId['mod'].note).toBe('changed');
    expect(byId['del'].draftStatus).toBe('deleted');
    const added = out.find((o) => o.draftStatus === 'new');
    expect(added).toBeDefined();
    expect(added!.issueTitle).toBe('new one');
  });

  it('surfaces a moved entry whose original is not in the fetched range', () => {
    installLocalStorageMock();
    const mgr = new DraftManager();
    mgr.init('s');
    // Entry originally in week A, dragged to week B.
    const orig = makeOriginal({ id: 'moved', spentAt: '2026-06-20T10:00:00.000Z' });
    mgr.editOriginal(orig, { spentAt: '2026-06-27T10:00:00.000Z' });

    // Week B's fetch does not contain the original…
    const out = applyDrafts([] as TimelogLike[], mgr.state);
    // …but the draft must still surface with its desired (moved) date.
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('moved');
    expect(out[0].draftStatus).toBe('modified');
    expect(out[0].spentAt).toBe('2026-06-27T10:00:00.000Z');
    expect(out[0].issueTitle).toBe(orig.issueTitle);
  });

  it('does not resurrect deleted originals outside the fetched range', () => {
    installLocalStorageMock();
    const mgr = new DraftManager();
    mgr.init('s');
    mgr.deleteOriginal(makeOriginal({ id: 'gone' }));
    expect(applyDrafts([] as TimelogLike[], mgr.state)).toHaveLength(0);
  });

  it('does not duplicate a moved entry when its original IS fetched', () => {
    installLocalStorageMock();
    const mgr = new DraftManager();
    mgr.init('s');
    const orig = makeOriginal({ id: 'moved' });
    mgr.editOriginal(orig, { spentAt: '2026-06-27T10:00:00.000Z' });
    const out = applyDrafts([orig], mgr.state);
    expect(out).toHaveLength(1);
    expect(out[0].spentAt).toBe('2026-06-27T10:00:00.000Z');
  });
});

describe('shared storage (chrome.storage.local)', () => {
  it('scopes keys per instance + user and strips trailing slashes', () => {
    expect(draftScope('https://gitlab.example/', 'me')).toBe('https://gitlab.example|me');
    expect(draftScope(null, null)).toBe('default|');
  });

  it('persists via chrome.storage.local and reloads on the same scope', async () => {
    installChromeMock();
    installLocalStorageMock();
    const mgr = new DraftManager();
    await mgr.initShared('inst|user');
    mgr.setEnabled(true);
    mgr.addNew(makeDesired());

    const reloaded = new DraftManager();
    await reloaded.initShared('inst|user');
    expect(reloaded.isEnabled()).toBe(true);
    expect(reloaded.pendingCount()).toBe(1);
  });

  it('migrates a legacy localStorage store into chrome.storage.local', async () => {
    installChromeMock();
    const { store } = installLocalStorageMock();
    // Legacy: options page persisted to its own localStorage.
    const legacy = new DraftManager();
    legacy.init('inst|user');
    legacy.setEnabled(true);
    legacy.addNew(makeDesired());
    expect(Object.keys(store)).toHaveLength(1);

    const mgr = new DraftManager();
    await mgr.initShared('inst|user');
    expect(mgr.isEnabled()).toBe(true);
    expect(mgr.pendingCount()).toBe(1);
    // Legacy copy removed so it can't shadow newer shared state later.
    expect(Object.keys(store)).toHaveLength(0);
  });

  it('watch() picks up writes from another context and skips self-writes', async () => {
    installChromeMock();
    installLocalStorageMock();
    const a = new DraftManager();
    const b = new DraftManager();
    await a.initShared('inst|user');
    await b.initShared('inst|user');

    let aNotified = 0;
    let bNotified = 0;
    a.watch(() => aNotified++);
    b.watch(() => bNotified++);

    a.setEnabled(true);
    a.addNew(makeDesired());
    // b sees a's writes…
    expect(bNotified).toBeGreaterThan(0);
    expect(b.isEnabled()).toBe(true);
    expect(b.pendingCount()).toBe(1);
    // …while a ignores the echo of its own writes.
    expect(aNotified).toBe(0);
  });

  it('multiple watchers on one manager each fire once per external change', async () => {
    installChromeMock();
    installLocalStorageMock();
    const writer = new DraftManager();
    const reader = new DraftManager();
    await writer.initShared('inst|user');
    await reader.initShared('inst|user');

    let first = 0;
    let second = 0;
    reader.watch(() => first++);
    reader.watch(() => second++);

    writer.addNew(makeDesired());
    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(reader.pendingCount()).toBe(1);
  });
});
