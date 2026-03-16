/**
 * Edit Mode Feature
 * Adds an inline "edit" button to each board card.
 * Clicking it reveals form controls on that specific card:
 * - Cards without estimate: select an estimate preset → click Save
 * - Cards with estimate: select time, date, summary → click Log
 *
 * All selections are local state until the user clicks the submit button.
 */

import { TimeInfo } from '../types';
import {
  extractIssueCacheKey,
  extractIidFromCacheKey,
  getCachedTimeTracking,
  cacheTimeTracking,
} from '../utils/api';
import { extractProjectPath, setTimeEstimate, addTimeSpent, formatDate } from '../utils/gitlabApi';
import { formatHours } from '../utils/time';
import { ESTIMATE_PRESETS } from '../utils/constants';

const SPENT_PRESETS = [
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1h', value: '1h' },
  { label: '2h', value: '2h' },
  { label: '4h', value: '4h' },
  { label: '1d', value: '1d' },
];

const DATE_PRESETS = [
  { label: 'today', offset: 0 },
  { label: '-1', offset: -1 },
  { label: '-2', offset: -2 },
];

function stopBubble(e: Event): void {
  e.stopPropagation();
}

export class EditModeFeature {
  private onRefresh: (() => void) | null = null;

  public setOnRefresh(cb: () => void): void {
    this.onRefresh = cb;
  }

  public enhanceCards(): void {
    const cards = document.querySelectorAll<HTMLElement>('.board-card');
    cards.forEach((card) => this.addEditButton(card));
  }

  private addEditButton(card: HTMLElement): void {
    if (card.querySelector('.gn-edit-btn')) return;

    const iid = extractIssueCacheKey(card);
    if (!iid) return;

    const btn = document.createElement('button');
    btn.className = 'gn-edit-btn';
    btn.type = 'button';
    btn.title = 'Edit time tracking';
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="gl-icon s16"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L3.463 11.1l-.47 1.64 1.641-.47 8.61-8.61a.25.25 0 0 0 0-.354l-1.086-1.086Z"/></svg>`;

    // Block event bubbling to prevent GitLab sidebar
    for (const evt of [
      'click',
      'mousedown',
      'mouseup',
      'pointerdown',
      'pointerup',
      'touchstart',
      'touchend',
    ]) {
      btn.addEventListener(evt, stopBubble);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleEditControls(card, iid);
    });

