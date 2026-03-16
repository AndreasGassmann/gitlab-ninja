/**
 * Column summary feature
 * Displays total time tracking for each board column with a progress bar
 */

import { TimeInfo } from '../types';
import { parseTimeToHours, formatHours } from '../utils/time';
import { extractIssueCacheKey, getCachedTimeTracking } from '../utils/api';

export class ColumnSummaryFeature {
  public updateSummaries(): void {
    const columns = document.querySelectorAll<HTMLElement>('.board, [data-testid="board-list"]');

    columns.forEach((column) => this.updateColumnSummary(column));
  }

  private updateColumnSummary(column: HTMLElement): void {
    const cards = column.querySelectorAll<HTMLElement>('.board-card');
    let totalSpent = 0;
    let totalEstimate = 0;

    cards.forEach((card) => {
      const t = this.extractTimeTracking(card);
      totalSpent += t.spent;
      totalEstimate += t.estimate;
    });

    if (totalEstimate === 0 && totalSpent === 0) {
      // Remove stale summary if column has no data
      column.querySelector('.gn-col-summary')?.remove();
      return;
    }

    const pct = totalEstimate > 0 ? Math.round((totalSpent / totalEstimate) * 100) : 0;

    const summaryText = `${formatHours(totalSpent)} / ${formatHours(totalEstimate)}`;
    const isOver = totalSpent > totalEstimate && totalEstimate > 0;
    const isWarning = !isOver && pct > 80;

    // Skip update if text hasn't changed
    const existing = column.querySelector<HTMLElement>('.gn-col-summary');
    if (existing?.dataset.gnSummary === summaryText) return;

    // Remove old and new summary elements
    existing?.remove();
    column.querySelector('.gitlab-ninja-column-summary')?.remove();

    // Determine color classes
    let fillColor: string;
    let pctClass: string;
    if (isOver) {
      fillColor = 'var(--gn-over)';
      pctClass = 'gn-pct-over';
    } else if (isWarning) {
      fillColor = 'var(--gn-warning)';
      pctClass = 'gn-pct-warning';
    } else {
      fillColor = 'var(--gn-active)';
      pctClass = 'gn-pct-ok';
    }

    const barWidth = Math.min(pct, 100);

    const summary = document.createElement('div');
    summary.className = 'gn-col-summary';
    summary.dataset.gnSummary = summaryText;
    summary.innerHTML = `
      <span class="gn-col-summary-time">${summaryText}</span>
      <div class="gn-col-progress">
        <div class="gn-col-progress-fill" style="width:${barWidth}%;background:${fillColor}"></div>
      </div>
      <span class="gn-col-pct ${pctClass}">${pct}%</span>
    `;

    const columnHeader = column.querySelector('.board-header, [data-testid="board-list-header"]');
    if (columnHeader) {
      columnHeader.appendChild(summary);
    }
  }

  private extractTimeTracking(card: HTMLElement): TimeInfo {
    const iid = extractIssueCacheKey(card);
    if (iid) {
      const cachedData = getCachedTimeTracking(iid);
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
}
