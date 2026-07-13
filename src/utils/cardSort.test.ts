import { describe, it, expect } from 'vitest';
import { compareCards, CardSortData, SortMode } from './cardSort';

function card(overrides: Partial<CardSortData> & { originalIndex: number }): CardSortData {
  return { dueDate: null, estimate: 0, spent: 0, ...overrides };
}

function sortBy(cards: CardSortData[], mode: SortMode): number[] {
  return [...cards].sort((a, b) => compareCards(a, b, mode)).map((c) => c.originalIndex);
}

describe('compareCards', () => {
  it('original mode sorts by first-seen index', () => {
    const cards = [
      card({ originalIndex: 2, dueDate: '2026-01-01', estimate: 5 }),
      card({ originalIndex: 0, dueDate: '2026-12-31' }),
      card({ originalIndex: 1, spent: 3 }),
    ];
    expect(sortBy(cards, 'original')).toEqual([0, 1, 2]);
  });

  it('dueDate sorts ascending with nulls last', () => {
    const cards = [
      card({ originalIndex: 0, dueDate: null }),
      card({ originalIndex: 1, dueDate: '2026-08-01' }),
      card({ originalIndex: 2, dueDate: '2026-07-15' }),
    ];
    expect(sortBy(cards, 'dueDate')).toEqual([2, 1, 0]);
  });

  it('dueDate ties fall back to original order', () => {
    const cards = [
      card({ originalIndex: 1, dueDate: '2026-07-15' }),
      card({ originalIndex: 0, dueDate: '2026-07-15' }),
    ];
    expect(sortBy(cards, 'dueDate')).toEqual([0, 1]);
  });

  it('estimate sorts descending with zeros last', () => {
    const cards = [
      card({ originalIndex: 0, estimate: 0 }),
      card({ originalIndex: 1, estimate: 2 }),
      card({ originalIndex: 2, estimate: 8 }),
    ];
    expect(sortBy(cards, 'estimate')).toEqual([2, 1, 0]);
  });

  it('spent sorts descending with zeros last and ties by original order', () => {
    const cards = [
      card({ originalIndex: 3, spent: 0 }),
      card({ originalIndex: 2, spent: 4 }),
      card({ originalIndex: 1, spent: 4 }),
      card({ originalIndex: 0, spent: 0 }),
    ];
    expect(sortBy(cards, 'spent')).toEqual([1, 2, 0, 3]);
  });

  it('sorts a mixed set per mode', () => {
    const cards = [
      card({ originalIndex: 0, dueDate: null, estimate: 4, spent: 1 }),
      card({ originalIndex: 1, dueDate: '2026-07-20', estimate: 0, spent: 6 }),
      card({ originalIndex: 2, dueDate: '2026-07-14', estimate: 8, spent: 0 }),
      card({ originalIndex: 3, dueDate: '2026-07-20', estimate: 2, spent: 6 }),
    ];
    expect(sortBy(cards, 'original')).toEqual([0, 1, 2, 3]);
    expect(sortBy(cards, 'dueDate')).toEqual([2, 1, 3, 0]);
    expect(sortBy(cards, 'estimate')).toEqual([2, 0, 3, 1]);
    expect(sortBy(cards, 'spent')).toEqual([1, 3, 0, 2]);
  });
});
