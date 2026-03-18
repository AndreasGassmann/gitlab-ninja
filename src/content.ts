/**
 * GitLab Ninja - Main Content Script
 * Enhances GitLab boards with auto-assignment, time tracking, and quick estimates
 */

import { ExtensionConfig } from './types';
import { debounce, waitForElement } from './utils/dom';
import { cacheTimeTracking } from './utils/api';
import { ensureTimeTrackingData } from './utils/apiFallback';
import { AutoAssignFeature } from './features/autoAssign';
import { TimeTrackingFeature } from './features/timeTracking';
import { ColumnSummaryFeature } from './features/columnSummary';
import { TimeEstimateModalFeature } from './features/timeEstimateModal';
import { BoardSettingsFeature } from './features/boardSettings';
import { EditModeFeature } from './features/editMode';
import { NewIssueEstimateFeature } from './features/newIssueEstimate';
import { BoardRecentProjectsFeature } from './features/boardRecentProjects';
import {
  loadCustomColors,
  applyColorOverrides,
  loadThemeMode,
  ThemeMode,
} from './utils/themeManager';
import { debugLog, debugWarn } from './utils/debug';

// Generate a nonce to authenticate custom events between content and injected scripts
const eventNonce = crypto.randomUUID();

// Pass the nonce to the page context via a hidden DOM element
const nonceEl = document.createElement('meta');
nonceEl.setAttribute('name', 'gitlab-ninja-nonce');
nonceEl.setAttribute('content', eventNonce);
(document.head || document.documentElement).appendChild(nonceEl);

// Inject script into page context to intercept fetch/XHR
// On gitlab.com, use the web-accessible resource (script tag injection).
// On self-hosted domains, the background script registers injected.js with world:"MAIN".
if (window.location.hostname === 'gitlab.com') {
  debugLog('GitLab Ninja: Injecting interceptor into page context...');
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = function () {
    debugLog('GitLab Ninja: Injected script loaded');
    (this as HTMLScriptElement).remove();
  };
  (document.head || document.documentElement).appendChild(script);
} else {
  debugLog('GitLab Ninja: Interceptor registered via world:MAIN for this domain');
}

// Apply custom colors early so they're ready before board renders
loadCustomColors().then(applyColorOverrides);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.customColors?.newValue) {
    applyColorOverrides(changes.customColors.newValue);
  }
});

// Detect GitLab theme and store it for the options page to sync with
function detectAndStoreGitlabTheme() {
  const isDark =
    (document.body?.classList.contains('gl-dark') ?? false) ||
    document.documentElement.classList.contains('gl-dark');
  chrome.storage.sync.set({ gitlabTheme: isDark ? 'dark' : 'light' });
}
// Run on load and watch for changes (GitLab can toggle theme dynamically)
if (document.body) {
  detectAndStoreGitlabTheme();
} else {
  document.addEventListener('DOMContentLoaded', detectAndStoreGitlabTheme);
}
new MutationObserver(detectAndStoreGitlabTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class'],
});
if (document.body) {
  new MutationObserver(detectAndStoreGitlabTheme).observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

// Apply forced theme mode to injected content
function applyInjectedThemeMode(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === 'light') {
    root.classList.add('gn-force-light');
    root.classList.remove('gn-force-dark');
  } else if (mode === 'dark') {
    root.classList.remove('gn-force-light');
    root.classList.add('gn-force-dark');
  } else {
    // Auto: follow GitLab's own theme
    root.classList.remove('gn-force-light', 'gn-force-dark');
  }
}
loadThemeMode().then(applyInjectedThemeMode);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.themeMode?.newValue) applyInjectedThemeMode(changes.themeMode.newValue);
});

// Global reference to ninja instance for event handler
let ninjaInstance: GitLabNinja | null = null;

// Listen for time tracking data from injected script
window.addEventListener('gitlab-ninja-data', ((event: CustomEvent) => {
  if (event.detail?._nonce !== eventNonce) return; // ignore unauthenticated events
  debugLog('GitLab Ninja: Received time tracking data from page context');
  const data = event.detail.timeTrackingData;

  // Cache the data
  let count = 0;
  Object.keys(data).forEach((iid) => {
    const timeInfo = data[iid];
    cacheTimeTracking(iid, timeInfo);
    count++;
    if (count <= 3) {
      debugLog(`GitLab Ninja: Caching #${iid}: ${timeInfo.spent}h / ${timeInfo.estimate}h`);
    }
  });

  debugLog(`GitLab Ninja: Cached ${count} issues from injected script`);

  // Trigger UI update if ninja is initialized
  if (ninjaInstance) {
    debugLog('GitLab Ninja: Triggering UI update with fresh data');
    (ninjaInstance as any).enhanceAllFeatures();
  }
}) as EventListener);

class GitLabNinja {
  private config: ExtensionConfig = {
    checkInterval: 1000,
    debounceDelay: 300,
  };

  private autoAssignFeature: AutoAssignFeature | null = null;
  private timeTrackingFeature: TimeTrackingFeature;
  private columnSummaryFeature: ColumnSummaryFeature;
  private timeEstimateModalFeature: TimeEstimateModalFeature;
  private boardSettingsFeature: BoardSettingsFeature;
  private editModeFeature: EditModeFeature;
  private newIssueEstimateFeature: NewIssueEstimateFeature;
  private boardRecentProjectsFeature: BoardRecentProjectsFeature;
  private mainObserver: MutationObserver | null = null;
  private refreshInterval: number | null = null;

