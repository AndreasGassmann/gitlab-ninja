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
