/**
 * New Issue Estimate Feature
 * Adds estimate preset buttons to the inline new-issue form on boards.
 * When an issue is created, applies the selected estimate via REST API.
 */

import { debounce, waitForElement } from '../utils/dom';
import { setTimeEstimate } from '../utils/gitlabApi';
import { ESTIMATE_PRESETS, NEW_ISSUE_SELECTORS } from '../utils/constants';
import { debugLog, debugError } from '../utils/debug';

let pendingEstimate: string | null = null;

export class NewIssueEstimateFeature {
  private observer: MutationObserver | null = null;
  private eventNonce: string;

  constructor(eventNonce: string) {
    this.eventNonce = eventNonce;
  }

  public init(): void {
    const handleMutations = debounce(() => this.enhanceNewIssueForms(), 150);

    waitForElement('.boards-list, [data-testid="boards-list"]').then((boardsList) => {
      if (boardsList) {
        this.observer = new MutationObserver(handleMutations);
        this.observer.observe(boardsList, { childList: true, subtree: true });
      }
    });

    // Listen for issue creation events from injected script
    window.addEventListener('gitlab-ninja-issue-created', ((event: CustomEvent) => {
      if (event.detail?._nonce !== this.eventNonce) return;
      const { projectPath, iid } = event.detail;
      debugLog(
        `GitLab Ninja: Issue created event received: ${projectPath}#${iid}, pendingEstimate=${pendingEstimate}`
      );
      if (pendingEstimate && projectPath && iid) {
        debugLog(
          `GitLab Ninja: Applying pending estimate ${pendingEstimate} to ${projectPath}#${iid}`
        );
        this.applyEstimate(projectPath, iid, pendingEstimate);
        pendingEstimate = null;
      }
    }) as EventListener);

    debugLog('GitLab Ninja: NewIssueEstimate feature initialized');
  }

  private enhanceNewIssueForms(): void {
    // Strategy 1: Known selectors
    const forms = document.querySelectorAll<HTMLElement>(NEW_ISSUE_SELECTORS);
    forms.forEach((form) => this.addEstimateButtons(form));

    // Strategy 2: Find text inputs in board lists that look like issue creation
    const inputs = document.querySelectorAll<HTMLElement>(
      '.board-list input[type="text"]:not(.gn-summary-input):not(.gn-custom-input):not(.gn-estimate-custom-input), ' +
        '.board-list textarea, ' +
        '[data-testid="board-list"] input[type="text"]:not(.gn-summary-input):not(.gn-custom-input):not(.gn-estimate-custom-input), ' +
        '[data-testid="board-list"] textarea'
    );

    inputs.forEach((input) => {
      // Skip inputs inside edit controls (editMode feature)
      if (input.closest('.gn-edit-controls')) return;

      const wrapper =
        input.closest('form, [class*="new-issue"], [class*="BoardNewIssue"], .board-card-create') ||
        input.parentElement;

      if (wrapper && !wrapper.querySelector('.gn-estimate-picker')) {
        if (wrapper.querySelector('a[href*="/issues/"]')) return;
        this.addEstimateButtons(wrapper as HTMLElement);
      }
    });
  }

  private addEstimateButtons(container: HTMLElement): void {
    if (container.querySelector('.gn-estimate-picker')) return;

    const picker = document.createElement('div');
    picker.className = 'gn-estimate-picker';

    // Use compact subset for narrow board cards; custom input covers the rest
    const compactPresets = ESTIMATE_PRESETS.filter((p) => ['15m', '30m', '1h', '2h', '4h', '1d'].includes(p.value));
    const btns = compactPresets.map(
      (p) =>
        `<button type="button" class="gn-estimate-pick-btn" data-value="${p.value}">${p.label}</button>`
    ).join('');

    picker.innerHTML = `
      <div class="gn-estimate-picker-row">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink:0;opacity:0.5">
          <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm0 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM8 3a.75.75 0 0 1 .75.75v3.69l2.28 2.28a.75.75 0 1 1-1.06 1.06l-2.5-2.5A.75.75 0 0 1 7.25 8V3.75A.75.75 0 0 1 8 3z"/>
        </svg>
        <span class="gn-estimate-pick-label">Est:</span>
        ${btns}
        <input type="text" class="gn-estimate-pick-btn gn-estimate-custom-input" placeholder="custom" style="width:45px;text-align:center;outline:none" />
      </div>
    `;

    // Custom input handler
    const customInput = picker.querySelector<HTMLInputElement>('.gn-estimate-custom-input');
    if (customInput) {
      customInput.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = customInput.value.trim();
        picker.querySelectorAll('.gn-estimate-pick-btn:not(.gn-estimate-custom-input)').forEach((b) => b.classList.remove('gn-selected'));
        pendingEstimate = val || null;
      });
      customInput.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    }

    // Event handlers
    picker.querySelectorAll<HTMLButtonElement>('.gn-estimate-pick-btn:not(.gn-estimate-custom-input)').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const wasSelected = btn.classList.contains('gn-selected');
        picker
          .querySelectorAll('.gn-estimate-pick-btn:not(.gn-estimate-custom-input)')
          .forEach((b) => b.classList.remove('gn-selected'));
        if (customInput) customInput.value = '';

        if (wasSelected) {
          pendingEstimate = null;
        } else {
          btn.classList.add('gn-selected');
          pendingEstimate = btn.dataset.value ?? null;
        }

        debugLog(`GitLab Ninja: Pending estimate = ${pendingEstimate}`);
      });

      // Block bubbling so GitLab doesn't interpret clicks
      for (const evt of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
        btn.addEventListener(evt, (e) => e.stopPropagation());
      }
    });

    // Insert after the assign indicator if present, otherwise before first input
    const assignIndicator = container.querySelector('.gn-assign-indicator');
    if (assignIndicator) {
      assignIndicator.after(picker);
    } else {
      const firstInput = container.querySelector('input, textarea');
      if (firstInput) {
        firstInput.parentElement?.insertBefore(picker, firstInput);
      } else {
        container.insertBefore(picker, container.firstChild);
      }
    }

    debugLog('GitLab Ninja: Added estimate picker to new issue form');
  }

  private async applyEstimate(projectPath: string, iid: string, estimate: string): Promise<void> {
    const ok = await setTimeEstimate(projectPath, iid, estimate);
    if (ok) {
      debugLog(`GitLab Ninja: Successfully set estimate ${estimate} on new issue #${iid}`);
    } else {
      debugError(`GitLab Ninja: Failed to set estimate on #${iid}`);
    }
  }

  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}
