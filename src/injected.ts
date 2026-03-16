/**
 * Injected script that runs in the page context (not content script context)
 * This can intercept GitLab's fetch/XHR calls
 */

// Guard against double-execution (script tag + world:MAIN)
if ((window as any).__gitlabNinjaInjected) {
  // Already running — skip
} else {
  (window as any).__gitlabNinjaInjected = true;

  // Debug logging gated behind localStorage flag
  const __gnDebug = (() => {
    try {
      return localStorage.getItem('gitlab-ninja-debug') === 'true';
    } catch {
      return false;
    }
  })();
  const debugLog = __gnDebug ? console.log.bind(console) : () => {};
  const debugWarn = __gnDebug ? console.warn.bind(console) : () => {};

  debugLog('GitLab Ninja: Injected script loaded in PAGE context');

  // Read nonce from content script for authenticated event communication
  const nonceMeta = document.querySelector('meta[name="gitlab-ninja-nonce"]');
  const eventNonce = nonceMeta?.getAttribute('content') || '';

  // Setup storage for captured time tracking data
  const timeTrackingData: Record<string, { spent: number; estimate: number }> = {};

  /**
   * Build a unique cache key from a GraphQL issue node (project-scoped).
   * Must match the logic in utils/api.ts buildIssueCacheKey.
   */
  function buildIssueCacheKeyInjected(issue: any): string {
    const iid = String(issue.iid);

    if (issue.referencePath) {
      const match = issue.referencePath.match(/^(.+?)#(\d+)/);
      if (match) return `${match[1]}#${match[2]}`;
    }

    if (issue.webUrl) {
      const match = issue.webUrl.match(/\/([^/]+(?:\/[^/]+)*)\/-\/issues\/(\d+)/);
      if (match) return `${match[1]}#${match[2]}`;
    }

    if (issue.project?.fullPath) {
      return `${issue.project.fullPath}#${iid}`;
    }

    return iid;
  }

  // Track whether auto-assign is enabled (content script tells us via custom event)
  let autoAssignEnabled = true;

  window.addEventListener('gitlab-ninja-set-auto-assign', ((event: CustomEvent) => {
    if (event.detail?._nonce !== eventNonce) return;
    autoAssignEnabled = event.detail.enabled;
    debugLog(`GitLab Ninja [INJECTED]: Auto-assign ${autoAssignEnabled ? 'enabled' : 'disabled'}`);
  }) as EventListener);

  /**
   * Get current user's global ID from GitLab's gon object
   * Returns something like "gid://gitlab/User/123"
   */
  function getCurrentUserGid(): string | null {
    const gon = (window as any).gon;
    if (gon?.current_user_id) {
      return `gid://gitlab/User/${gon.current_user_id}`;
    }
    return null;
  }

  /**
   * Check if a GraphQL request body contains an issue creation mutation
   * and inject the current user as assignee
   */
  function maybeInjectAssignee(body: string): string {
    if (!autoAssignEnabled) return body;

    try {
      const parsed = JSON.parse(body);
      const query = parsed.query || parsed.operationName || '';
      const variables = parsed.variables || {};

      // Check for board issue creation mutations
      const isCreateIssue =
        (typeof query === 'string' &&
          (query.includes('boardListCreateIssue') ||
            query.includes('createIssue') ||
            query.includes('CreateIssue') ||
            query.includes('createIssuable') ||
            query.includes('CreateIssuable'))) ||
        (parsed.operationName &&
          (parsed.operationName.includes('CreateIssue') ||
            parsed.operationName.includes('CreateIssuable') ||
            parsed.operationName.includes('boardListCreateIssue') ||
            parsed.operationName.includes('createIssuable')));

      if (isCreateIssue) {
        const userGid = getCurrentUserGid();
        if (userGid) {
          // The input is typically at variables.input
          const input = variables.input || {};

          // Only add assignee if not already set
          if (!input.assigneeIds || input.assigneeIds.length === 0) {
            input.assigneeIds = [userGid];
            variables.input = input;
            parsed.variables = variables;

            debugLog(
              `GitLab Ninja [INJECTED]: 🎯 Injected assignee ${userGid} into issue creation`
            );

            // Notify content script that we're auto-assigning
            window.dispatchEvent(
              new CustomEvent('gitlab-ninja-auto-assigned', {
                detail: { userGid, _nonce: eventNonce },
              })
            );

            return JSON.stringify(parsed);
          } else {
            debugLog('GitLab Ninja [INJECTED]: Issue already has assignees, skipping');
          }
        }
      }
    } catch {
      // Not JSON or parse error, return original
    }

    return body;
  }

  // Intercept fetch
  const originalFetch = window.fetch;
  let fetchCount = 0;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : (input as Request).url;

    // Only intercept GitLab GraphQL requests — pass everything else through unchanged
    if (!url.includes('/api/graphql')) {
      return originalFetch.call(this, input, init);
    }

    fetchCount++;

    // Intercept GraphQL mutations to inject assignee
    if (init?.method === 'POST' && init?.body) {
      const bodyStr = typeof init.body === 'string' ? init.body : null;
      if (bodyStr) {
        const modifiedBody = maybeInjectAssignee(bodyStr);
        if (modifiedBody !== bodyStr) {
          init = { ...init, body: modifiedBody };
        }
      }
    }

    // Check if this was a create-issue mutation (before awaiting response)
    const bodyStr = init?.method === 'POST' && typeof init?.body === 'string' ? init.body : null;
    let isCreateIssueMutation = false;
    if (bodyStr && url.includes('/api/graphql')) {
      try {
        const parsed = JSON.parse(bodyStr);
        const query = parsed.query || parsed.operationName || '';
        isCreateIssueMutation =
          (typeof query === 'string' &&
            (query.includes('boardListCreateIssue') ||
              query.includes('createIssue') ||
              query.includes('CreateIssue') ||
              query.includes('createIssuable') ||
              query.includes('CreateIssuable'))) ||
          (parsed.operationName &&
            (parsed.operationName.includes('CreateIssue') ||
              parsed.operationName.includes('CreateIssuable') ||
              parsed.operationName.includes('boardListCreateIssue') ||
              parsed.operationName.includes('createIssuable')));
      } catch {
        /* ignore */
      }
    }

    const response = await originalFetch.call(this, input, init);
    const clonedResponse = response.clone();

    try {
      if (url.includes('/api/graphql')) {
        const data = await clonedResponse.json();

        // Detect newly created issue and notify content script
        if (isCreateIssueMutation) {
          debugLog(
            'GitLab Ninja [INJECTED]: Create issue response:',
            JSON.stringify(data?.data).substring(0, 500)
          );

          // Try to extract the created issue from various response shapes
          const issue =
            data?.data?.boardListCreateIssue?.issue ||
            data?.data?.createIssue?.issue ||
            data?.data?.createIssuable?.issuable ||
            data?.data?.createBoardItem?.boardItem?.issue;

          if (issue) {
            debugLog(
              'GitLab Ninja [INJECTED]: Found issue in response:',
              JSON.stringify(issue).substring(0, 300)
            );
          }

          let projectPath: string | null = null;
          let iid: string | null = null;

          if (issue?.iid) {
            iid = String(issue.iid);

            // Try direct projectPath field
            if (issue.projectPath) {
              projectPath = issue.projectPath;
            }
            // Try project.fullPath
            else if (issue.project?.fullPath) {
              projectPath = issue.project.fullPath;
            }
            // Try extracting from webUrl
            else if (issue.webUrl) {
              const match = issue.webUrl.match(/^(?:https?:\/\/[^/]+)?\/(.+?)\/-\/issues\/\d+/);
              if (match) projectPath = match[1];
            }
            // Try referencePath (e.g. "group/web#123")
            else if (issue.referencePath) {
              const match = issue.referencePath.match(/^(.+?)#\d+/);
              if (match) projectPath = match[1];
            }
          }

          if (projectPath && iid) {
            debugLog(`GitLab Ninja [INJECTED]: New issue created: ${projectPath}#${iid}`);
            window.dispatchEvent(
              new CustomEvent('gitlab-ninja-issue-created', {
                detail: { projectPath, iid, _nonce: eventNonce },
              })
            );
          } else {
            debugWarn(
              'GitLab Ninja [INJECTED]: Could not extract project/iid from create response',
              { projectPath, iid }
            );
          }
        }

        const boardData = data?.data?.group?.board || data?.data?.project?.board;

        if (boardData?.lists?.nodes) {
          let count = 0;
          boardData.lists.nodes.forEach((list: any) => {
            if (list.issues?.nodes) {
              list.issues.nodes.forEach((issue: any) => {
                if (issue.iid) {
                  const cacheKey = buildIssueCacheKeyInjected(issue);
                  timeTrackingData[cacheKey] = {
                    spent: (issue.totalTimeSpent || 0) / 3600,
                    estimate: (issue.timeEstimate || 0) / 3600,
                  };
                  count++;

                  if (count <= 3) {
                    debugLog(
                      `GitLab Ninja [INJECTED]: ✅ ${cacheKey}: ${issue.humanTotalTimeSpent || '0'} / ${issue.humanTimeEstimate || '0'}`
                    );
                  }
                }
              });
            }
          });

          if (count > 0) {
            debugLog(`GitLab Ninja [INJECTED]: 💾 Cached ${count} issues`);

            // Dispatch custom event to notify content script
            window.dispatchEvent(
              new CustomEvent('gitlab-ninja-data', {
                detail: { timeTrackingData, _nonce: eventNonce },
              })
            );
          }
        }
      }
    } catch (error) {
      // Ignore
    }

    return response;
  };

  debugLog('GitLab Ninja [INJECTED]: Interceptor active in page context');
} // end double-execution guard
