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
import { extractProjectPath, setTimeEstimate, addTimeSpent, formatDate, fetchTimelogs, Timelog } from '../utils/gitlabApi';
import { formatHours } from '../utils/time';
import { ESTIMATE_PRESETS, SPENT_PRESETS } from '../utils/constants';

const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Go back N workdays (skipping weekends) from a given date. */
function workdayOffset(from: Date, workdays: number): Date {
  const d = new Date(from);
  let remaining = Math.abs(workdays);
  const dir = workdays < 0 ? -1 : 1;
  while (remaining > 0) {
    d.setDate(d.getDate() + dir);
    if (d.getDay() !== 0 && d.getDay() !== 6) remaining--;
  }
  return d;
}

function buildDatePresets() {
  const today = new Date();
  const m1 = workdayOffset(today, -1);
  const m2 = workdayOffset(today, -2);
  return [
    { label: 'now', date: today, setTime: true },
    { label: `-1 ${DAY_ABBR[m1.getDay()]}`, date: m1, setTime: false },
    { label: `-2 ${DAY_ABBR[m2.getDay()]}`, date: m2, setTime: false },
  ];
}

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

    // Use compact subset for narrow board cards; custom input covers the rest
    const compactPresets = ESTIMATE_PRESETS.filter((p) => ['15m', '30m', '1h', '2h', '4h', '1d'].includes(p.value));
    const btns = compactPresets.map(
      (p) =>
        `<button type="button" class="gn-preset-btn" data-value="${p.value}">${p.label}</button>`
    ).join('');

    controls.innerHTML = `
      <div class="gn-edit-row">
        <span class="gn-edit-label">Est:</span>
        <div class="gn-preset-group">${btns}<input type="text" class="gn-custom-input" placeholder="custom" /></div>
        <button type="button" class="gn-submit-btn" disabled>Set</button>
      </div>
    `;

    const submitBtn = controls.querySelector<HTMLButtonElement>('.gn-submit-btn');
    const customInput = controls.querySelector<HTMLInputElement>('.gn-custom-input');
    if (!submitBtn) return;

    // Preset selection (toggle)
    controls.querySelectorAll<HTMLButtonElement>('.gn-preset-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        controls
          .querySelectorAll('.gn-preset-btn')
          .forEach((b) => b.classList.remove('gn-selected'));
        btn.classList.add('gn-selected');
        if (customInput) customInput.value = '';
        selectedValue = btn.dataset.value ?? null;
        submitBtn.disabled = false;
      });
    });

    // Custom input
    if (customInput) {
      customInput.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = customInput.value.trim();
        if (val) {
          controls.querySelectorAll('.gn-preset-btn').forEach((b) => b.classList.remove('gn-selected'));
          selectedValue = val;
          submitBtn.disabled = false;
        } else {
          selectedValue = null;
          submitBtn.disabled = true;
        }
      });
      customInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && selectedValue) {
          e.preventDefault();
          submitBtn.click();
        }
      });
    }

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
    const nowTime = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
    let selectedTime = nowTime;

    // Use compact subset for narrow board cards; custom input covers the rest
    const compactPresets = SPENT_PRESETS.filter((p) => ['15m', '30m', '1h', '2h', '4h'].includes(p.value));
    const spentBtns = compactPresets.map(
      (p) =>
        `<button type="button" class="gn-preset-btn" data-value="${p.value}">${p.label}</button>`
    ).join('');

    const datePresets = buildDatePresets();
    const dateBtns = datePresets.map((p) => {
      const iso = formatDate(p.date);
      return `<button type="button" class="gn-date-btn${p.label === 'now' ? ' gn-active' : ''}" data-date="${iso}" data-set-time="${p.setTime}">${p.label}</button>`;
    }).join('');

    const spentStr = timeInfo.spent > 0 ? formatHours(timeInfo.spent) : '0h';
    const estStr = formatHours(timeInfo.estimate);

    controls.innerHTML = `
      <div class="gn-edit-row gn-edit-info">
        <span class="gn-spent-info">${spentStr} / ${estStr}</span>
      </div>
      <div class="gn-timelogs" data-loading="true">
        <span class="gn-timelogs-loading">Loading timelogs…</span>
      </div>
      <div class="gn-edit-row">
        <span class="gn-edit-label">Log:</span>
        <div class="gn-preset-group">${spentBtns}<input type="text" class="gn-custom-input gn-custom-spent" placeholder="custom" /></div>
      </div>
      <div class="gn-edit-row">
        <span class="gn-edit-label">Date:</span>
        <div class="gn-preset-group">${dateBtns}</div>
        <input type="date" class="gn-date-picker" value="${selectedDate}" />
        <input type="time" class="gn-time-picker" value="${selectedTime}" />
      </div>
      <div class="gn-edit-row">
        <span class="gn-edit-label">Note:</span>
        <input type="text" class="gn-summary-input" placeholder="summary" />
        <button type="button" class="gn-submit-btn" disabled>Log</button>
      </div>
    `;

    const submitBtn = controls.querySelector<HTMLButtonElement>('.gn-submit-btn');
    const customSpentInput = controls.querySelector<HTMLInputElement>('.gn-custom-spent');
    if (!submitBtn) return;

    // Spent preset selection
    controls.querySelectorAll<HTMLButtonElement>('.gn-preset-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        controls
          .querySelectorAll('.gn-preset-btn')
          .forEach((b) => b.classList.remove('gn-selected'));
        btn.classList.add('gn-selected');
        if (customSpentInput) customSpentInput.value = '';
        selectedSpent = btn.dataset.value ?? null;
        submitBtn.disabled = false;
      });
    });

    // Custom spent input
    if (customSpentInput) {
      customSpentInput.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = customSpentInput.value.trim();
        if (val) {
          controls.querySelectorAll('.gn-preset-btn').forEach((b) => b.classList.remove('gn-selected'));
          selectedSpent = val;
          submitBtn.disabled = false;
        } else {
          selectedSpent = null;
          submitBtn.disabled = true;
        }
      });
      customSpentInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && selectedSpent) {
          e.preventDefault();
          submitBtn.click();
        }
      });
    }

    // Date & time pickers
    const datePicker = controls.querySelector<HTMLInputElement>('.gn-date-picker');
    const timePicker = controls.querySelector<HTMLInputElement>('.gn-time-picker');
    if (!datePicker || !timePicker) return;

    // Date preset selection
    controls.querySelectorAll<HTMLButtonElement>('.gn-date-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        controls.querySelectorAll('.gn-date-btn').forEach((b) => b.classList.remove('gn-active'));
        btn.classList.add('gn-active');
        selectedDate = btn.dataset.date ?? selectedDate;
        datePicker.value = selectedDate;
        if (btn.dataset.setTime === 'true') {
          const now = new Date();
          selectedTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        } else {
          selectedTime = '';
        }
        timePicker.value = selectedTime;
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
    timePicker.addEventListener('click', stopBubble);
    timePicker.addEventListener('mousedown', stopBubble);
    timePicker.addEventListener('focus', stopBubble);
    timePicker.addEventListener('keydown', (e) => e.stopPropagation());
    timePicker.addEventListener('change', (e) => {
      e.stopPropagation();
      selectedTime = timePicker.value;
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

      const spentAt = selectedTime ? `${selectedDate}T${selectedTime}:00` : selectedDate;
      const ok = await addTimeSpent(
        projectPath,
        extractIidFromCacheKey(iid),
        selectedSpent,
        summary,
        spentAt
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

    // Fetch and render timelogs
    this.loadTimelogs(controls, card, iid);
  }

  private async loadTimelogs(
    controls: HTMLElement,
    card: HTMLElement,
    iid: string
  ): Promise<void> {
    const container = controls.querySelector<HTMLElement>('.gn-timelogs');
    if (!container) return;

    const projectPath = extractProjectPath(card);
    if (!projectPath) {
      container.remove();
      return;
    }

    const timelogs = await fetchTimelogs(projectPath, extractIidFromCacheKey(iid));
    // Check controls are still in the DOM (user may have closed edit mode)
    if (!controls.isConnected) return;

    if (timelogs.length === 0) {
      container.innerHTML = '<span class="gn-timelogs-empty">No timelogs</span>';
      return;
    }

    // Sort by spentAt descending (most recent first)
    timelogs.sort((a, b) => new Date(b.spentAt).getTime() - new Date(a.spentAt).getTime());

    const rows = timelogs.map((t) => this.renderTimelogRow(t)).join('');
    container.innerHTML = `<div class="gn-timelogs-list">${rows}</div>`;
    container.removeAttribute('data-loading');
  }

  private renderTimelogRow(t: Timelog): string {
    const date = new Date(t.spentAt);
    const dateStr = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
    const hours = t.timeSpent / 3600;
    const duration = formatHours(hours);
    const user = t.user?.name ?? '';
    const summary = t.summary ? this.escapeHtml(t.summary) : '';

    return `<div class="gn-timelog-row">
      <span class="gn-timelog-date">${dateStr}</span>
      <span class="gn-timelog-duration">${duration}</span>
      <span class="gn-timelog-user">${this.escapeHtml(user)}</span>
      ${summary ? `<span class="gn-timelog-summary">${summary}</span>` : ''}
    </div>`;
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
