/**
 * Weekly report generator — builds a copy-pasteable status update from the
 * issues you logged time on this week. Fully template-driven: the report
 * template and per-issue line format are user-configurable.
 */

/** How far ahead assigned open issues count as in progress (by due date). */
export type DueWindow = 'nextMonday' | 'twoWeeks' | 'fourWeeks' | 'none';

export interface ReportSettings {
  /** Report body. {{done}} and {{inProgress}} are replaced with item lists. */
  template: string;
  /** One line per issue. Placeholders: {{title}} {{url}} {{project}} {{iid}} {{timeSpent}} */
  itemTemplate: string;
  /** Comma-separated label names that mark an issue as done (case-insensitive). */
  doneLabels: string;
  /** Text used when a section has no items. */
  emptyText: string;
  /** Assigned open issues due on/before this cutoff join {{inProgress}}. */
  dueWindow: DueWindow;
  /** Weekday the report period starts on (JS getDay: 0 = Sun … 6 = Sat). */
  startDay: number;
  /** Comma-separated title substrings; matching issues are left out entirely (case-insensitive). */
  ignoreTitles: string;
}

export const DEFAULT_REPORT_SETTINGS: ReportSettings = {
  template: `Here's my weekly update.

—— DONE THIS WEEK ——

{{done}}

—— IN PROGRESS  ——

{{inProgress}}

—— BLOCKED  ——

None this week

—— DEADLINES AT RISK ——

None this week

—— SUGGESTED FOR NEXT WEEK ——

•

Cheers,`,
  itemTemplate: '• {{title}} {{url}}',
  doneLabels: 'done',
  emptyText: 'None this week',
  dueWindow: 'nextMonday',
  startDay: 1, // Monday
  ignoreTitles: 'Standup',
};

const STORAGE_KEY = 'reportSettings';

export function loadReportSettings(): Promise<ReportSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(STORAGE_KEY, (result) => {
      resolve({ ...DEFAULT_REPORT_SETTINGS, ...(result[STORAGE_KEY] || {}) });
    });
  });
}

export function saveReportSettings(settings: ReportSettings): void {
  chrome.storage.sync.set({ [STORAGE_KEY]: settings });
}

/** The per-issue data the report needs; a subset of the weekly overview entry. */
export interface ReportIssue {
  issueIid: number;
  issueTitle: string;
  issueUrl: string;
  issueState: string; // opened, closed
  projectName: string;
  labels: string[];
  timeSpent: number; // seconds
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0 && m === 0) return '0m';
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function parseDoneLabels(doneLabels: string): string[] {
  return doneLabels
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
}

/** Closed OR carrying a done-label counts as done. */
export function isDone(issue: ReportIssue, doneLabels: string): boolean {
  if (issue.issueState === 'closed') return true;
  const done = parseDoneLabels(doneLabels);
  return issue.labels.some((l) => done.includes(l.toLowerCase()));
}

function renderItem(issue: ReportIssue, itemTemplate: string): string {
  return itemTemplate
    .replace(/\{\{title\}\}/g, issue.issueTitle)
    .replace(/\{\{url\}\}/g, issue.issueUrl)
    .replace(/\{\{project\}\}/g, issue.projectName)
    .replace(/\{\{iid\}\}/g, String(issue.issueIid))
    .replace(/\{\{timeSpent\}\}/g, formatDuration(issue.timeSpent));
}

function renderSection(issues: ReportIssue[], settings: ReportSettings): string {
  if (issues.length === 0) return settings.emptyText;
  return issues.map((i) => renderItem(i, settings.itemTemplate)).join('\n');
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Resolve the due-date cutoff (inclusive, YYYY-MM-DD) for the given window,
 * or null when the feature is off.
 */
export function dueDateCutoff(window: DueWindow, now: Date = new Date()): string | null {
  if (window === 'none') return null;
  if (window === 'nextMonday') {
    // getDay(): Sun = 0 … Sat = 6. Always the NEXT Monday (7 days out on a Monday).
    const daysAhead = (8 - now.getDay()) % 7 || 7;
    return toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead));
  }
  const days = window === 'twoWeeks' ? 14 : 28;
  return toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}

/**
 * Date the report period starts: the most recent occurrence of startDay
 * (JS getDay convention), today included.
 */
export function reportPeriodStart(startDay: number, now: Date = new Date()): Date {
  const daysBack = (now.getDay() - startDay + 7) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);
}

/** An assigned issue candidate for the due-date merge. */
export type AssignedIssue = ReportIssue & { dueDate: string | null };

/**
 * Assigned open issues due on/before the cutoff that are not already in the
 * timelogged list (matched by URL). Null cutoff = none.
 */
export function dueSoonIssues(
  logged: ReportIssue[],
  assigned: AssignedIssue[],
  cutoff: string | null
): ReportIssue[] {
  if (!cutoff) return [];
  const seen = new Set(logged.map((i) => i.issueUrl));
  return assigned.filter((a) => a.dueDate && a.dueDate <= cutoff && !seen.has(a.issueUrl));
}

/** True when the issue title contains one of the comma-separated ignore substrings. */
export function isIgnored(issue: ReportIssue, ignoreTitles: string): boolean {
  const needles = ignoreTitles
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const title = issue.issueTitle.toLowerCase();
  return needles.some((n) => title.includes(n));
}

/**
 * Only timelogged issues can be done; extraInProgress (due-soon assigned
 * issues without logged time) always lands under {{inProgress}}.
 */
export function buildReport(
  logged: ReportIssue[],
  settings: ReportSettings,
  extraInProgress: ReportIssue[] = []
): string {
  const kept = logged.filter((i) => !isIgnored(i, settings.ignoreTitles));
  const extras = extraInProgress.filter((i) => !isIgnored(i, settings.ignoreTitles));
  const done = kept.filter((i) => isDone(i, settings.doneLabels));
  const inProgress = [...kept.filter((i) => !isDone(i, settings.doneLabels)), ...extras];
  return settings.template
    .replace(/\{\{done\}\}/g, renderSection(done, settings))
    .replace(/\{\{inProgress\}\}/g, renderSection(inProgress, settings));
}
