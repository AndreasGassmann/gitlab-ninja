/**
 * Board Recent Projects Feature
 * Injects recent-project quick-select buttons into the inline new-issue form
 * on group boards, where GitLab shows a project selector.
 *
 * Projects are seeded from existing board cards on first load, then kept
 * up-to-date via the gitlab-ninja-issue-created event.
 */

import { debounce, waitForElement } from '../utils/dom';
import { NEW_ISSUE_SELECTORS } from '../utils/constants';
import { debugLog } from '../utils/debug';

const STORAGE_KEY = 'boardRecentProjects';
const MAX_RECENT = 5;

export class BoardRecentProjectsFeature {
  private observer: MutationObserver | null = null;
  private eventNonce: string;
  private recentProjects: { path: string; name: string }[] = [];

  constructor(eventNonce: string) {
    this.eventNonce = eventNonce;
  }

  public async init(): Promise<void> {
    await this.loadRecentProjects();
    this.seedProjectsFromBoard();

    // Track projects used when issues are created via the board
    window.addEventListener('gitlab-ninja-issue-created', ((event: CustomEvent) => {
      if (event.detail?._nonce !== this.eventNonce) return;
      const { projectPath } = event.detail;
      if (projectPath) this.saveRecentProject(projectPath);
    }) as EventListener);

    const handleMutations = debounce(() => this.enhanceForms(), 150);

    waitForElement('.boards-list, [data-testid="boards-list"]').then((boardsList) => {
      if (boardsList) {
        this.observer = new MutationObserver(handleMutations);
        this.observer.observe(boardsList, { childList: true, subtree: true });
      }
    });

    debugLog('GitLab Ninja: BoardRecentProjects feature initialized');
  }

