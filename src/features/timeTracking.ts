/**
 * Time tracking display feature
 * Shows time tracking information on issue cards with 5-state color coding
 */

import { TimeInfo } from '../types';
import { parseTimeToHours, formatHours } from '../utils/time';
import { extractIssueCacheKey, getCachedTimeTracking } from '../utils/api';

/** Status states for card color coding */
type CardStatus = 'unestimated' | 'ready' | 'active' | 'warning' | 'over';

const STATUS_CLASSES = [
  'gn-status-unestimated',
  'gn-status-ready',
  'gn-status-active',
  'gn-status-warning',
  'gn-status-over',
] as const;

export class TimeTrackingFeature {
  public enhanceCards(): void {
    const issueCards = document.querySelectorAll<HTMLElement>('.board-card');

    issueCards.forEach((card) => {
      if (!card.classList.contains('gitlab-ninja-time-enhanced')) {
        card.classList.add('gitlab-ninja-time-enhanced');
      }
      const timeTracking = this.extractTimeTracking(card);
      this.addTimeTrackingDisplay(card, timeTracking);
    });
  }

  private extractTimeTracking(card: HTMLElement): TimeInfo {
    const cacheKey = extractIssueCacheKey(card);
    if (cacheKey) {
      const cachedData = getCachedTimeTracking(cacheKey);
      if (cachedData) return cachedData;
    }

    const timeInfo: TimeInfo = { spent: 0, estimate: 0 };

    const timeTrackingEl = card.querySelector(
      '.board-card-info time.board-card-info-text, ' +
        '.issue-time-estimate, .time-tracking, [data-testid="time-tracking"]'
    );

    if (timeTrackingEl) {
      const text = timeTrackingEl.textContent || '';
      const timeMatch = text.match(/(\d+(?:\.\d+)?)\s*([hdmw])/i);
      if (timeMatch) {
        const timeValue = timeMatch[0];
        const slashMatch = text.match(/(\d+[hdmw])\s*\/\s*(\d+[hdmw])/);
        if (slashMatch) {
          timeInfo.spent = parseTimeToHours(slashMatch[1]);
          timeInfo.estimate = parseTimeToHours(slashMatch[2]);
        } else {
          timeInfo.estimate = parseTimeToHours(timeValue);
        }
      }
    }

    return timeInfo;
  }

  /**
   * Determine the 5-state status of a card:
   *   unestimated: no estimate set
   *   ready:       estimated but nothing tracked yet
   *   active:      in progress, <=80% of budget used
   *   warning:     in progress, >80% of budget used
   *   over:        spent exceeds estimate
   */
  private getStatus(t: TimeInfo): CardStatus {
    if (t.estimate === 0 && t.spent > 0) return 'over';
    if (t.estimate === 0) return 'unestimated';
    if (t.spent === 0) return 'ready';
    if (t.spent > t.estimate) return 'over';
    if (t.spent < t.estimate && t.spent / t.estimate > 0.8) return 'warning';
    return 'active';
  }

  private addTimeTrackingDisplay(card: HTMLElement, timeInfo: TimeInfo): void {
    // Remove old classes (both legacy and new)
    card.classList.remove(
      'gitlab-ninja-no-estimate',
      'gitlab-ninja-under-estimate',
      'gitlab-ninja-over-estimate',
      'gitlab-ninja-not-started',
      ...STATUS_CLASSES,
      'gn-effort-s',
      'gn-effort-m',
      'gn-effort-l',
      'gn-effort-xl'
    );

    const status = this.getStatus(timeInfo);
    card.classList.add(`gn-status-${status}`);

    if (timeInfo.estimate > 0) {
      card.classList.add(`gn-effort-${this.getEffortTier(timeInfo.estimate)}`);
    }

    // Set vertical progress on the left border
    if (timeInfo.estimate > 0 && timeInfo.spent > 0) {
      const pct = Math.min(Math.round((timeInfo.spent / timeInfo.estimate) * 100), 100);
      card.style.setProperty('--gn-pct', `${pct}%`);
    } else {
      card.style.removeProperty('--gn-pct');
    }

    // Build the time chip
    if (timeInfo.estimate > 0 || timeInfo.spent > 0) {
      let timeDisplay: string;
      if (timeInfo.estimate === 0 && timeInfo.spent > 0) {
        timeDisplay = `${formatHours(timeInfo.spent)} / ?`;
      } else if (timeInfo.spent === 0) {
        timeDisplay = formatHours(timeInfo.estimate);
      } else if (timeInfo.spent === timeInfo.estimate) {
        timeDisplay = `${formatHours(timeInfo.estimate)} \u2713`;
      } else {
        timeDisplay = `${formatHours(timeInfo.spent)} / ${formatHours(timeInfo.estimate)}`;
      }

      const chipHTML = this.buildChipHTML(timeDisplay, status);

      const existingReplacement = card.querySelector<HTMLElement>('.gitlab-ninja-time-replacement');
      if (existingReplacement) {
        existingReplacement.innerHTML = chipHTML;
      } else {
        const hourglassTime = card.querySelector<HTMLElement>(
          '.board-card-info time.board-card-info-text'
        );
        const hourglassContainer = hourglassTime?.closest<HTMLElement>('.board-card-info');
        if (hourglassContainer && hourglassTime) {
          const wrapper = document.createElement('span');
          wrapper.className = 'board-card-info gl-mr-3 gitlab-ninja-time-replacement';
          wrapper.innerHTML = chipHTML;
          hourglassContainer.replaceWith(wrapper);
        }
      }
    }
  }

  private getEffortTier(estimate: number): 's' | 'm' | 'l' | 'xl' {
    if (estimate <= 2) return 's';
    if (estimate <= 4) return 'm';
    if (estimate <= 8) return 'l';
    return 'xl'; // >1d — too large, should be split
  }

  private buildChipHTML(timeText: string, status: CardStatus): string {
    return `
      <span class="gn-time-chip gn-chip-${status}">
        <span class="gn-dot"></span>
        ${timeText}
      </span>`;
  }
}
