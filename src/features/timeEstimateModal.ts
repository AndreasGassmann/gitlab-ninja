/**
 * Time Estimate Modal Enhancement
 * Adds quick action buttons to GitLab's time estimate modal
 */

import { debugLog, debugWarn } from '../utils/debug';
import { ESTIMATE_PRESETS, SPENT_PRESETS } from '../utils/constants';

export class TimeEstimateModalFeature {
  private observer: MutationObserver | null = null;

  /**
   * Initialize the feature
   */
  public init(): void {
    debugLog('GitLab Ninja: TimeEstimateModal - Initializing...');
    this.watchForModal();
  }

  /**
   * Watch for the time estimate modal to appear
   */
  private watchForModal(): void {
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            // Check if this is the time estimate modal
            const estimateModal =
              node.querySelector('[id*="set-time-estimate-modal"]') ||
              (node.id && node.id.includes('set-time-estimate-modal') ? node : null);

            if (estimateModal) {
              debugLog('GitLab Ninja: Time estimate modal detected');
              this.enhanceEstimateModal(estimateModal as HTMLElement);
            }

            // Check if this is the time log modal (Add time entry)
            const timelogModal =
              node.querySelector('[id*="create-timelog-modal"]') ||
              (node.id && node.id.includes('create-timelog-modal') ? node : null);

            if (timelogModal) {
              debugLog('GitLab Ninja: Time log modal detected');
              this.enhanceTimelogModal(timelogModal as HTMLElement);
            }
          }
        });
      });
    });

    // Watch the entire document for modal additions
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    debugLog('GitLab Ninja: TimeEstimateModal - Watching for modals');
  }

  /**
   * Add quick estimate buttons to the time estimate modal
   */
  private enhanceEstimateModal(modal: HTMLElement): void {
    // Check if already enhanced
    if (modal.querySelector('.gitlab-ninja-quick-estimates')) {
      debugLog('GitLab Ninja: Modal already enhanced');
      return;
    }

    // Find the input field
    const input = modal.querySelector<HTMLInputElement>('#time-estimate');
    if (!input) {
      debugWarn('GitLab Ninja: Could not find time estimate input');
      return;
    }

    // Find the form group to insert buttons after the input
    const formGroup = input.closest('.form-group');
    if (!formGroup) {
      debugWarn('GitLab Ninja: Could not find form group');
      return;
    }

    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'gitlab-ninja-quick-estimates';

    this.buildQuickButtons(buttonContainer, ESTIMATE_PRESETS, input, formGroup, 'estimate');

    debugLog('GitLab Ninja: ✅ Added quick estimate buttons to estimate modal');
  }

  /**
   * Add quick estimate buttons to the time log modal (Add time entry)
   */
  private enhanceTimelogModal(modal: HTMLElement): void {
    // Check if already enhanced
    if (modal.querySelector('.gitlab-ninja-quick-estimates')) {
      debugLog('GitLab Ninja: Time log modal already enhanced');
      return;
    }

    // Find the input field
    const input = modal.querySelector<HTMLInputElement>('#time-spent');
    if (!input) {
      debugWarn('GitLab Ninja: Could not find time-spent input');
      return;
    }

    // Find the form group to insert buttons after the input
    const formGroup = input.closest('.form-group');
    if (!formGroup) {
      debugWarn('GitLab Ninja: Could not find form group');
      return;
    }

    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'gitlab-ninja-quick-estimates';

    this.buildQuickButtons(buttonContainer, SPENT_PRESETS, input, formGroup, 'timelog');

    debugLog('GitLab Ninja: ✅ Added quick time buttons to time log modal');

    // Also add date shortcut buttons to "Spent at" field
    this.addDateShortcuts(modal);
  }

  private buildQuickButtons(
    container: HTMLElement,
    presets: { label: string; value: string }[],
    input: HTMLInputElement,
    formGroup: Element,
    context: string
  ): void {
    const mid = Math.ceil(presets.length / 2);
    const row1 = presets.slice(0, mid);
    const row2 = presets.slice(mid);
    const renderRow = (items: typeof presets) => items.map(
      (btn) => `<button type="button" class="gitlab-ninja-estimate-quick-btn" data-value="${btn.value}">${btn.label}</button>`
    ).join('');

    container.innerHTML = `
      <div>
        <div>${renderRow(row1)}</div>
        <div style="margin-top:6px">${renderRow(row2)}</div>
      </div>
    `;

    const helpText = formGroup.querySelector('small');
    if (helpText) {
      helpText.parentNode?.insertBefore(container, helpText);
    } else {
      formGroup.appendChild(container);
    }

    container
      .querySelectorAll<HTMLButtonElement>('.gitlab-ninja-estimate-quick-btn')
      .forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const value = btn.dataset.value || '';
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.focus();
          debugLog(`GitLab Ninja: Set ${context} to ${value}`);
        });
      });
  }

  /**
   * Add date shortcut buttons to the "Spent at" field
   */
  private addDateShortcuts(modal: HTMLElement): void {
    // Find the "Spent at" input field
    const dateInput = modal.querySelector<HTMLInputElement>('[data-testid="gl-datepicker-input"]');
    if (!dateInput) {
      debugWarn('GitLab Ninja: Could not find spent-at date input');
      return;
    }

    // Find the datepicker container
    const datepickerContainer = dateInput.closest('.gl-datepicker');
    if (!datepickerContainer) {
      debugWarn('GitLab Ninja: Could not find datepicker container');
      return;
    }

    // Check if already added
    if (datepickerContainer.querySelector('.gitlab-ninja-date-shortcuts')) {
      return;
    }

    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'gitlab-ninja-date-shortcuts';

    const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

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

    const now = new Date();
    const m1 = workdayOffset(now, -1);
    const m2 = workdayOffset(now, -2);
    const buttons = [
      { label: 'Today', date: now },
      { label: `-1 ${DAY_ABBR[m1.getDay()]}`, date: m1 },
      { label: `-2 ${DAY_ABBR[m2.getDay()]}`, date: m2 },
    ];

    buttonContainer.innerHTML = `
      <div>
        <div>
          ${buttons
            .map((btn) => {
              const y = btn.date.getFullYear();
              const m = String(btn.date.getMonth() + 1).padStart(2, '0');
              const d = String(btn.date.getDate()).padStart(2, '0');
              return `
            <button type="button"
                    class="gitlab-ninja-date-btn"
                    data-date="${y}-${m}-${d}">
              ${btn.label}
            </button>
          `;
            })
            .join('')}
        </div>
      </div>
    `;

    // Insert after the datepicker
    datepickerContainer.appendChild(buttonContainer);

    // Add click handlers
    buttonContainer.querySelectorAll<HTMLButtonElement>('.gitlab-ninja-date-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const formattedDate = btn.dataset.date || '';

        dateInput.value = formattedDate;

        // Trigger input event so Vue/React picks up the change
        dateInput.dispatchEvent(new Event('input', { bubbles: true }));
        dateInput.dispatchEvent(new Event('change', { bubbles: true }));

        // Focus the input
        dateInput.focus();

        debugLog(`GitLab Ninja: Set spent-at date to ${formattedDate}`);
      });
    });

    debugLog('GitLab Ninja: ✅ Added date shortcut buttons to spent-at field');
  }

  /**
   * Clean up
   */
  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
  }
}
