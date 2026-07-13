/**
 * Board Sort Feature
 * Reorders cards within each column by due date, time estimate or time spent.
 * Display-only: GitLab's server-side card order is untouched, and "Original
 * order" restores it from the first-seen index of each card.
 */

import { extractIssueCacheKey, getCachedTimeTracking } from '../utils/api';
import { compareCards, CardSortData, SortMode, SORT_MODES } from '../utils/cardSort';

const STORAGE_KEY = 'gnBoardSortModes';

function isSortMode(value: unknown): value is SortMode {
  return SORT_MODES.some((m) => m.value === value);
}

export class BoardSortFeature {
  private mode: SortMode = 'original';
  /** cacheKey → first-seen document order; survives GitLab recreating card nodes */
  private origIndexByKey = new Map<string, number>();
  private nextOrigIndex = 0;
  /** Resolves once the persisted mode for this board has loaded */
  public readonly ready: Promise<void>;

  constructor() {
    this.ready = this.loadMode().then(() => {
      if (this.mode !== 'original') this.applySort();
    });
  }

  public getMode(): SortMode {
    return this.mode;
  }

  public setMode(mode: SortMode): void {
    this.mode = mode;
    this.saveMode();
    this.applySort();
  }

  /**
   * Idempotent: safe to call on every enhance pass. Stamps first-seen order
   * for new cards, then reorders each column. A pass that changes nothing
   * leaves the DOM untouched, which terminates the MutationObserver cycle.
   */
  public applySort(): void {
    // Always stamp original indexes, even in 'original' mode, so the true
    // order is known before the user ever sorts.
    document.querySelectorAll<HTMLElement>('.board-card').forEach((card) => {
      const key = extractIssueCacheKey(card);
      if (key && !this.origIndexByKey.has(key)) {
        this.origIndexByKey.set(key, this.nextOrigIndex++);
      }
    });

    document
      .querySelectorAll<HTMLElement>('.board, [data-testid="board-list"]')
      .forEach((column) => this.sortColumn(column));
  }

  private sortColumn(column: HTMLElement): void {
    const all = Array.from(column.querySelectorAll<HTMLElement>('.board-card'));
    if (all.length < 2) return;

    // Only sort siblings that share the common parent — defensive against
    // wrapper markup differences across GitLab versions.
    const parentCounts = new Map<HTMLElement, number>();
    for (const card of all) {
      const p = card.parentElement;
      if (p) parentCounts.set(p, (parentCounts.get(p) || 0) + 1);
    }
    let parent: HTMLElement | null = null;
    let best = 0;
    for (const [p, count] of parentCounts) {
      if (count > best) {
        parent = p;
        best = count;
      }
    }
    if (!parent || best < 2) return;
    const container = parent;

    const cards = all.filter((c) => c.parentElement === container);
    const entries = cards.map((card, i) => {
      const key = extractIssueCacheKey(card);
      const info = key ? getCachedTimeTracking(key) : null;
      const data: CardSortData = {
        originalIndex: (key ? this.origIndexByKey.get(key) : undefined) ?? this.nextOrigIndex + i,
        dueDate: info?.dueDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null,
        estimate: info?.estimate ?? 0,
        spent: info?.spent ?? 0,
      };
      return { card, data };
    });

    const sorted = [...entries].sort((a, b) => compareCards(a.data, b.data, this.mode));

    // No-op guard: leaving an already-ordered column alone is what stops the
    // observer → enhance → applySort feedback loop.
    if (sorted.every((entry, i) => entry.card === cards[i])) return;

    // Reinsert before whatever followed the card block (load-more sentinels,
    // spinners) so GitLab's infinite scroll trigger stays in place.
    const anchor = cards[cards.length - 1].nextSibling;
    sorted.forEach((entry) => container.insertBefore(entry.card, anchor));
  }

  private loadMode(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        const modes = result?.[STORAGE_KEY] as Record<string, unknown> | undefined;
        const stored = modes?.[window.location.pathname];
        if (isSortMode(stored)) this.mode = stored;
        resolve();
      });
    });
  }

  private saveMode(): void {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const modes = (result?.[STORAGE_KEY] as Record<string, SortMode>) || {};
      modes[window.location.pathname] = this.mode;
      chrome.storage.local.set({ [STORAGE_KEY]: modes });
    });
  }

  public destroy(): void {
    this.origIndexByKey.clear();
    this.nextOrigIndex = 0;
  }
}
