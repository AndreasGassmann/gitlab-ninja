/**
 * Pure card-sorting comparators for the board sort feature.
 * Kept DOM-free so they can be unit tested in the node environment.
 */

export type SortMode = 'original' | 'dueDate' | 'estimate' | 'spent';

export const SORT_MODES: { value: SortMode; label: string }[] = [
  { value: 'original', label: 'Original order' },
  { value: 'dueDate', label: 'Due date' },
  { value: 'estimate', label: 'Time estimated' },
  { value: 'spent', label: 'Time spent' },
];

export interface CardSortData {
  /** First-seen document order, used for 'original' and as tie-breaker */
  originalIndex: number;
  /** 'YYYY-MM-DD' or null when the issue has no due date */
  dueDate: string | null;
  /** Hours; 0 means no estimate */
  estimate: number;
  /** Hours; 0 means no time logged */
  spent: number;
}

/**
 * Compare two cards for the given sort mode.
 * - original: first-seen order
 * - dueDate: ascending (soonest first), issues without a due date last
 * - estimate/spent: descending (largest first), zero values last
 * Ties always fall back to original order.
 */
export function compareCards(a: CardSortData, b: CardSortData, mode: SortMode): number {
  switch (mode) {
    case 'dueDate': {
      if (a.dueDate && b.dueDate) {
        const cmp = a.dueDate.localeCompare(b.dueDate);
        if (cmp !== 0) return cmp;
      } else if (a.dueDate !== b.dueDate) {
        return a.dueDate ? -1 : 1;
      }
      break;
    }
    case 'estimate':
    case 'spent': {
      const av = a[mode];
      const bv = b[mode];
      if (av > 0 && bv > 0) {
        if (av !== bv) return bv - av;
      } else if ((av > 0) !== (bv > 0)) {
        return av > 0 ? -1 : 1;
      }
      break;
    }
  }
  return a.originalIndex - b.originalIndex;
}