  constructor() {
    debugLog('GitLab Ninja: Initializing...');
    this.timeTrackingFeature = new TimeTrackingFeature();
    this.columnSummaryFeature = new ColumnSummaryFeature();
    this.timeEstimateModalFeature = new TimeEstimateModalFeature();
    this.editModeFeature = new EditModeFeature();
    this.editModeFeature.setOnRefresh(() => this.enhanceAllFeatures());
    this.newIssueEstimateFeature = new NewIssueEstimateFeature(eventNonce);
    this.boardRecentProjectsFeature = new BoardRecentProjectsFeature(eventNonce);
    this.boardSettingsFeature = new BoardSettingsFeature((settings) => {
      // Toggle auto-assign
      if (this.autoAssignFeature) {
        this.autoAssignFeature.setEnabled(settings.autoAssign);
      }
    });
  }

  /**
   * Initialize the extension
   */
  public async init(): Promise<void> {
    debugLog('GitLab Ninja: Starting initialization...');
    this.startEnhancements();
  }

  /**
   * Start all enhancement features
   */
  private startEnhancements(): void {
    debugLog('GitLab Ninja: Starting enhancements...');

    // Initialize auto-assign feature (uses API, no need for user detection)
    this.autoAssignFeature = new AutoAssignFeature(null, this.config.debounceDelay, eventNonce);
    this.autoAssignFeature.init();

    // Initialize time estimate modal feature
    this.timeEstimateModalFeature.init();

    // Initialize board settings toolbar
    this.boardSettingsFeature.init();

    // Initialize new issue estimate feature
    this.newIssueEstimateFeature.init();

    // Initialize board recent projects feature
    this.boardRecentProjectsFeature.init();

    // Initial enhancement pass
    this.enhanceAllFeatures();

    // Fallback: If injected script didn't catch time tracking data, fetch manually
    setTimeout(() => {
      ensureTimeTrackingData(() => {
        debugLog('GitLab Ninja: Fallback fetch complete, re-enhancing...');
        this.enhanceAllFeatures();
      });
    }, 3000); // Wait 3 seconds to give injected script a chance

    // Watch for changes and re-enhance
    this.setupMainObserver();

    // Periodic refresh (less frequent, mainly to catch API data updates)
    this.refreshInterval = setInterval(() => {
      this.enhanceAllFeatures();
    }, 10000); // Every 10 seconds to update when API data arrives

    debugLog('GitLab Ninja: All features initialized');
  }

  /**
   * Run all enhancement features
   */
  private enhanceAllFeatures(): void {
    this.timeTrackingFeature.enhanceCards();
    this.columnSummaryFeature.updateSummaries();
    this.editModeFeature.enhanceCards();
  }

  /**
   * Set up mutation observer for the board
   */
  private async setupMainObserver(): Promise<void> {
    const handleMutations = debounce((mutations: MutationRecord[]) => {
      // Ignore mutations that are only our own enhancements
      const isRelevantMutation = mutations.some((mutation) => {
        // Check if any added nodes are board cards or board lists
        if (mutation.addedNodes.length > 0) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (node instanceof HTMLElement) {
              // Ignore our own injected elements
              if (
                node.classList.contains('gitlab-ninja-time-replacement') ||
                node.classList.contains('gitlab-ninja-column-summary') ||
                node.classList.contains('gn-edit-controls') ||
                node.classList.contains('gn-edit-btn') ||
                node.classList.contains('gitlab-ninja-settings')
              ) {
                continue;
              }
              // This is a real GitLab change
              return true;
            }
          }
        }
        return false;
      });

      if (isRelevantMutation) {
        this.enhanceAllFeatures();
      }
    }, this.config.debounceDelay);

    const boardsContainer = await waitForElement('.boards-list, [data-testid="boards-list"]');

    if (boardsContainer) {
      this.mainObserver = new MutationObserver(handleMutations);
      this.mainObserver.observe(boardsContainer, {
        childList: true,
        subtree: true,
      });
      debugLog('GitLab Ninja: Main observer active on element:', boardsContainer);
      // Re-enhance now that the board is available
      this.enhanceAllFeatures();
    } else {
      debugWarn('GitLab Ninja: Could not find boards container after waiting 30s');
    }
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    debugLog('GitLab Ninja: Cleaning up...');

    if (this.autoAssignFeature) {
      this.autoAssignFeature.destroy();
    }

    if (this.timeEstimateModalFeature) {
      this.timeEstimateModalFeature.destroy();
    }

    this.boardSettingsFeature.destroy();
    this.editModeFeature.destroy();
    this.newIssueEstimateFeature.destroy();

    if (this.mainObserver) {
      this.mainObserver.disconnect();
    }

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }
}

// Initialize when DOM is ready
debugLog('GitLab Ninja: Script file executed, document state:', document.readyState);
debugLog('GitLab Ninja: Current URL:', window.location.href);

if (document.readyState === 'loading') {
  debugLog('GitLab Ninja: Waiting for DOMContentLoaded...');
  document.addEventListener('DOMContentLoaded', () => {
    debugLog('GitLab Ninja: DOMContentLoaded fired');
    ninjaInstance = new GitLabNinja();
    ninjaInstance.init();
  });
} else {
  debugLog('GitLab Ninja: DOM already loaded, initializing immediately');
  ninjaInstance = new GitLabNinja();
  ninjaInstance.init();
}

debugLog('GitLab Ninja: Script loaded successfully');
