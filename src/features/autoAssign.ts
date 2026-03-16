/**
 * Auto-assignment feature
 *
 * Two-pronged approach:
 * 1. The injected script intercepts the GraphQL mutation for creating board issues
 *    and adds the current user as assignee before the request is sent.
 * 2. This content script watches for the new-issue form/card to appear and adds
 *    a visible "Assign to: <username>" indicator so the user sees it will be assigned.
 */

import { debounce, waitForElement } from '../utils/dom';
import { NEW_ISSUE_SELECTORS } from '../utils/constants';
import { debugLog } from '../utils/debug';

export class AutoAssignFeature {
  private observer: MutationObserver | null = null;
  private enabled = true;
  private username: string | null = null;
  private eventNonce: string;

  constructor(_currentUser: unknown, _debounceDelay: number, eventNonce: string) {
    this.eventNonce = eventNonce;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    debugLog(`GitLab Ninja: Auto-assign ${enabled ? 'enabled' : 'disabled'}`);
    window.dispatchEvent(
      new CustomEvent('gitlab-ninja-set-auto-assign', {
        detail: { enabled, _nonce: this.eventNonce },
      })
    );
  }

  public init(): void {
    debugLog('GitLab Ninja: Setting up auto-assign (intercept-based)...');

    this.username = this.getUsername();

    // Send initial state to injected script
    window.dispatchEvent(
      new CustomEvent('gitlab-ninja-set-auto-assign', {
        detail: { enabled: this.enabled, _nonce: this.eventNonce },
      })
    );

    // Watch the entire board area + body for new-issue forms
    const handleMutations = debounce(() => {
      if (!this.enabled) return;
      this.enhanceNewIssueForms();
    }, 150);

    // Observe the boards list
    waitForElement('.boards-list, [data-testid="boards-list"]').then((boardLists) => {
      if (boardLists) {
        this.observer = new MutationObserver(handleMutations);
        this.observer.observe(boardLists, { childList: true, subtree: true });
      }
    });

    debugLog('GitLab Ninja: Auto-assign observer active');
  }

  private enhanceNewIssueForms(): void {
    if (!this.username) {
      this.username = this.getUsername();
      if (!this.username) return;
    }

    // Strategy 1: Try specific selectors
    const forms = document.querySelectorAll<HTMLElement>(NEW_ISSUE_SELECTORS);
    forms.forEach((form) => this.addIndicator(form));

    // Strategy 2: Find any textarea/input inside a board column that looks like
    // an issue creation field (not a regular card). These typically appear as
    // siblings of the card list or at the end of a column.
    const inputs = document.querySelectorAll<HTMLElement>(
      '.board-list input[type="text"]:not(.gn-summary-input), ' +
        '.board-list textarea, ' +
        '[data-testid="board-list"] input[type="text"]:not(.gn-summary-input), ' +
        '[data-testid="board-list"] textarea'
    );

    inputs.forEach((input) => {
      // Walk up to find the form/wrapper card
      const wrapper =
        input.closest('form, [class*="new-issue"], [class*="BoardNewIssue"], .board-card-create') ||
        input.parentElement;

      if (wrapper && !wrapper.querySelector('.gn-assign-indicator')) {
        // Make sure this isn't a regular board card (those have issue links)
        if (wrapper.querySelector('a[href*="/issues/"]')) return;
        this.addIndicator(wrapper as HTMLElement);
      }
    });
  }

  private addIndicator(container: HTMLElement): void {
    if (container.querySelector('.gn-assign-indicator')) return;

    const indicator = document.createElement('div');
    indicator.className = 'gn-assign-indicator';
    indicator.innerHTML = `
      <span class="gn-assign-badge">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: -2px; margin-right: 3px;">
          <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1c-3.3 0-6 1.3-6 3v1h12v-1c0-1.7-2.7-3-6-3z"/>
        </svg>
        Assign to: <strong>${this.username}</strong>
      </span>
    `;

    // Insert before the first input or at the top
    const firstInput = container.querySelector('input, textarea');
    if (firstInput) {
      firstInput.parentElement?.insertBefore(indicator, firstInput);
    } else {
      container.insertBefore(indicator, container.firstChild);
    }

    debugLog('GitLab Ninja: Added assignee indicator to new issue card');
  }

  private getUsername(): string | null {
    // Method 1: URL parameter (board filtered by assignee — most reliable on board pages)
    const urlParams = new URLSearchParams(window.location.search);
    const assignee = urlParams.get('assignee_username');
    if (assignee) return assignee;

    // Method 2: meta tag
    const meta = document.querySelector<HTMLMetaElement>('meta[name="user-username"]');
    if (meta?.content) return meta.content;

    // Method 3: user avatar
    const userMenu = document.querySelector<HTMLElement>(
      '[data-testid="user-menu"] img, .header-user-avatar img'
    );
    if (userMenu) {
      const alt = userMenu.getAttribute('alt') || userMenu.getAttribute('data-username');
      if (alt) return alt.replace('@', '');
    }

    return null;
  }

  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}
