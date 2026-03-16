/**
 * Fallback fetcher - extract time tracking from GitLab's Vue.js app data or fetch manually
 */

import { TimeInfo } from '../types';
import { debugLog, debugWarn, debugError } from './debug';
import { cacheTimeTracking, hasCachedData } from './api';

/**
 * Try to extract time tracking from GitLab's Vue app data
 */
function extractFromVueData(): Map<string, TimeInfo> {
  debugLog('GitLab Ninja: 🔍 Attempting to extract data from GitLab Vue app...');

  const results = new Map<string, TimeInfo>();

  try {
    // GitLab might store data in window.__APOLLO_STATE__ or similar
    const apolloState = (
      window as unknown as {
        __APOLLO_STATE__?: Record<
          string,
          {
            iid?: string;
            timeStats?: { totalTimeSpent?: number; timeEstimate?: number };
          }
        >;
      }
    ).__APOLLO_STATE__;
    if (apolloState) {
      debugLog('GitLab Ninja: Found Apollo state, searching for time tracking data...');
      // Search through Apollo cache for time tracking data
      Object.keys(apolloState).forEach((key) => {
        const obj = apolloState[key];
        if (obj && obj.iid && obj.timeStats) {
          const timeInfo: TimeInfo = {
            spent: (obj.timeStats.totalTimeSpent || 0) / 3600,
            estimate: (obj.timeStats.timeEstimate || 0) / 3600,
          };
          results.set(String(obj.iid), timeInfo);
        }
      });
    }

    // Try __INITIAL_DATA__ or gon.current_user_data
    const gon = (window as unknown as { gon?: { api_version?: string } }).gon;
    if (gon && gon.api_version) {
      debugLog('GitLab Ninja: Found gon object, API version:', gon.api_version);
    }

    if (results.size > 0) {
      debugLog(`GitLab Ninja: ✅ Extracted time data for ${results.size} issues from Vue app`);
    }
  } catch (error) {
    debugLog('GitLab Ninja: Could not extract from Vue data:', error);
  }

  return results;
}

/**
 * Manually fetch board issues with time tracking data from API
 */
export async function fetchBoardIssuesManually(): Promise<Map<string, TimeInfo>> {
  debugLog('GitLab Ninja: 🔄 Manually fetching board issues with time tracking...');

  // First try extracting from Vue
  let results = extractFromVueData();
  if (results.size > 0) {
    return results;
  }

  results = new Map<string, TimeInfo>();

  try {
    // Check if we're on a group board or project board
    const urlMatch = window.location.pathname.match(/\/(groups|projects)\/([^/]+)/);

    if (!urlMatch) {
      debugWarn('GitLab Ninja: Could not determine board type from URL');
      return results;
    }

    const [, boardType, boardPath] = urlMatch;
    debugLog(`GitLab Ninja: Detected ${boardType} board: ${boardPath}`);

    // Get board ID from URL or find it in the page
    const urlParams = new URLSearchParams(window.location.search);
    let boardId = urlParams.get('board_id');

    if (!boardId) {
      // Try to find board ID in page data
      const boardData = document.querySelector('[data-board-id]');
      boardId = boardData?.getAttribute('data-board-id') || null;
    }

    if (!boardId) {
      debugLog(
        'GitLab Ninja: Could not find board ID (skipping fallback - relying on injected script)'
      );
      return results;
    }

    // Get all board lists
    const lists = document.querySelectorAll('[data-testid="board-list"]');
    debugLog(`GitLab Ninja: Found ${lists.length} board lists to fetch`);

    let fetchedCount = 0;

    // Fetch issues for each list
    for (const list of Array.from(lists)) {
      try {
        // Try to find list ID from data attributes
        const listId = list.getAttribute('data-list-id') || list.getAttribute('data-id');

        if (!listId) {
          debugWarn('GitLab Ninja: Could not find list ID');
          continue;
        }

        const apiUrl =
          boardType === 'groups'
            ? `/api/v4/groups/${encodeURIComponent(boardPath)}/boards/${boardId}/lists/${listId}/issues`
            : `/api/v4/projects/${encodeURIComponent(boardPath)}/boards/${boardId}/lists/${listId}/issues`;

        const response = await fetch(apiUrl);

        if (response.ok) {
          const issues = await response.json();

          issues.forEach(
            (issue: {
              iid?: string;
              web_url?: string;
              references?: { full?: string };
              time_stats?: { total_time_spent?: number; time_estimate?: number };
            }) => {
              if (issue.iid && issue.time_stats) {
                // Build project-scoped key from REST API fields
                let cacheKey = String(issue.iid);
                if (issue.web_url) {
                  const match = issue.web_url.match(/\/([^/]+(?:\/[^/]+)*)\/-\/issues\/(\d+)/);
                  if (match) cacheKey = `${match[1]}#${match[2]}`;
                } else if (issue.references?.full) {
                  // references.full is like "group/project#4"
                  cacheKey = issue.references.full;
                }

                const timeInfo: TimeInfo = {
                  spent: (issue.time_stats.total_time_spent || 0) / 3600,
                  estimate: (issue.time_stats.time_estimate || 0) / 3600,
                };
                results.set(cacheKey, timeInfo);
                cacheTimeTracking(cacheKey, timeInfo);
                fetchedCount++;

                if (fetchedCount <= 3) {
                  debugLog(
                    `GitLab Ninja: ✅ Fetched issue ${cacheKey}: ${timeInfo.spent}h / ${timeInfo.estimate}h`
                  );
                }
              }
            }
          );
        } else {
          debugWarn(`GitLab Ninja: Failed to fetch list ${listId}: ${response.status}`);
        }
      } catch (error) {
        debugWarn('GitLab Ninja: Error fetching list:', error);
      }
    }

    debugLog(
      `GitLab Ninja: 💾 Manually fetched time data for ${fetchedCount} issues from ${lists.length} lists`
    );
  } catch (error) {
    debugError('GitLab Ninja: Error in manual fetch:', error);
  }

  return results;
}

/**
 * Check if we have cached data, if not fetch manually
 */
export async function ensureTimeTrackingData(onDataFetched?: () => void): Promise<void> {
  const cards = document.querySelectorAll('.board-card');

  if (!hasCachedData() && cards.length > 0) {
    debugLog('GitLab Ninja: ⚠️ No cached time data found, fetching manually...');
    const results = await fetchBoardIssuesManually();

    if (results.size > 0 && onDataFetched) {
      debugLog('GitLab Ninja: 💾 Manual fetch complete, updating UI...');
      onDataFetched();
    }
  } else if (hasCachedData()) {
    debugLog('GitLab Ninja: ✅ Found cached time data from interceptor');
  }
}
