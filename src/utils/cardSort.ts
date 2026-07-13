/**
 * Pure card-sorting comparators for the board sort feature.
 * Kept DOM-free so they can be unit tested in the node environment.
 */

export type SortMode = 'original' | 'dueDate' | 'estimate' | 'spent';
export type SortDirection = 'asc' | 'desc';

export const SORT_MODES: { value: SortMode; label: string }[] = [
  { value: 'original', label: 'Original order' },
  { value: 'dueDate', label: 'Due date' },
  { value: 'estimate', label: 'Time estimated' },
  { value: 'spent', label: 'Time spent' },
];

/** Natural starting direction when a mode is picked: due dates read
 *  soonest-first, effort reads largest-first. */
export const DEFAULT_DIRECTIONS: Record<SortMode, SortDirection> = {
  original: 'asc',
  dueDate: 'asc',
  estimate: 'desc',
  spent: 'desc',
};

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
 * Compare two cards for the given sort mode and direction.
 * - original: first-seen order (direction has no effect)
 * - dueDate asc: soonest first (overdue → today → future)
 * - estimate/spent asc: smallest first
 * Cards without a value (no due date, zero hours) always sort last,
 * and ties always fall back to original order, regardless of direction.
 */
export function compareCards(
  a: CardSortData,
  b: CardSortData,
  mode: SortMode,
  direction: SortDirection = 'asc'
): number {
  const flip = direction === 'desc' ? -1 : 1;
  switch (mode) {
    case 'dueDate': {
      if (a.dueDate && b.dueDate) {
        const cmp = a.dueDate.localeCompare(b.dueDate);
        if (cmp !== 0) return cmp * flip;
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
        if (av !== bv) return (av - bv) * flip;
      } else if ((av > 0) !== (bv > 0)) {
        return av > 0 ? -1 : 1;
      }
      break;
    }
  }
  return a.originalIndex - b.originalIndex;
}
