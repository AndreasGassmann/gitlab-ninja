import { describe, it, expect, beforeEach } from 'vitest';
import { installChromeMock } from '../test/chromeMock';
import {
  DEFAULT_WORK_SETTINGS,
  loadWorkSettings,
  saveWorkSettings,
  initWorkSettings,
  getWorkSettings,
} from './workSettings';

describe('workSettings', () => {
  beforeEach(() => installChromeMock());

  it('getWorkSettings returns defaults before init', () => {
    expect(getWorkSettings()).toEqual(DEFAULT_WORK_SETTINGS);
  });

  it('loadWorkSettings returns defaults when nothing stored', async () => {
    expect(await loadWorkSettings()).toEqual(DEFAULT_WORK_SETTINGS);
  });

  it('loadWorkSettings merges a partial stored object over defaults', async () => {
    saveWorkSettings({ ...DEFAULT_WORK_SETTINGS, hoursPerDay: 7 });
    const loaded = await loadWorkSettings();
    expect(loaded.hoursPerDay).toBe(7);
    expect(loaded.hoursPerWeek).toBe(40);
  });

  it('init populates the sync cache', async () => {
    saveWorkSettings({ ...DEFAULT_WORK_SETTINGS, warningThreshold: 0.5 });
    await initWorkSettings();
    expect(getWorkSettings().warningThreshold).toBe(0.5);
  });

  it('cache updates live when storage changes', async () => {
    await initWorkSettings();
    saveWorkSettings({ ...DEFAULT_WORK_SETTINGS, timeIncrementMinutes: 30 });
    expect(getWorkSettings().timeIncrementMinutes).toBe(30);
  });
});
