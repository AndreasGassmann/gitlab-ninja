/**
 * GitLab REST API utilities for making mutations (estimates, time spent)
 */

import { debugLog, debugError } from './debug';

/**
 * Get CSRF token from GitLab page
 */
function getCsrfToken(): string | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
  return meta?.content || null;
}

/**
 * Extract project path from an issue card's link
 * e.g., /project/project-web/-/issues/1234 → project/project-web
 */
export function extractProjectPath(card: HTMLElement): string | null {
  const link = card.querySelector<HTMLAnchorElement>('a[href*="/issues/"]');
  if (!link) return null;

  const match = link.pathname.match(/^\/(.+?)\/-\/issues\/\d+/);
  return match ? match[1] : null;
}

/**
 * Set time estimate on an issue
 */
export async function setTimeEstimate(
  projectPath: string,
  issueIid: string,
  duration: string
): Promise<boolean> {
  const csrfToken = getCsrfToken();
  const encodedPath = encodeURIComponent(projectPath);

  const response = await fetch(`/api/v4/projects/${encodedPath}/issues/${issueIid}/time_estimate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body: JSON.stringify({ duration }),
  });

  if (!response.ok) {
    debugError(`GitLab Ninja: Failed to set estimate: ${response.status}`);
    return false;
  }

  debugLog(`GitLab Ninja: Set estimate to ${duration} on #${issueIid}`);
  return true;
}

/**
 * Resolve an issue's global ID (gid://gitlab/Issue/NNN) from project path + IID.
 */
async function resolveIssueGid(
  projectPath: string,
  issueIid: string
): Promise<string | null> {
  const csrfToken = getCsrfToken();
  const query = `query { project(fullPath: "${projectPath}") { issue(iid: "${issueIid}") { id } } }`;

  const response = await fetch('/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) return null;
  const data = await response.json();
  return data?.data?.project?.issue?.id ?? null;
}

/**
 * Add time spent on an issue via GraphQL timelogCreate.
 * The REST /add_spent_time endpoint does not support spentAt.
 */
export async function addTimeSpent(
  projectPath: string,
  issueIid: string,
  duration: string,
  summary?: string,
  spentAt?: string
): Promise<boolean> {
  const issueGid = await resolveIssueGid(projectPath, issueIid);
  if (!issueGid) {
    debugError('GitLab Ninja: Failed to resolve issue GID');
    return false;
  }

  const csrfToken = getCsrfToken();
  const escapedSummary = (summary || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const spentAtField = spentAt ? `spentAt: "${spentAt}"` : '';

  const mutation = `mutation {
    timelogCreate(input: {
      issuableId: "${issueGid}",
      timeSpent: "${duration}",
      ${spentAtField}
      summary: "${escapedSummary}"
    }) { errors }
  }`;

  const response = await fetch('/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body: JSON.stringify({ query: mutation }),
  });

  if (!response.ok) {
    debugError(`GitLab Ninja: Failed to add time spent: ${response.status}`);
    return false;
  }

  const data = await response.json();
  const errors = data?.data?.timelogCreate?.errors;
  if (errors?.length) {
    debugError(`GitLab Ninja: timelogCreate errors: ${errors.join(', ')}`);
    return false;
  }

  debugLog(`GitLab Ninja: Added ${duration} spent on #${issueIid}`);
  return true;
}

/**
 * Format a Date to YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
