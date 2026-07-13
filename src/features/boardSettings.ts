/**
 * Board Settings Toolbar
 * Adds a settings bar at the top-right of the board with toggles
 */

import { debugLog } from '../utils/debug';
import { getWorkSettings } from '../utils/workSettings';
import { DraftManager } from '../utils/timelogDrafts';
import { BoardSortFeature } from './boardSort';
import { SORT_MODES, SortMode } from '../utils/cardSort';

export type SettingsChangeCallback = (settings: BoardSettingsState) => void;

export interface BoardSettingsState {
  autoAssign: boolean;
}

const STORAGE_KEY = 'gitlab-ninja-board-settings';

export class BoardSettingsFeature {
  private container: HTMLElement | null = null;
  private state: BoardSettingsState;
  private onChange: SettingsChangeCallback;
  private refreshTimer: number | null = null;
  private draftsReady: Promise<DraftManager> | null = null;
  private sortFeature: BoardSortFeature | null = null;

  constructor(
    onChange: SettingsChangeCallback,
    draftsReady?: Promise<DraftManager>,
    sortFeature?: BoardSortFeature
  ) {
    this.onChange = onChange;
    this.draftsReady = draftsReady || null;
    this.sortFeature = sortFeature || null;
    this.state = this.loadState();
  }

  public getState(): BoardSettingsState {
    return { ...this.state };
  }

  /**
   * Insert the settings toolbar into the board page
   */
  public init(): void {
    // Wait for the board header to exist
    this.tryInsert();
  }

  private tryInsert(): void {
    if (document.querySelector('.gitlab-ninja-settings')) return;

    // Find the boards list and insert just before it
    const boardsList = document.querySelector('.boards-list, [data-testid="boards-list"]');

    if (!boardsList) {
      // Retry until the page loads
      setTimeout(() => this.tryInsert(), 1000);
      return;
    }

    this.container = document.createElement('div');
    this.container.className = 'gitlab-ninja-settings';
    this.container.innerHTML = this.renderHTML();
    boardsList.parentElement?.insertBefore(this.container, boardsList);

    this.bindEvents();
    // Fire initial state so features align
    this.onChange(this.state);

    // Fetch and display today's logged time
    this.fetchTodayLogged();
    // Refresh every 60 seconds
    this.refreshTimer = window.setInterval(() => this.fetchTodayLogged(), 60000);

    // Show pending draft timelogs (staged locally, not yet sent to GitLab)
    this.initDraftIndicator();

    debugLog('GitLab Ninja: Settings toolbar inserted');
  }

  private async initDraftIndicator(): Promise<void> {
    if (!this.draftsReady) return;
    let drafts: DraftManager;
    try {
      drafts = await this.draftsReady;
    } catch {
      return;
    }
    this.updateDraftIndicator(drafts);
    // Re-render whenever any context (this page, options page) stages/commits.
    drafts.watch(() => this.updateDraftIndicator(drafts));
  }

  private updateDraftIndicator(drafts: DraftManager): void {
    const chip = this.container?.querySelector<HTMLElement>('.gn-draft-indicator');
    if (!chip) return;
    // Pending drafts normally only exist while draft mode is on, but leftovers
    // from a partially failed commit should stay visible either way.
    const count = drafts.pendingCount();
    if (count === 0) {
      chip.style.display = 'none';
      return;
    }
    chip.style.display = '';
    chip.textContent = `${count} draft${count === 1 ? '' : 's'}`;
    chip.title = `${count} staged timelog change${count === 1 ? '' : 's'} — open time planning to review & commit`;
  }

  private renderHTML(): string {
    return `
      <div class="gn-settings-bar">
        <div class="gn-toolbar-controls">
          <button class="gn-pill-toggle${this.state.autoAssign ? ' gn-active' : ''}" data-gn-toggle="autoAssign">
            <span class="gn-pill-dot"></span>
            <span>Auto-assign</span>
          </button>
          <label class="gn-sort-control" title="Display-only sort; drag positions still save">
            <span class="gn-sort-label">Sort</span>
            <select class="gn-sort-select">${this.renderSortOptions()}</select>
          </label>
        </div>
        <div class="gn-toolbar-status">
          <button class="gn-draft-indicator" type="button" style="display:none"></button>
          <div class="gn-daily-progress">
            <span class="gn-daily-label">Today</span>
            <div class="gn-daily-bar">
              <div class="gn-daily-bar-fill"></div>
            </div>
            <span class="gn-daily-value">–</span>
          </div>
        </div>
      </div>
    `;
  }

