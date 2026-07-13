import { describe, it, expect, beforeEach } from 'vitest';
import { installChromeMock } from '../test/chromeMock';
import { DEFAULT_WORK_SETTINGS, saveWorkSettings, initWorkSettings } from './workSettings';
import { parseTimeToHours, formatHours } from './time';

describe('time conversions honor workSettings', () => {
  beforeEach(() => installChromeMock());

  it('uses default 8h/day, 40h/week', async () => {
    await initWorkSettings();
    expect(parseTimeToHours('1d')).toBe(8);
    expect(parseTimeToHours('1w')).toBe(40);
    expect(formatHours(8)).toBe('1d');
    expect(formatHours(40)).toBe('1w');
  });

  it('honors custom 6h/day, 30h/week', async () => {
    saveWorkSettings({ ...DEFAULT_WORK_SETTINGS, hoursPerDay: 6, hoursPerWeek: 30 });
    await initWorkSettings();
    expect(parseTimeToHours('1d')).toBe(6);
    expect(parseTimeToHours('1w')).toBe(30);
    expect(formatHours(6)).toBe('1d');
    expect(formatHours(30)).toBe('1w');
  });
});

describe('parseTimeToHours edge cases', () => {
  beforeEach(async () => {
    installChromeMock();
    await initWorkSettings();
  });

  it('converts minutes to fractional hours', () => {
    expect(parseTimeToHours('30m')).toBe(0.5);
    expect(parseTimeToHours('90m')).toBe(1.5);
  });

  it('returns 0 for null, empty, or unparseable input', () => {
    expect(parseTimeToHours(null)).toBe(0);
    expect(parseTimeToHours(undefined)).toBe(0);
    expect(parseTimeToHours('')).toBe(0);
    expect(parseTimeToHours('abc')).toBe(0);
  });
});

describe('formatHours composition', () => {
  beforeEach(async () => {
    installChromeMock();
    await initWorkSettings(); // 8h/day, 40h/week
  });

  it('returns 0h for zero', () => {
    expect(formatHours(0)).toBe('0h');
  });

  it('shows day + hour remainder', () => {
    expect(formatHours(10)).toBe('1d 2h');
  });

  it('shows week + hour remainder', () => {
    expect(formatHours(45)).toBe('1w 5h');
  });

  it('shows bare hours below a day', () => {
    expect(formatHours(3)).toBe('3h');
  });
});

describe('formatHours minute segments', () => {
  beforeEach(async () => {
    installChromeMock();
    await initWorkSettings(); // 8h/day, 40h/week
  });

  it('renders fractional hours as minutes instead of raw floats', () => {
    expect(formatHours(10 / 60)).toBe('10m');
    expect(formatHours(0.5)).toBe('30m');
  });

  it('combines hours and minutes', () => {
    expect(formatHours(1.5)).toBe('1h 30m');
  });

  it('combines days, hours and minutes', () => {
    expect(formatHours(10.25)).toBe('1d 2h 15m');
    expect(formatHours(8 + 10 / 60)).toBe('1d 10m');
  });

  it('fully decomposes the week remainder', () => {
    expect(formatHours(50)).toBe('1w 1d 2h');
  });

  it('treats sub-minute values as zero', () => {
    expect(formatHours(0.001)).toBe('0h');
  });

  it('honors custom work settings', async () => {
    saveWorkSettings({ ...DEFAULT_WORK_SETTINGS, hoursPerDay: 6, hoursPerWeek: 30 });
    await initWorkSettings();
    expect(formatHours(6.5)).toBe('1d 30m');
  });
});
