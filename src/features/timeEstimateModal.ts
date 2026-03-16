/**
 * Time Estimate Modal Enhancement
 * Adds quick action buttons to GitLab's time estimate modal
 */

import { debugLog, debugWarn } from '../utils/debug';

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

    const buttons = [
      { label: '30min', value: '30m' },
      { label: '1h', value: '1h' },
      { label: '2h', value: '2h' },
      { label: '3h', value: '3h' },
      { label: '4h', value: '4h' },
      { label: '1d', value: '1d' },
    ];

    buttonContainer.innerHTML = `
      <div>
        <div>
          ${buttons
            .map(
              (btn) => `
            <button type="button"
                    class="gitlab-ninja-estimate-quick-btn"
                    data-value="${btn.value}">
              ${btn.label}
            </button>
          `
            )
            .join('')}
        </div>
      </div>
    `;

    // Insert after the input field but before the help text
    const helpText = formGroup.querySelector('small');
    if (helpText) {
      helpText.parentNode?.insertBefore(buttonContainer, helpText);
    } else {
      formGroup.appendChild(buttonContainer);
    }

    // Add click handlers
    buttonContainer
      .querySelectorAll<HTMLButtonElement>('.gitlab-ninja-estimate-quick-btn')
      .forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          const value = btn.dataset.value || '';
          input.value = value;

          // Trigger input event so Vue/React picks up the change
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));

          // Focus the input
          input.focus();

          debugLog(`GitLab Ninja: Set time estimate to ${value}`);
        });
      });

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

    const buttons = [
      { label: '30min', value: '30m' },
      { label: '1h', value: '1h' },
      { label: '2h', value: '2h' },
      { label: '3h', value: '3h' },
      { label: '4h', value: '4h' },
      { label: '1d', value: '1d' },
    ];

    buttonContainer.innerHTML = `
      <div>
        <div>
          ${buttons
            .map(
              (btn) => `
            <button type="button"
                    class="gitlab-ninja-estimate-quick-btn"
                    data-value="${btn.value}">
              ${btn.label}
            </button>
          `
            )
            .join('')}
        </div>
      </div>
    `;

    // Insert after the input field but before the help text
    const helpText = formGroup.querySelector('small');
    if (helpText) {
      helpText.parentNode?.insertBefore(buttonContainer, helpText);
    } else {
      formGroup.appendChild(buttonContainer);
    }

    // Add click handlers
    buttonContainer
      .querySelectorAll<HTMLButtonElement>('.gitlab-ninja-estimate-quick-btn')
      .forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          const value = btn.dataset.value || '';
          input.value = value;

          // Trigger input event so Vue/React picks up the change
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));

          // Focus the input
          input.focus();

          debugLog(`GitLab Ninja: Set time spent to ${value}`);
        });
      });

    debugLog('GitLab Ninja: ✅ Added quick time buttons to time log modal');

    // Also add date shortcut buttons to "Spent at" field
    this.addDateShortcuts(modal);
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

    const buttons = [
      { label: 'Today', days: 0 },
      { label: '-1', days: -1 },
      { label: '-2', days: -2 },
    ];

    buttonContainer.innerHTML = `
      <div>
        <div>
          ${buttons
            .map(
              (btn) => `
            <button type="button"
                    class="gitlab-ninja-date-btn"
                    data-days="${btn.days}">
              ${btn.label}
            </button>
          `
            )
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

        const daysOffset = parseInt(btn.dataset.days || '0', 10);
        const date = new Date();
        date.setDate(date.getDate() + daysOffset);

        // Format as YYYY-MM-DD
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const formattedDate = `${year}-${month}-${day}`;

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
