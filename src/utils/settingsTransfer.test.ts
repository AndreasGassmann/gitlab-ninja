import { describe, it, expect, beforeEach } from 'vitest';
import { installChromeMock } from '../test/chromeMock';
import { buildExport, parseImport, applyImport } from './settingsTransfer';

describe('settingsTransfer', () => {
  let stores: { store: Record<string, any>; localStore: Record<string, any> };

  beforeEach(() => {
    stores = installChromeMock();
  });

  describe('buildExport', () => {
    it('includes sync and local keys with metadata', async () => {
      stores.store.workSettings = { hoursPerDay: 8 };
      stores.localStore.quickNotes = ['note'];
      const bundle = await buildExport({
        includeToken: false,
        version: '1.4.1',
        exportedAt: '2026-08-15T00:00:00.000Z',
      });
      expect(bundle.app).toBe('gitlab-ninja');
      expect(bundle.version).toBe('1.4.1');
      expect(bundle.exportedAt).toBe('2026-08-15T00:00:00.000Z');
      expect(bundle.sync.workSettings).toEqual({ hoursPerDay: 8 });
      expect(bundle.local.quickNotes).toEqual(['note']);
    });

    it('excludes apiToken by default', async () => {
      stores.localStore.apiToken = 'glpat-secret';
      const bundle = await buildExport({
        includeToken: false,
        version: '1.4.1',
        exportedAt: '2026-08-15T00:00:00.000Z',
      });
      expect(bundle.local.apiToken).toBeUndefined();
    });

    it('includes apiToken when includeToken is true', async () => {
      stores.localStore.apiToken = 'glpat-secret';
      const bundle = await buildExport({
        includeToken: true,
        version: '1.4.1',
        exportedAt: '2026-08-15T00:00:00.000Z',
      });
      expect(bundle.local.apiToken).toBe('glpat-secret');
    });

    it('excludes transient keys (drafts)', async () => {
      stores.localStore.newTicketDraft = { title: 'wip' };
      stores.localStore['gn-timelog-drafts:me@gitlab.example.com'] = '{}';
      const bundle = await buildExport({
        includeToken: false,
        version: '1.4.1',
        exportedAt: '2026-08-15T00:00:00.000Z',
      });
      expect(bundle.local.newTicketDraft).toBeUndefined();
      expect(
        Object.keys(bundle.local).some((k) => k.startsWith('gn-timelog-drafts'))
      ).toBe(false);
    });
  });

  describe('parseImport', () => {
    const validBundle = {
      app: 'gitlab-ninja',
      version: '1.4.1',
      exportedAt: '2026-08-15T00:00:00.000Z',
      sync: { workSettings: { hoursPerDay: 8 } },
      local: { quickNotes: [] },
    };

    it('accepts a valid bundle', () => {
      const parsed = parseImport(JSON.stringify(validBundle));
      expect(parsed.sync.workSettings).toEqual({ hoursPerDay: 8 });
    });

    it('rejects invalid JSON', () => {
      expect(() => parseImport('not json {')).toThrow();
    });

    it('rejects a bundle from a different app', () => {
      expect(() =>
        parseImport(JSON.stringify({ ...validBundle, app: 'other-extension' }))
      ).toThrow();
    });

    it('rejects a bundle missing sync/local objects', () => {
      expect(() =>
        parseImport(JSON.stringify({ app: 'gitlab-ninja', version: '1' }))
      ).toThrow();
      expect(() =>
        parseImport(JSON.stringify({ ...validBundle, sync: 'nope' }))
      ).toThrow();
    });
  });

  describe('applyImport', () => {
    it('writes sync and local keys to their areas', async () => {
      await applyImport({
        app: 'gitlab-ninja',
        version: '1.4.1',
        exportedAt: '2026-08-15T00:00:00.000Z',
        sync: { workSettings: { hoursPerDay: 6 } },
        local: { quickNotes: ['a'] },
      });
      expect(stores.store.workSettings).toEqual({ hoursPerDay: 6 });
      expect(stores.localStore.quickNotes).toEqual(['a']);
    });

    it('merges: keys absent from the bundle stay untouched', async () => {
      stores.store.gitlabTheme = 'dark';
      await applyImport({
        app: 'gitlab-ninja',
        version: '1.4.1',
        exportedAt: '2026-08-15T00:00:00.000Z',
        sync: { workSettings: { hoursPerDay: 6 } },
        local: {},
      });
      expect(stores.store.gitlabTheme).toBe('dark');
    });

    it('filters transient keys on import too', async () => {
      await applyImport({
        app: 'gitlab-ninja',
        version: '1.4.1',
        exportedAt: '2026-08-15T00:00:00.000Z',
        sync: {},
        local: { newTicketDraft: { title: 'wip' }, 'gn-timelog-drafts:x': '{}' },
      });
      expect(stores.localStore.newTicketDraft).toBeUndefined();
      expect(stores.localStore['gn-timelog-drafts:x']).toBeUndefined();
    });

    it('imports apiToken when present in the bundle', async () => {
      await applyImport({
        app: 'gitlab-ninja',
        version: '1.4.1',
        exportedAt: '2026-08-15T00:00:00.000Z',
        sync: {},
        local: { apiToken: 'glpat-secret' },
      });
      expect(stores.localStore.apiToken).toBe('glpat-secret');
    });
  });
});