    // Insert next to the 3-dot dropdown menu
    const dropdown = card.querySelector(
      '.gl-disclosure-dropdown, [data-testid="board-move-to-position"]'
    );
    if (dropdown && dropdown.parentElement) {
      dropdown.parentElement.insertBefore(btn, dropdown);
    } else {
      card.appendChild(btn);
    }
  }

  private toggleEditControls(card: HTMLElement, iid: string): void {
    const existing = card.querySelector('.gn-edit-controls');
    if (existing) {
      existing.remove();
      card.classList.remove('gn-has-edit-controls');
      return;
    }

    const timeInfo = getCachedTimeTracking(iid);
    const hasEstimate = timeInfo && timeInfo.estimate > 0;

    const controls = document.createElement('div');
    controls.className = 'gn-edit-controls';
    controls.dataset.gnIid = iid;

    // Block all events from bubbling to GitLab's card handler
    for (const evt of [
      'click',
      'mousedown',
      'mouseup',
      'pointerdown',
      'pointerup',
      'touchstart',
      'touchend',
    ]) {
      controls.addEventListener(evt, stopBubble);
    }

    card.classList.add('gn-has-edit-controls');

    if (!hasEstimate) {
      this.buildEstimateForm(controls, card, iid);
    } else {
      this.buildSpentForm(controls, card, iid, timeInfo as TimeInfo);
    }

    card.appendChild(controls);
  }

  // ── Estimate form ──────────────────────────────────────────────────

  private buildEstimateForm(controls: HTMLElement, card: HTMLElement, iid: string): void {
    let selectedValue: string | null = null;

    const btns = ESTIMATE_PRESETS.map(
      (p) =>
        `<button type="button" class="gn-preset-btn" data-value="${p.value}">${p.label}</button>`
    ).join('');

    controls.innerHTML = `
      <div class="gn-edit-row">
        <span class="gn-edit-label">Est:</span>
        <div class="gn-preset-group">${btns}</div>
        <button type="button" class="gn-submit-btn" disabled>Set</button>
      </div>
    `;

    const submitBtn = controls.querySelector<HTMLButtonElement>('.gn-submit-btn');
    if (!submitBtn) return;

    // Preset selection (toggle)
    controls.querySelectorAll<HTMLButtonElement>('.gn-preset-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        controls
          .querySelectorAll('.gn-preset-btn')
          .forEach((b) => b.classList.remove('gn-selected'));
        btn.classList.add('gn-selected');
        selectedValue = btn.dataset.value ?? null;
        submitBtn.disabled = false;
      });
    });

    // Submit
    submitBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!selectedValue) return;

      const projectPath = extractProjectPath(card);
      if (!projectPath) return;

      submitBtn.disabled = true;
      submitBtn.textContent = '...';

      const ok = await setTimeEstimate(projectPath, extractIidFromCacheKey(iid), selectedValue);
      if (ok) {
        const hours = this.durationToHours(selectedValue);
        const existing = getCachedTimeTracking(iid) || { spent: 0, estimate: 0 };
        cacheTimeTracking(iid, { ...existing, estimate: hours });
        this.refreshCard(card);
      } else {
        submitBtn.textContent = 'Set';
        submitBtn.disabled = false;
      }
    });
  }

  // ── Time spent form ────────────────────────────────────────────────

  private buildSpentForm(
    controls: HTMLElement,
    card: HTMLElement,
    iid: string,
    timeInfo: TimeInfo
  ): void {
    let selectedSpent: string | null = null;
    let selectedDate = formatDate(new Date());

    const spentBtns = SPENT_PRESETS.map(
      (p) =>
        `<button type="button" class="gn-preset-btn" data-value="${p.value}">${p.label}</button>`
    ).join('');

    const today = new Date();
    const dateBtns = DATE_PRESETS.map((p) => {
      const d = new Date(today);
      d.setDate(d.getDate() + p.offset);
      const iso = formatDate(d);
      return `<button type="button" class="gn-date-btn${p.offset === 0 ? ' gn-active' : ''}" data-date="${iso}">${p.label}</button>`;
    }).join('');

    const spentStr = timeInfo.spent > 0 ? formatHours(timeInfo.spent) : '0h';
    const estStr = formatHours(timeInfo.estimate);

    controls.innerHTML = `
      <div class="gn-edit-row gn-edit-info">
        <span class="gn-spent-info">${spentStr} / ${estStr}</span>
      </div>
      <div class="gn-edit-row">
        <span class="gn-edit-label">Log:</span>
        <div class="gn-preset-group">${spentBtns}</div>
      </div>
      <div class="gn-edit-row">
        <span class="gn-edit-label">Date:</span>
        <div class="gn-preset-group">${dateBtns}</div>
        <input type="date" class="gn-date-picker" value="${selectedDate}" />
      </div>
      <div class="gn-edit-row">
        <span class="gn-edit-label">Note:</span>
        <input type="text" class="gn-summary-input" placeholder="summary" />
        <button type="button" class="gn-submit-btn" disabled>Log</button>
      </div>
    `;

    const submitBtn = controls.querySelector<HTMLButtonElement>('.gn-submit-btn');
    if (!submitBtn) return;

    // Spent preset selection
    controls.querySelectorAll<HTMLButtonElement>('.gn-preset-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        controls
          .querySelectorAll('.gn-preset-btn')
          .forEach((b) => b.classList.remove('gn-selected'));
        btn.classList.add('gn-selected');
        selectedSpent = btn.dataset.value ?? null;
        submitBtn.disabled = false;
      });
    });

    // Date picker
    const datePicker = controls.querySelector<HTMLInputElement>('.gn-date-picker');
    if (!datePicker) return;

    // Date selection
    controls.querySelectorAll<HTMLButtonElement>('.gn-date-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        controls.querySelectorAll('.gn-date-btn').forEach((b) => b.classList.remove('gn-active'));
        btn.classList.add('gn-active');
        selectedDate = btn.dataset.date ?? selectedDate;
        datePicker.value = selectedDate;
      });
    });
    datePicker.addEventListener('click', stopBubble);
    datePicker.addEventListener('mousedown', stopBubble);
    datePicker.addEventListener('focus', stopBubble);
    datePicker.addEventListener('keydown', (e) => e.stopPropagation());
    datePicker.addEventListener('change', (e) => {
      e.stopPropagation();
      selectedDate = datePicker.value;
      controls.querySelectorAll('.gn-date-btn').forEach((b) => b.classList.remove('gn-active'));
    });

    // Summary input event blocking
    const summaryInput = controls.querySelector<HTMLInputElement>('.gn-summary-input');
    if (!summaryInput) return;
    summaryInput.addEventListener('click', stopBubble);
    summaryInput.addEventListener('mousedown', stopBubble);
    summaryInput.addEventListener('focus', stopBubble);
    summaryInput.addEventListener('keydown', (e) => e.stopPropagation());

    // Submit
    submitBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!selectedSpent) return;

      const projectPath = extractProjectPath(card);
      if (!projectPath) return;

      const summary = summaryInput.value || undefined;

      submitBtn.disabled = true;
      submitBtn.textContent = '...';

      const ok = await addTimeSpent(
        projectPath,
        extractIidFromCacheKey(iid),
        selectedSpent,
        summary,
        selectedDate
      );
      if (ok) {
        const hours = this.durationToHours(selectedSpent);
        const existing = getCachedTimeTracking(iid) || { spent: 0, estimate: 0 };
        cacheTimeTracking(iid, { ...existing, spent: existing.spent + hours });
        this.refreshCard(card);
      } else {
        submitBtn.textContent = 'Log';
        submitBtn.disabled = false;
      }
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private refreshCard(card: HTMLElement): void {
    card.querySelectorAll('.gn-edit-controls').forEach((el) => el.remove());
    card.classList.remove('gn-has-edit-controls');
    // Re-add the edit button
    card.querySelectorAll('.gn-edit-btn').forEach((el) => el.remove());
    this.addEditButton(card);
    // Trigger full UI refresh (time tracking display, column summaries, etc.)
    if (this.onRefresh) this.onRefresh();
  }

  private durationToHours(duration: string): number {
    const match = duration.match(/^(\d+(?:\.\d+)?)(m|h|d)$/);
    if (!match) return 0;
    const val = parseFloat(match[1]);
    switch (match[2]) {
      case 'm':
        return val / 60;
      case 'h':
        return val;
      case 'd':
        return val * 8;
      default:
        return 0;
    }
  }

  private removeAllControls(): void {
    document.querySelectorAll('.gn-edit-controls').forEach((el) => el.remove());
    document.querySelectorAll('.gn-has-edit-controls').forEach((el) => {
      el.classList.remove('gn-has-edit-controls');
    });
    document.querySelectorAll('.gn-edit-btn').forEach((el) => el.remove());
  }

  public destroy(): void {
    this.removeAllControls();
  }
}