  private renderSortOptions(): string {
    const current = this.sortFeature?.getMode() ?? 'original';
    return SORT_MODES.map(
      (m) =>
        `<option value="${m.value}"${m.value === current ? ' selected' : ''}>${m.label}</option>`
    ).join('');
  }

  private async fetchTodayLogged(): Promise<void> {
    const fill = this.container?.querySelector<HTMLElement>('.gn-daily-bar-fill');
    const value = this.container?.querySelector('.gn-daily-value');
    const bar = this.container?.querySelector<HTMLElement>('.gn-daily-bar');
    if (!fill || !value || !bar) return;

    try {
      const { apiToken, gitlabUrl } = await this.getApiCredentials();
      if (!apiToken || !gitlabUrl) {
        value.textContent = '–';
        fill.style.width = '0%';
        return;
      }

      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const nextDay = new Date(now);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDateStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;

      const query = `query {
        currentUser {
          timelogs(startDate: "${dateStr}", endDate: "${nextDateStr}") {
            nodes {
              timeSpent
              spentAt
            }
          }
        }
      }`;

      const response = await fetch(`${gitlabUrl}/api/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PRIVATE-TOKEN': apiToken,
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        value.textContent = '–';
        fill.style.width = '0%';
        return;
      }

      const data = await response.json();
      const nodes = data?.data?.currentUser?.timelogs?.nodes || [];

      let totalSeconds = 0;
      for (const node of nodes) {
        const spentDate = node.spentAt?.split('T')[0] || '';
        if (spentDate === dateStr) {
          totalSeconds += node.timeSpent || 0;
        }
      }

      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const targetH = Math.floor(getWorkSettings().dailyTargetSeconds / 3600);
      const targetM = Math.floor((getWorkSettings().dailyTargetSeconds % 3600) / 60);
      value.textContent = `${h}h ${m}m / ${targetH}h ${targetM}m`;

      const pct = Math.min((totalSeconds / getWorkSettings().dailyTargetSeconds) * 100, 100);
      fill.style.width = `${pct}%`;

      // Color based on progress
      bar.classList.remove('gn-bar-green', 'gn-bar-indigo', 'gn-bar-red');
      if (totalSeconds > getWorkSettings().dailyTargetSeconds) {
        bar.classList.add('gn-bar-red');
      } else if (totalSeconds >= getWorkSettings().dailyTargetSeconds * 0.95) {
        bar.classList.add('gn-bar-indigo');
      } else {
        bar.classList.add('gn-bar-green');
      }
    } catch {
      value.textContent = '–';
      fill.style.width = '0%';
    }
  }

  private async getApiCredentials(): Promise<{
    apiToken: string | null;
    gitlabUrl: string | null;
  }> {
    const [tokenResult, syncResult] = await Promise.all([
      new Promise<Record<string, string>>((resolve) =>
        chrome.storage.local.get('apiToken', resolve)
      ),
      new Promise<Record<string, string>>((resolve) =>
        chrome.storage.sync.get('lastGitlabUrl', resolve)
      ),
    ]);
    return {
      apiToken: tokenResult.apiToken || null,
      gitlabUrl: syncResult.lastGitlabUrl || window.location.origin,
    };
  }

  private bindEvents(): void {
    if (!this.container) return;

    const pill = this.container.querySelector('[data-gn-toggle="autoAssign"]');
    pill?.addEventListener('click', () => {
      this.state.autoAssign = !this.state.autoAssign;
      pill.classList.toggle('gn-active', this.state.autoAssign);
      this.saveState();
      this.onChange(this.state);
    });

    // Draft chip opens the time-planning view where drafts are reviewed/committed
    this.container.querySelector('.gn-draft-indicator')?.addEventListener('click', () => {
      window.open(chrome.runtime.getURL('options.html'));
    });

    const sortSelect = this.container.querySelector<HTMLSelectElement>('.gn-sort-select');
    if (sortSelect && this.sortFeature) {
      const sortFeature = this.sortFeature;
      sortSelect.addEventListener('change', () => {
        sortFeature.setMode(sortSelect.value as SortMode);
      });
      // The toolbar can render before the persisted mode has loaded
      sortFeature.ready.then(() => {
        sortSelect.value = sortFeature.getMode();
      });
    }
  }

  private loadState(): BoardSettingsState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return { autoAssign: true };
  }

  private saveState(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* ignore */
    }
  }

  public destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.container?.remove();
    this.container = null;
  }
}
