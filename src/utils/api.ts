/**
 * GitLab API utilities - Intercepts GitLab's existing API calls
 */

import { TimeInfo } from '../types';

// Cache to store time tracking data by issue IID
const timeTrackingCache = new Map<string, TimeInfo>();

/**
 * Extract a unique issue cache key from a card element.
 * Returns "projectPath#iid" to avoid collisions on group boards
 * where different projects can share the same IID.
 */
export function extractIssueCacheKey(card: HTMLElement): string | null {
  // Look for the issue link
  const issueLink = card.querySelector<HTMLAnchorElement>(
    'a.board-card-title, a[href*="/issues/"]'
  );

  if (!issueLink) {
    return null;
  }

  // Parse URL like: https://my.gitlab.com/group/project/-/issues/1234
  const url = new URL(issueLink.href);
  const pathMatch = url.pathname.match(/^\/(.+?)\/-\/issues\/(\d+)/);

  if (pathMatch) {
    return `${pathMatch[1]}#${pathMatch[2]}`; // e.g., "group/project#1234"
  }

  return null;
}

/**
 * Build a cache key from a GraphQL issue node.
 * Tries referencePath, webUrl, project.fullPath, then falls back to just iid.
 */
export function buildIssueCacheKey(issue: {
  iid: string | number;
  referencePath?: string;
  webUrl?: string;
  project?: { fullPath: string };
}): string {
  const iid = String(issue.iid);

  // referencePath is like "group/project#4"
  if (issue.referencePath) {
    const match = issue.referencePath.match(/^(.+?)#(\d+)/);
    if (match) return `${match[1]}#${match[2]}`;
  }

  // webUrl is like "https://gitlab.example.com/group/project/-/issues/4"
  if (issue.webUrl) {
    const match = issue.webUrl.match(/\/([^/]+(?:\/[^/]+)*)\/-\/issues\/(\d+)/);
    if (match) return `${match[1]}#${match[2]}`;
  }

  // project.fullPath
  if (issue.project?.fullPath) {
    return `${issue.project.fullPath}#${iid}`;
  }

  // Fallback: just iid (won't help on group boards but better than nothing)
  return iid;
}

/**
 * Extract just the numeric IID from a cache key.
 * Cache keys are "projectPath#iid" or just "iid".
 */
export function extractIidFromCacheKey(cacheKey: string): string {
  const hashIdx = cacheKey.lastIndexOf('#');
  return hashIdx >= 0 ? cacheKey.slice(hashIdx + 1) : cacheKey;
}

/**
 * Get cached time tracking data for an issue
 */
export function getCachedTimeTracking(cacheKey: string): TimeInfo | null {
  return timeTrackingCache.get(cacheKey) || null;
}

/**
 * Manually add time tracking data to cache (for fallback fetcher)
 */
export function cacheTimeTracking(iid: string, timeInfo: TimeInfo): void {
  timeTrackingCache.set(iid, timeInfo);
}

/**
 * Check if cache has any data
 */
export function hasCachedData(): boolean {
  return timeTrackingCache.size > 0;
}