  private loadRecentProjects(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        this.recentProjects = result[STORAGE_KEY] || [];
        resolve();
      });
    });
  }

  /**
   * Seed the project list from issue cards already on the board.
   * This makes the feature useful on first load without needing a prior creation.
   */
  private seedProjectsFromBoard(): void {
    const links = document.querySelectorAll<HTMLAnchorElement>(
      '.board-card a[href*="/-/issues/"], [data-testid="board-card"] a[href*="/-/issues/"], ' +
        '.board-card-title a[href*="/-/issues/"]'
    );

    const storedPaths = new Set(this.recentProjects.map((p) => p.path));
    const seen = new Set<string>();

    links.forEach((link) => {
      const match = link.pathname.match(/^\/(.+?)\/-\/issues\/\d+/);
      if (!match) return;
      const path = match[1];
      if (storedPaths.has(path) || seen.has(path)) return;
      seen.add(path);
      const name = path.split('/').pop() || path;
      this.recentProjects.push({ path, name });
    });

    if (seen.size > 0) {
      this.recentProjects = this.recentProjects.slice(0, MAX_RECENT);
      chrome.storage.local.set({ [STORAGE_KEY]: this.recentProjects });
      debugLog(`GitLab Ninja: Seeded ${seen.size} project(s) from board cards`);
    }
  }

  private saveRecentProject(path: string): void {
    const name = path.split('/').pop() || path;
    this.recentProjects = [
      { path, name },
      ...this.recentProjects.filter((p) => p.path !== path),
    ].slice(0, MAX_RECENT);
    chrome.storage.local.set({ [STORAGE_KEY]: this.recentProjects });
    this.enhanceForms();
  }

  private enhanceForms(): void {
    if (this.recentProjects.length === 0) return;

    const forms = document.querySelectorAll<HTMLElement>(NEW_ISSUE_SELECTORS);
    forms.forEach((form) => this.addProjectButtons(form));

    // Fallback: board list inputs not caught by known selectors
    const inputs = document.querySelectorAll<HTMLElement>(
      '.board-list input[type="text"]:not(.gn-summary-input):not(.gn-custom-input):not(.gn-estimate-custom-input), ' +
        '[data-testid="board-list"] input[type="text"]:not(.gn-summary-input):not(.gn-custom-input):not(.gn-estimate-custom-input)'
    );
    inputs.forEach((input) => {
      // Skip inputs inside edit controls (editMode feature)
      if (input.closest('.gn-edit-controls')) return;

      const wrapper =
        input.closest('form, [class*="new-issue"], [class*="BoardNewIssue"], .board-card-create') ||
        input.parentElement;
      if (wrapper && !wrapper.querySelector('a[href*="/issues/"]')) {
        this.addProjectButtons(wrapper as HTMLElement);
      }
    });
  }

  private addProjectButtons(container: HTMLElement): void {
    if (container.querySelector('.gn-recent-projects')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'gn-recent-projects';

    this.recentProjects.forEach(({ path, name }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gn-recent-project-btn';
      btn.textContent = name;
      btn.title = path;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.selectProject(container, path, wrapper, btn);
      });

      for (const evt of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
        btn.addEventListener(evt, (e) => e.stopPropagation());
      }

      wrapper.appendChild(btn);
    });

    // Insert before the first input/textarea (same anchor as estimate picker)
    const firstInput = container.querySelector('input, textarea');
    if (firstInput) {
      firstInput.parentElement?.insertBefore(wrapper, firstInput);
    } else {
      container.insertBefore(wrapper, container.firstChild);
    }

    // Highlight button if a project is already selected in the native select
    const sel = container.querySelector<HTMLSelectElement>('select');
    if (sel) this.syncActiveButton(sel.value, wrapper);

    debugLog('GitLab Ninja: Added recent project buttons to board new-issue form');
  }

  /**
   * Try to select the project in whatever control GitLab uses.
   * Strategy 1: native <select> (older GitLab)
   * Strategy 2: click the dropdown toggle, then click the matching list item (newer GitLab)
   */
  private selectProject(
    container: HTMLElement,
    path: string,
    wrapper: HTMLElement,
    _btn: HTMLButtonElement
  ): void {
    // Strategy 1: native <select>
    const select = container.querySelector<HTMLSelectElement>('select');
    if (select) {
      const option = Array.from(select.options).find(
        (o) => o.value === path || o.value.endsWith(path) || path.endsWith(o.value)
      );
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.dispatchEvent(new Event('input', { bubbles: true }));
        this.syncActiveButton(path, wrapper);
        return;
      }
    }

    // Strategy 2: GitLab custom dropdown (GlCollapsibleListbox / GlNewDropdown)
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="project-select"] button, ' +
        '[data-testid="board-project-select"] button, ' +
        '.board-new-issue-project-dropdown button, ' +
        '.gl-new-dropdown-toggle'
    );
    if (!toggle) return;

    toggle.click();

    // After dropdown opens, find and click the matching item
    requestAnimationFrame(() => {
      setTimeout(() => {
        const projectName = path.split('/').pop()?.toLowerCase() || '';
        const items = document.querySelectorAll<HTMLElement>(
          '.gl-listbox-item, .gl-new-dropdown-item, [role="option"], .dropdown-item'
        );
        const match = Array.from(items).find((item) => {
          const text = item.textContent?.trim().toLowerCase() || '';
          const val = (item as HTMLElement).dataset.value || '';
          return (
            val === path ||
            val.endsWith(path) ||
            path.endsWith(val) ||
            text === projectName ||
            text.includes(projectName)
          );
        });

        if (match) {
          (match as HTMLElement).click();
          this.syncActiveButton(path, wrapper);
        } else {
          debugLog(`GitLab Ninja: No dropdown item found for project: ${path}`);
        }
      }, 150);
    });
  }

  private syncActiveButton(selectedPath: string, wrapper: HTMLElement): void {
    wrapper.querySelectorAll<HTMLButtonElement>('.gn-recent-project-btn').forEach((btn) => {
      const active =
        btn.title === selectedPath ||
        selectedPath.endsWith(btn.title) ||
        btn.title.endsWith(selectedPath);
      btn.classList.toggle('gn-active', active);
    });
  }

  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}
