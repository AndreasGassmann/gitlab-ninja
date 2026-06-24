# Timelog Draft Mode + No-op Guards

## Problem

GitLab GraphQL has no `timelogUpdate` mutation. Every edit of a timelog is
implemented as `timelogCreate` (new) + `timelogDelete` (old). Each create emits a
system note "added Xh", each delete "deleted Xh". So:

1. **No-op churn:** Saving an edit without changing anything still runs
   create+delete, producing a spurious "added Xh / deleted Xh" pair with
   identical value+time. The popover Save (`options.ts:1760`) has no guard at
   all; inline duration edit only checks for empty; drag-move has no guard.
2. **Edit churn:** Dragging an entry, changing its duration, then dragging again
   produces three create+delete pairs instead of one.

## Goals

- **No-op guards** on every instant-commit path so unchanged saves do nothing.
- **Draft mode** (toggle): stage drag/drop/add/edit/delete locally
  (localStorage, survives refresh/restart), then **Commit** all at once with the
  minimal number of mutations — one logical change = one create+delete at most,
  regardless of how many intermediate edits were made.
- Commit must be **transactional-ish**: on partial failure, keep going and
  surface a summary so nothing is silently lost.
- A **preview** before commit.
- Staged edits **visually distinct** in all views.

## Part A — No-op guards (draft OFF, instant mode)

On every instant-commit edit path, before running create+delete, compare the
resulting `{ timeSpent, spentAt, note }` against the original timelog. If all
three are equal, skip the mutation entirely (treat as a successful cancel).

Paths to guard:
- Popover Save — `options.ts:1760`
- Drag-move (calendar) — `options.ts:1526`, `1551`
- Inline duration/date/summary edit — `options.ts:805` (extend duration to
  compare value, not just empty)

A shared helper `timelogUnchanged(original, next)` lives in the new draft module
and is reused by the diff engine.

## Part B — Draft mode

### Activation
A **toggle** in the dashboard toolbar. OFF (default) = current instant behavior
(plus Part A guards). ON = all edits stage locally. The toggle state and drafts
both persist in localStorage and survive refresh/restart. The toggle shows a
pending-count badge when there are uncommitted changes.

### State model — desired-state diff (not operation log)

New module `src/utils/timelogDrafts.ts`. Each draft tracks an entry's final
desired state plus a snapshot of its original:

```ts
interface DraftDesired {
  issueGid: string;
  issueIid: number;
  issueTitle: string;
  issueUrl: string;
  projectName: string;
  projectId: string;
  timeSpent: number; // seconds
  spentAt: string;   // full ISO
  note: string;
}

interface DraftEntry {
  draftId: string;            // local id (counter-based; no Math.random/Date)
  originId: string | null;    // gid of original Timelog; null = newly added
  deleted: boolean;           // original marked for removal
  desired: DraftDesired;      // ignored when deleted
  original?: {                // snapshot for diff + preview; absent for new
    timeSpent: number;
    spentAt: string;
    note: string;
  };
}

interface DraftStore {
  enabled: boolean;
  byOrigin: Record<string, DraftEntry>; // originId -> draft (modified/deleted)
  added: DraftEntry[];                   // originId === null
}
```

localStorage key is scoped per gitlab instance + user:
`gn-timelog-drafts:<gitlabUrl>:<username>`.

Rationale for desired-state over op-log: drag → edit → drag collapses to one diff
vs the original; add-then-delete of a brand-new entry drops the draft entirely
(zero mutations); a no-op is skipped for free.

### Edit routing

Every edit entry point checks `store.enabled`:
- ON → mutate the draft store and re-render. No network.
- OFF → existing instant path (with Part A guards).

Entry points: popover save, add popover, drag-move, inline edits, delete.

Operations on the store:
- **add(desired)** → push to `added`.
- **edit(target, patch)** → if target is an original, upsert into `byOrigin`
  with merged desired + original snapshot; if target is an added draft, mutate it
  in place. If an edit makes a `byOrigin` draft equal to its original, drop the
  draft.
- **remove(target)** → if original, set `deleted` in `byOrigin`; if added draft,
  splice it out (zero mutations).

### Rendering effective state

`applyDrafts(cachedTimelogs, store)` returns a list of
`TimelogDetail & { draftStatus?: 'new'|'modified'|'deleted' }`:
- original with no draft → unchanged
- `byOrigin` modified → replaced by desired, tagged `modified`
- `byOrigin` deleted → tagged `deleted` (kept in list for display, excluded from
  time totals)
- `added` → appended, tagged `new`

Render functions (`renderWeek`, `renderCalendarWeek`, `renderCalendarMonth`)
consume this list and apply per-status styling. Deleted entries are faded +
struck through; new = dashed accent border + tag; modified = accent tint + tag.

### Commit

`buildPlan(store)` produces a list of logical changes, each with its API ops:

| Draft           | Ops                         |
|-----------------|-----------------------------|
| new             | create                      |
| original deleted| delete                      |
| original modified (differs) | create new, then delete old |
| unchanged       | skipped                     |

Order is **create-then-delete** so a mid-failure leaves a recoverable duplicate,
never data loss.

Commit runs logical changes **sequentially**. Per change: on full success, clear
that draft; on any failure, keep the draft staged and record the error. If a
"create new" succeeds but "delete old" fails, flag it as a possible duplicate.
After the batch, refetch (silentRefresh) and show a **summary modal**:
succeeded / failed / possible-duplicate lists.

### Preview modal (on Commit click)

Lists every pending change grouped by issue, e.g.
`ADD 2h @ Mon 09:00`, `MOVE 1h Tue 09:00 → Wed 14:00`, `EDIT 2h → 3h`,
`DELETE 4h @ Tue`. Footer: `N changes → M API calls`. Confirm / Cancel.

### Toggle OFF with pending changes

Prompt with three choices: **Commit now** / **Discard drafts** / **Cancel**
(stay in draft mode).

## Files

- **New** `src/utils/timelogDrafts.ts` — store, persistence, `applyDrafts`,
  `buildPlan`, `timelogUnchanged`, mutation helpers. Pure/DOM-free except
  localStorage.
- `src/options.ts` — toggle UI, edit routing, render tagging, commit + preview +
  summary modals, toggle-off guard, Part A guards.
- `src/options.html` / options CSS — toggle control, draft styling, modals.

## Constraints

- No `Math.random()` / `Date.now()` reliance in draft IDs that must survive
  reload — use a persisted incrementing counter.
- Drafts referencing an `originId` no longer present after refetch (deleted
  elsewhere) are flagged as conflicts in the preview; their delete will fail at
  commit and be surfaced.

## Verification

No unit-test harness in repo. Verify via `npm run check`
(type-check + lint + format:check + build) plus manual exercise of: toggle,
stage add/edit/delete/drag, refresh-persistence, preview, commit, partial-fail
summary, toggle-off prompt, and that draft-OFF no-op saves produce no GitLab
mutation.
