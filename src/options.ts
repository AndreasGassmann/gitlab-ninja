import {
  CustomColors,
  DEFAULT_COLORS,
  STATUS_META,
  STATUS_PRESETS,
  PROJECT_PALETTE_PRESETS,
  ThemeMode,
  hexToRgba,
  loadCustomColors,
  saveCustomColors,
  loadThemeMode,
  saveThemeMode,
} from './utils/themeManager';

interface WeeklyTimelog {
  issueIid: number;
  issueTitle: string;
  issueUrl: string;
  projectName: string;
  labels: string[];
  timeSpent: number;
  timeEstimate: number;
  totalTimeSpent: number;
  dailySpent: Record<string, number>;
}

interface TimelogDetail {
  id: string; // gid://gitlab/Timelog/123
  issueIid: number;
  issueTitle: string;
  issueUrl: string;
  issueGid: string; // gid://gitlab/Issue/456
  projectName: string;
  projectId: string; // gid://gitlab/Project/789
  note: string;
  timeSpent: number; // seconds
  spentAt: string; // Full ISO datetime e.g. "2026-03-09T17:36:06+01:00"
}

const $ = (id: string) => document.getElementById(id)!;

let apiToken: string | null = null;
let gitlabUrl: string | null = null;
let weekOffset = 0;
let cachedEntries: WeeklyTimelog[] = [];
let cachedTimelogs: TimelogDetail[] = [];
let cachedDays: Date[] = [];
let activeFilterDate: string | null = null;
let currentView: 'list' | 'week' | 'month' = 'list';
let monthOffset = 0;
let hideWeekends = false;
let boardGroupPath: string | null = null;
let username: string | null = null;
let operationInProgress = false;

let currentColors: CustomColors = { ...DEFAULT_COLORS };
let currentThemeMode: ThemeMode = 'auto';
const projectColorMap = new Map<string, string>();

function getProjectColor(projectName: string): string {
  if (!projectColorMap.has(projectName)) {
    // Check for a user-assigned color first, then fall back to palette
    if (currentColors.projectColors[projectName]) {
      projectColorMap.set(projectName, currentColors.projectColors[projectName]);
    } else {
      const palette = currentColors.projectPalette;
      // Count how many projects already used palette colors (excluding assigned ones)
      const paletteIndex = Array.from(projectColorMap.values()).filter(
        (c) => !Object.values(currentColors.projectColors).includes(c)
      ).length;
      projectColorMap.set(projectName, palette[paletteIndex % palette.length]);
    }
  }
  return projectColorMap.get(projectName)!;
}

function getDateFromSpentAt(spentAt: string): string {
  return spentAt.includes('T') ? spentAt.split('T')[0] : spentAt;
}

function parseTimeFromISO(iso: string): { hours: number; minutes: number } {
  if (!iso.includes('T')) return { hours: 9, minutes: 0 };
  const timePart = iso.split('T')[1];
  const match = timePart.match(/^(\d{2}):(\d{2})/);
  if (!match) return { hours: 9, minutes: 0 };
  return { hours: parseInt(match[1], 10), minutes: parseInt(match[2], 10) };
}

async function loadSettings(): Promise<void> {
  const [tokenResult, syncResult] = await Promise.all([
    new Promise<any>((resolve) => chrome.storage.local.get('apiToken', resolve)),
    new Promise<any>((resolve) =>
      chrome.storage.sync.get(['lastGitlabUrl', 'boardGroupPath', 'username'], resolve)
    ),
  ]);
  apiToken = tokenResult.apiToken || null;
  gitlabUrl = syncResult.lastGitlabUrl || null;
  boardGroupPath = syncResult.boardGroupPath || null;
  username = syncResult.username || null;
  if (apiToken) ($('apiToken') as HTMLInputElement).value = apiToken;
  if (gitlabUrl) ($('gitlabUrl') as HTMLInputElement).value = gitlabUrl;
  if (boardGroupPath) ($('boardGroupPath') as HTMLInputElement).value = boardGroupPath;
}

async function detectGitlabUrl(): Promise<void> {
  if (gitlabUrl) return; // Already saved in settings
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.url) {
          try {
            const url = new URL(tab.url);
            const parts = url.pathname.split('/').filter(Boolean);
            if (parts.includes('-') && parts.length >= 3) {
              gitlabUrl = url.origin;
              chrome.storage.sync.set({ lastGitlabUrl: gitlabUrl });
              if ($('gitlabUrl')) ($('gitlabUrl') as HTMLInputElement).value = gitlabUrl;
              break;
            }
          } catch {
            /* ignore */
          }
        }
      }
      resolve();
    });
  });
}

function parseBoardInput(raw: string, baseUrl: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // Full URL pasted — extract the path, strip query params like assignee_username
    return url.pathname.replace(/^\/+|\/+$/g, '');
  } catch {
    // Not a full URL — treat as a path
  }
  // Strip the base URL if someone pasted a partial like "gitlab.example.com/groups/..."
  let path = raw;
  try {
    const base = new URL(baseUrl);
    if (path.startsWith(base.host)) {
      path = path.slice(base.host.length);
    }
  } catch {
    /* ignore */
  }
  // Strip any query string
  const qIdx = path.indexOf('?');
  if (qIdx !== -1) path = path.slice(0, qIdx);
  return path.replace(/^\/+|\/+$/g, '') || null;
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekDates(offset: number): { start: Date; end: Date; days: Date[] } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + mondayOffset + offset * 7
  );

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    days.push(d);
  }

  const end = new Date(days[6].getFullYear(), days[6].getMonth(), days[6].getDate() + 1);

  return { start: monday, end, days };
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0 && m === 0) return '0m';
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDayDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function isToday(d: Date): boolean {
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const LABEL_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  done: { bg: 'rgba(52,211,153,0.12)', fg: '#34d399', border: 'rgba(52,211,153,0.2)' },
  doing: { bg: 'rgba(96,165,250,0.12)', fg: '#60a5fa', border: 'rgba(96,165,250,0.2)' },
  testing: { bg: 'rgba(251,191,36,0.12)', fg: '#fbbf24', border: 'rgba(251,191,36,0.2)' },
  review: { bg: 'rgba(167,139,250,0.12)', fg: '#a78bfa', border: 'rgba(167,139,250,0.2)' },
};

function labelBadge(label: string): string {
  const lower = label.toLowerCase();
  const colors = LABEL_COLORS[lower] || { bg: '#eef0f4', fg: '#626874', border: '#dcdee3' };
  return `<span class="label-badge" style="background:${colors.bg};color:${colors.fg};border:1px solid ${colors.border}">${escapeHtml(label)}</span>`;
}

async function fetchWeekTimelogs(
  start: Date,
  end: Date
): Promise<{ entries: WeeklyTimelog[]; timelogs: TimelogDetail[] }> {
  if (!gitlabUrl || !apiToken) return { entries: [], timelogs: [] };

  const query = `query {
    currentUser {
      timelogs(startDate: "${localDateStr(start)}", endDate: "${localDateStr(end)}") {
        nodes {
          id
          timeSpent
          spentAt
          summary
          issue {
            id
            iid
            title
            webUrl
            timeEstimate
            totalTimeSpent
            labels {
              nodes {
                title
              }
            }
          }
          project {
            id
            name
          }
        }
      }
    }
  }`;

  const res = await fetch(`${gitlabUrl}/api/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) throw new Error(`API error (${res.status})`);
  const data = await res.json();
  if (data.errors?.length) throw new Error(data.errors[0].message);

  const nodes = data.data?.currentUser?.timelogs?.nodes || [];

  const map = new Map<string, WeeklyTimelog>();
  const timelogs: TimelogDetail[] = [];

  for (const node of nodes) {
    if (!node.issue) continue;
    const key = `${node.issue.webUrl}`;
    const fullSpentAt = node.spentAt || new Date().toISOString();
    const spentDateKey = getDateFromSpentAt(fullSpentAt);

    timelogs.push({
      id: node.id,
      issueIid: parseInt(node.issue.iid, 10),
      issueTitle: node.issue.title,
      issueUrl: node.issue.webUrl,
      issueGid: node.issue.id,
      projectName: node.project?.name || '',
      projectId: node.project?.id || '',
      note: node.summary || '',
      timeSpent: node.timeSpent,
      spentAt: fullSpentAt,
    });

    const existing = map.get(key);
    if (existing) {
      existing.timeSpent += node.timeSpent;
      existing.dailySpent[spentDateKey] = (existing.dailySpent[spentDateKey] || 0) + node.timeSpent;
    } else {
      const labels = (node.issue.labels?.nodes || []).map((l: any) => l.title);
      map.set(key, {
        issueIid: parseInt(node.issue.iid, 10),
        issueTitle: node.issue.title,
        issueUrl: node.issue.webUrl,
        projectName: node.project?.name || '',
        labels,
        timeSpent: node.timeSpent,
        timeEstimate: node.issue.timeEstimate || 0,
        totalTimeSpent: node.issue.totalTimeSpent || 0,
        dailySpent: { [spentDateKey]: node.timeSpent },
      });
    }
  }

  timelogs.sort((a, b) => a.spentAt.localeCompare(b.spentAt) || a.issueIid - b.issueIid);

  return {
    entries: Array.from(map.values()).sort((a, b) => b.timeSpent - a.timeSpent),
    timelogs,
  };
}

function formatDurationInput(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

async function deleteTimelog(timelogId: string): Promise<void> {
  if (!gitlabUrl || !apiToken) throw new Error('Not configured');
  const mutation = `mutation { timelogDelete(input: { id: "${timelogId}" }) { errors } }`;
  const res = await fetch(`${gitlabUrl}/api/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
    body: JSON.stringify({ query: mutation }),
  });
  if (!res.ok) throw new Error(`API error (${res.status})`);
  const data = await res.json();
  if (data.errors?.length) throw new Error(data.errors[0].message);
  if (data.data?.timelogDelete?.errors?.length) throw new Error(data.data.timelogDelete.errors[0]);
}

async function createTimelog(
  issueGid: string,
  timeSpent: string,
  spentAt: string,
  note: string
): Promise<void> {
  if (!gitlabUrl || !apiToken) throw new Error('Not configured');
  const escapedNote = note.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const mutation = `mutation {
    timelogCreate(input: {
      issuableId: "${issueGid}",
      timeSpent: "${timeSpent}",
      spentAt: "${spentAt}",
      summary: "${escapedNote}"
    }) { errors }
  }`;
  const res = await fetch(`${gitlabUrl}/api/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
    body: JSON.stringify({ query: mutation }),
  });
  if (!res.ok) throw new Error(`API error (${res.status})`);
  const data = await res.json();
  if (data.errors?.length) throw new Error(data.errors[0].message);
  if (data.data?.timelogCreate?.errors?.length) throw new Error(data.data.timelogCreate.errors[0]);
}

function renderWeek(entries: WeeklyTimelog[], days: Date[], filterDate: string | null) {
  const content = $('weekContent');

  const dailyTotals = days.map((d) => {
    const key = localDateStr(d);
    return entries.reduce((sum, e) => sum + (e.dailySpent[key] || 0), 0);
  });
  const weekTotal = dailyTotals.reduce((a, b) => a + b, 0);

  let displayEntries = entries;
  let displayTotal = weekTotal;
  if (filterDate) {
    displayEntries = entries
      .filter((e) => (e.dailySpent[filterDate] || 0) > 0)
      .map((e) => ({ ...e, timeSpent: e.dailySpent[filterDate] || 0 }))
      .sort((a, b) => b.timeSpent - a.timeSpent);
    displayTotal = displayEntries.reduce((sum, e) => sum + e.timeSpent, 0);
  }

  const filterDay = filterDate ? days.find((d) => localDateStr(d) === filterDate) : null;

  let html = `<div class="week-summary">`;
  days.forEach((d, i) => {
    const dateKey = localDateStr(d);
    const todayClass = isToday(d) ? ' today' : '';
    const activeClass = filterDate === dateKey ? ' active' : '';
    const weekendClass = i >= 5 ? ' weekend' : '';
    const hrs = dailyTotals[i];
    const zeroClass = hrs === 0 ? ' zero' : '';
    html += `
      <div class="day-card${todayClass}${activeClass}${weekendClass}" data-date="${dateKey}">
        <div class="day-card-name">${DAY_NAMES[i]}</div>
        <div class="day-card-date">${formatShortDate(d)}</div>
        <div class="day-card-hours${zeroClass}">${formatDuration(hrs)}</div>
      </div>
    `;
  });
  html += `</div>`;

  html += `<div class="week-total-row">`;
  if (filterDate && filterDay) {
    html += `<div>
      <span class="week-filter-label">Showing: ${formatDayDate(filterDay)}</span>
      <button class="week-filter-clear" id="clearFilter">Show all</button>
    </div>`;
  } else {
    html += `<div></div>`;
  }
  html += `<div class="week-total-right">
    <span class="week-total-label">${filterDate ? 'Day Total' : 'Week Total'}</span>
    <span class="week-total-value">${formatDuration(displayTotal)}</span>
  </div></div>`;

  // Build breakdown & accuracy HTML to append after the issues table
  let bottomSectionsHtml = '';
  if (displayEntries.length > 0) {
    const byProject = new Map<string, number>();
    const byLabel = new Map<string, number>();
    for (const e of displayEntries) {
      const pName = e.projectName || 'Unknown';
      byProject.set(pName, (byProject.get(pName) || 0) + e.timeSpent);
      for (const l of e.labels) {
        byLabel.set(l, (byLabel.get(l) || 0) + e.timeSpent);
      }
      if (e.labels.length === 0) {
        byLabel.set('none', (byLabel.get('none') || 0) + e.timeSpent);
      }
    }

    function renderBreakdown(
      title: string,
      data: Map<string, number>,
      colorFn: (name: string, i: number) => string
    ): string {
      const sorted = Array.from(data.entries()).sort((a, b) => b[1] - a[1]);
      const max = sorted[0]?.[1] || 1;
      let s = `<div class="breakdown-section-title">${title}</div>`;
      for (let i = 0; i < sorted.length; i++) {
        const [name, seconds] = sorted[i];
        const pct = (seconds / max) * 100;
        const color = colorFn(name, i);
        s += `
          <div class="breakdown-item">
            <span class="breakdown-dot" style="background:${color}"></span>
            <span class="breakdown-name">${escapeHtml(name)}</span>
            <div class="breakdown-bar-wrap">
              <div class="breakdown-bar-track">
                <div class="breakdown-bar-fill" style="width:${pct}%;background:${color}"></div>
              </div>
            </div>
            <span class="breakdown-time">${formatDuration(seconds)}</span>
          </div>`;
      }
      return s;
    }

    bottomSectionsHtml += `<div class="breakdown-row">`;
    bottomSectionsHtml +=
      `<div>` +
      renderBreakdown(
        'By Project',
        byProject,
        (_name, i) => currentColors.projectPalette[i % currentColors.projectPalette.length]
      ) +
      `</div>`;
    bottomSectionsHtml +=
      `<div>` +
      renderBreakdown('By Label', byLabel, (name, i) => {
        const lower = name.toLowerCase();
        const lc = LABEL_COLORS[lower];
        if (lc) return lc.fg;
        return currentColors.projectPalette[(i + 3) % currentColors.projectPalette.length];
      }) +
      `</div>`;
    bottomSectionsHtml += `</div>`;

    // ── Estimate Accuracy for "done" items ──
    const doneEntries = displayEntries.filter(
      (e) => e.labels.some((l) => l.toLowerCase() === 'done') && e.timeEstimate > 0
    );

    if (doneEntries.length > 0) {
      interface AccuracyBucket {
        estimated: number;
        actual: number;
        count: number;
      }

      function computeAccuracy(buckets: Map<string, AccuracyBucket>): string {
        const sorted = Array.from(buckets.entries()).sort((a, b) => b[1].actual - a[1].actual);
        let s = '';
        for (const [name, bucket] of sorted) {
          const ratio = bucket.estimated / bucket.actual;
          const pct = Math.round(ratio * 100);
          // Bar: 0-200% range, 100% = perfect. Bar fills to ratio relative to 200%.
          const barPct = Math.min((pct / 200) * 100, 100);
          const markerLeft = 50; // 100% mark is at 50% of the 0-200 range
          let cls = 'good';
          let color = 'var(--green-500)';
          if (ratio < 0.7 || ratio > 1.5) {
            cls = 'bad';
            color = 'var(--red-500)';
          } else if (ratio < 0.85 || ratio > 1.2) {
            cls = 'ok';
            color = 'var(--amber-500)';
          }
          s += `
            <div class="accuracy-item">
              <span class="accuracy-name">${escapeHtml(name)}</span>
              <div class="accuracy-bar-wrap">
                <div class="accuracy-bar-track">
                  <div class="accuracy-bar-fill" style="width:${barPct}%;background:${color}"></div>
                  <div class="accuracy-bar-marker" style="left:${markerLeft}%"></div>
                </div>
              </div>
              <span class="accuracy-value ${cls}">
                ${pct}%
                <div class="accuracy-sub">${formatDuration(bucket.estimated)} est / ${formatDuration(bucket.actual)} actual</div>
              </span>
            </div>`;
        }
        return s;
      }

      const byProject = new Map<string, AccuracyBucket>();
      const byLabel = new Map<string, AccuracyBucket>();

      for (const e of doneEntries) {
        const pName = e.projectName || 'Unknown';
        const existing = byProject.get(pName) || { estimated: 0, actual: 0, count: 0 };
        existing.estimated += e.timeEstimate;
        existing.actual += e.totalTimeSpent;
        existing.count++;
        byProject.set(pName, existing);

        for (const l of e.labels) {
          if (l.toLowerCase() === 'done') continue;
          const lb = byLabel.get(l) || { estimated: 0, actual: 0, count: 0 };
          lb.estimated += e.timeEstimate;
          lb.actual += e.totalTimeSpent;
          lb.count++;
          byLabel.set(l, lb);
        }
      }

      // Overall accuracy
      const totalEst = doneEntries.reduce((s, e) => s + e.timeEstimate, 0);
      const totalAct = doneEntries.reduce((s, e) => s + e.totalTimeSpent, 0);
      const overallRatio = totalEst / totalAct;
      const overallPct = Math.round(overallRatio * 100);
      let overallCls = 'good';
      if (overallRatio < 0.7 || overallRatio > 1.5) overallCls = 'bad';
      else if (overallRatio < 0.85 || overallRatio > 1.2) overallCls = 'ok';

      bottomSectionsHtml += `<div class="accuracy-section">`;
      bottomSectionsHtml += `<div class="accuracy-header">
        Estimate Accuracy
        <span class="accuracy-header-badge">done</span>
        <span style="margin-left:auto;font-size:13px" class="accuracy-value ${overallCls}">
          Overall: ${overallPct}% <span class="accuracy-sub">(${doneEntries.length} issue${doneEntries.length > 1 ? 's' : ''})</span>
        </span>
      </div>`;
      bottomSectionsHtml += `<div class="accuracy-grid">`;

      if (byProject.size > 0) {
        bottomSectionsHtml += `<div><div class="breakdown-section-title">By Project</div>${computeAccuracy(byProject)}</div>`;
      }
      if (byLabel.size > 0) {
        bottomSectionsHtml += `<div><div class="breakdown-section-title">By Label</div>${computeAccuracy(byLabel)}</div>`;
      } else {
        bottomSectionsHtml += `<div><div class="breakdown-section-title">By Label</div><div class="accuracy-empty">Only &ldquo;done&rdquo; label present</div></div>`;
      }

      bottomSectionsHtml += `</div></div>`;
    }
  }

  if (displayEntries.length === 0) {
    html += `
      <div class="empty-state">
        <div class="empty-state-icon">&#128203;</div>
        <div class="empty-state-text">No timelogs ${filterDate ? 'for this day' : 'for this week'}</div>
      </div>
    `;
  } else {
    // Build a map of timelogs grouped by issue URL
    const timelogsByIssue = new Map<string, TimelogDetail[]>();
    for (const log of cachedTimelogs) {
      const list = timelogsByIssue.get(log.issueUrl) || [];
      list.push(log);
      timelogsByIssue.set(log.issueUrl, list);
    }

    html += `<table class="issues-table">`;
    html += `<thead><tr>
      <th>Issue</th>
      <th>Status</th>
      <th>Date</th>
      <th class="bar-cell">Progress</th>
      <th>Time</th>
    </tr></thead><tbody>`;

    for (const entry of displayEntries) {
      const pct =
        entry.timeEstimate > 0 ? Math.round((entry.totalTimeSpent / entry.timeEstimate) * 100) : 0;
      const barPct = Math.min(pct, 100);
      const barColor = pct >= 100 ? 'red' : pct >= 75 ? 'amber' : 'green';
      const estLabel =
        entry.timeEstimate > 0
          ? `${formatDuration(entry.totalTimeSpent)} / ${formatDuration(entry.timeEstimate)} (${pct}%)`
          : 'No estimate';

      const labelsHtml =
        entry.labels.length > 0
          ? entry.labels.map((l) => labelBadge(l)).join(' ')
          : '<span class="label-badge" style="background:rgba(255,255,255,0.06);color:#5c6078;border:1px solid rgba(255,255,255,0.06)">none</span>';

      html += `<tr class="issue-row">
        <td>
          <a class="issue-link" href="${entry.issueUrl}" target="_blank">
            <span class="issue-iid">#${entry.issueIid}</span>${escapeHtml(entry.issueTitle)}
          </a>
          ${entry.projectName ? `<div class="issue-project">${escapeHtml(entry.projectName)}</div>` : ''}
        </td>
        <td class="status-cell">${labelsHtml}</td>
        <td></td>
        <td class="bar-cell">
          <div class="progress-bar-track">
            <div class="progress-bar-fill ${barColor}" style="width:${barPct}%"></div>
          </div>
          <div class="progress-label">${estLabel}</div>
        </td>
        <td class="time-cell">${formatDuration(entry.timeSpent)}</td>
      </tr>`;

      // ── Sub-rows: individual timelogs for this issue ──
      const issueLogs = timelogsByIssue.get(entry.issueUrl) || [];
      for (const log of issueLogs) {
        const logDateStr = getDateFromSpentAt(log.spentAt);
        const parts = logDateStr.split('-');
        const logDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        const dateLabel = formatDayDate(logDate);
        const inRange = !filterDate || logDateStr === filterDate;
        const dimClass = inRange ? '' : ' timelog-dim';

        html += `<tr class="timelog-row${dimClass}" data-timelog-id="${log.id}">
          <td class="timelog-desc-cell" colspan="2">
            <span class="timelog-indent"></span>
            <span class="timelog-summary-display" data-timelog-id="${log.id}">${log.note ? escapeHtml(log.note) : '<span class="text-muted">No description</span>'}</span>
          </td>
          <td class="date-cell timelog-editable-cell">
            <span class="timelog-field-display timelog-date-display" data-timelog-id="${log.id}">${dateLabel}</span>
          </td>
          <td></td>
          <td class="time-cell timelog-editable-cell">
            <span class="timelog-field-display timelog-duration-display" data-timelog-id="${log.id}">${formatDuration(log.timeSpent)}</span>
          </td>
        </tr>`;
      }

      // ── Add new timelog row ──
      const firstLog = issueLogs[0];
      const issueGid = firstLog?.issueGid || '';
      if (issueGid) {
        html += `<tr class="timelog-row timelog-add-row">
          <td colspan="5">
            <span class="timelog-indent"></span>
            <button class="timelog-add-btn" data-issue-gid="${issueGid}" data-issue-url="${entry.issueUrl}">+ Add time log</button>
          </td>
        </tr>`;
      }
    }

    html += `</tbody></table>`;
    html += bottomSectionsHtml;
  }

  content.innerHTML = html;

  content.querySelectorAll('.day-card').forEach((card) => {
    card.addEventListener('click', () => {
      const dateKey = (card as HTMLElement).dataset.date || null;
      if (activeFilterDate === dateKey) {
        activeFilterDate = null;
      } else {
        activeFilterDate = dateKey;
      }
      renderWeek(cachedEntries, cachedDays, activeFilterDate);
    });
  });

  const clearBtn = document.getElementById('clearFilter');
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      activeFilterDate = null;
      renderWeek(cachedEntries, cachedDays, null);
    });
  }

  // ── Inline editing for timelog fields ──
  function startEdit(
    displayEl: HTMLElement,
    log: TimelogDetail,
    field: 'summary' | 'date' | 'duration'
  ) {
    const cell = displayEl.closest('td')!;
    if (cell.querySelector('.timelog-inline-input')) return;

    displayEl.style.display = 'none';

    const input = document.createElement('input');
    input.className = 'timelog-inline-input';

    if (field === 'date') {
      input.type = 'date';
      input.value = getDateFromSpentAt(log.spentAt);
    } else if (field === 'duration') {
      input.type = 'text';
      input.value = formatDurationInput(log.timeSpent);
      input.placeholder = '1h30m';
    } else {
      input.type = 'text';
      input.value = log.note;
      input.placeholder = 'Description...';
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'timelog-edit-wrapper';
    wrapper.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'timelog-edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'timelog-save-btn';
    saveBtn.textContent = 'Save';
    actions.appendChild(saveBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'timelog-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    actions.appendChild(cancelBtn);

    wrapper.appendChild(actions);
    cell.appendChild(wrapper);
    input.focus();
    if (field !== 'date') input.select();

    function cancel() {
      wrapper.remove();
      displayEl.style.display = '';
    }

    async function save() {
      const val = input.value.trim();

      if (field === 'date') {
        if (!val || val === getDateFromSpentAt(log.spentAt)) {
          cancel();
          return;
        }
      } else if (field === 'duration') {
        if (!val) {
          cancel();
          return;
        }
      } else {
        if (val === log.note) {
          cancel();
          return;
        }
      }

      input.disabled = true;
      saveBtn.disabled = true;
      saveBtn.textContent = '...';

      try {
        const newDate = field === 'date' ? val : getDateFromSpentAt(log.spentAt);
        const newDuration = field === 'duration' ? val : formatDurationInput(log.timeSpent);
        const newNote = field === 'summary' ? val : log.note;

        await deleteTimelog(log.id);
        await createTimelog(log.issueGid, newDuration, newDate, newNote);
        await loadWeek();
      } catch (err: any) {
        alert(`Failed to save: ${err.message}`);
        cancel();
      }
    }

    cancelBtn.addEventListener('click', cancel);
    saveBtn.addEventListener('click', save);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') cancel();
      if (ev.key === 'Enter') save();
    });
  }

  content.querySelectorAll('.timelog-summary-display').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.timelogId!;
      const log = cachedTimelogs.find((t) => t.id === id);
      if (log) startEdit(el as HTMLElement, log, 'summary');
    });
  });

  content.querySelectorAll('.timelog-date-display').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.timelogId!;
      const log = cachedTimelogs.find((t) => t.id === id);
      if (log) startEdit(el as HTMLElement, log, 'date');
    });
  });

  content.querySelectorAll('.timelog-duration-display').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.timelogId!;
      const log = cachedTimelogs.find((t) => t.id === id);
      if (log) startEdit(el as HTMLElement, log, 'duration');
    });
  });

  // ── Add new timelog ──
  content.querySelectorAll('.timelog-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const addBtn = btn as HTMLElement;
      const issueGid = addBtn.dataset.issueGid!;
      const row = addBtn.closest('tr')!;

      // Already has a form?
      if (row.querySelector('.timelog-add-form')) return;

      addBtn.style.display = 'none';

      const form = document.createElement('div');
      form.className = 'timelog-add-form';

      const descInput = document.createElement('input');
      descInput.type = 'text';
      descInput.className = 'timelog-inline-input';
      descInput.placeholder = 'Description...';
      descInput.style.maxWidth = '220px';

      const dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.className = 'timelog-inline-input';
      dateInput.value = activeFilterDate || localDateStr(new Date());
      dateInput.style.maxWidth = '140px';

      const durInput = document.createElement('input');
      durInput.type = 'text';
      durInput.className = 'timelog-inline-input';
      durInput.placeholder = '1h30m';
      durInput.style.maxWidth = '80px';

      const actions = document.createElement('div');
      actions.className = 'timelog-edit-actions';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'timelog-save-btn';
      saveBtn.textContent = 'Save';
      actions.appendChild(saveBtn);

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'timelog-cancel-btn';
      cancelBtn.textContent = 'Cancel';
      actions.appendChild(cancelBtn);

      form.appendChild(descInput);
      form.appendChild(dateInput);
      form.appendChild(durInput);
      form.appendChild(actions);

      const cell = row.querySelector('td')!;
      cell.appendChild(form);
      descInput.focus();

      function cancel() {
        form.remove();
        addBtn.style.display = '';
      }

      async function save() {
        const duration = durInput.value.trim();
        const date = dateInput.value;
        const note = descInput.value.trim();

        if (!duration || !date) {
          if (!duration) durInput.style.borderColor = 'var(--red)';
          if (!date) dateInput.style.borderColor = 'var(--red)';
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = '...';
        descInput.disabled = true;
        dateInput.disabled = true;
        durInput.disabled = true;

        try {
          await createTimelog(issueGid, duration, date, note);
          await loadWeek();
        } catch (err: any) {
          alert(`Failed to add time log: ${err.message}`);
          cancel();
        }
      }

      cancelBtn.addEventListener('click', cancel);
      saveBtn.addEventListener('click', save);
      [descInput, dateInput, durInput].forEach((input) => {
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Escape') cancel();
          if (ev.key === 'Enter') save();
        });
      });
    });
  });
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Calendar Week View ──

interface CalBlock {
  log: TimelogDetail;
  startMinutes: number;
  endMinutes: number;
  top: number;
  height: number;
  left: number;
  width: number;
}

const CAL_PX_PER_HOUR = 80;

function computeGridRange(_timelogs: TimelogDetail[]): { startHour: number; endHour: number } {
  return { startHour: 0, endHour: 24 };
}

function computeBlockPositions(
  logs: TimelogDetail[],
  gridStartHour: number,
  gridEndHour: number
): CalBlock[] {
  const blocks: CalBlock[] = [];

  for (const log of logs) {
    const time = parseTimeFromISO(log.spentAt);
    const startMinutes = time.hours * 60 + time.minutes;
    const durationMinutes = Math.max(log.timeSpent / 60, 15);
    const endMinutes = startMinutes + durationMinutes;

    const startHourDecimal = startMinutes / 60;
    const durationHours = durationMinutes / 60;

    let top = Math.max(0, (startHourDecimal - gridStartHour) * CAL_PX_PER_HOUR);
    let height = Math.max(20, durationHours * CAL_PX_PER_HOUR);

    const maxBottom = (gridEndHour - gridStartHour) * CAL_PX_PER_HOUR;
    if (top + height > maxBottom) height = maxBottom - top;

    blocks.push({ log, startMinutes, endMinutes, top, height, left: 0, width: 100 });
  }

  blocks.sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);

  // Find overlap groups (connected components of overlapping blocks)
  const groups: CalBlock[][] = [];
  let currentGroup: CalBlock[] = [];
  let groupEnd = -1;

  for (const block of blocks) {
    if (currentGroup.length === 0 || block.startMinutes < groupEnd) {
      currentGroup.push(block);
      groupEnd = Math.max(groupEnd, block.endMinutes);
    } else {
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [block];
      groupEnd = block.endMinutes;
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  // Within each group, assign columns only to blocks that actually overlap
  for (const group of groups) {
    if (group.length === 1) {
      group[0].left = 1;
      group[0].width = 98;
      continue;
    }

    const columns: CalBlock[][] = [];
    for (const block of group) {
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        const lastInCol = columns[c][columns[c].length - 1];
        if (lastInCol.endMinutes <= block.startMinutes) {
          columns[c].push(block);
          placed = true;
          break;
        }
      }
      if (!placed) columns.push([block]);
    }

    const numCols = columns.length;
    const colWidth = 100 / numCols;
    for (let c = 0; c < columns.length; c++) {
      for (const block of columns[c]) {
        block.left = c * colWidth + 1;
        block.width = colWidth - 2;
      }
    }
  }

  return blocks;
}

function renderCalendarWeek(days: Date[], timelogs: TimelogDetail[], entries: WeeklyTimelog[]) {
  const content = $('weekContent');

  // Compute dynamic grid range from data
  const { startHour: gridStartHour, endHour: gridEndHour } = computeGridRange(timelogs);
  const totalHeight = (gridEndHour - gridStartHour) * CAL_PX_PER_HOUR;

  // Group timelogs by date
  const byDate = new Map<string, TimelogDetail[]>();
  for (const log of timelogs) {
    const dateKey = getDateFromSpentAt(log.spentAt);
    const list = byDate.get(dateKey) || [];
    list.push(log);
    byDate.set(dateKey, list);
  }

  // Time labels
  let timeLabelsHtml = '';
  for (let h = gridStartHour; h <= gridEndHour; h++) {
    const label = `${String(h).padStart(2, '0')}:00`;
    timeLabelsHtml += `<div class="cal-time-label" style="top:${(h - gridStartHour) * CAL_PX_PER_HOUR}px">${label}</div>`;
  }

  const visibleDays = hideWeekends ? days.slice(0, 5) : days;
  const dayCols = hideWeekends ? 5 : 7;

  // Day headers & columns
  let dayHeadersHtml = '<div class="cal-time-header"></div>';
  let dayColumnsHtml = '';

  visibleDays.forEach((d, i) => {
    const dateKey = localDateStr(d);
    const todayClass = isToday(d) ? ' cal-today' : '';
    const weekendClass = !hideWeekends && i >= 5 ? ' cal-weekend' : '';
    const dayLogs = byDate.get(dateKey) || [];
    const dayTotal = dayLogs.reduce((sum, l) => sum + l.timeSpent, 0);

    dayHeadersHtml += `<div class="cal-day-header${todayClass}${weekendClass}">
      <div class="cal-day-name">${DAY_NAMES[i]}</div>
      <div class="cal-day-date">${formatShortDate(d)}</div>
      <div class="cal-day-total">${dayTotal > 0 ? formatDuration(dayTotal) : ''}</div>
    </div>`;

    // Block rendering
    const blocks = computeBlockPositions(dayLogs, gridStartHour, gridEndHour);
    let blocksHtml = '';
    for (const block of blocks) {
      const color = getProjectColor(block.log.projectName);
      const tooltipText = `${block.log.issueTitle} — ${block.log.projectName}\n${formatDuration(block.log.timeSpent)}${block.log.note ? '\n' + block.log.note : ''}`;
      blocksHtml += `<div class="cal-block"
        data-timelog-id="${block.log.id}"
        style="top:${block.top}px;height:${block.height}px;left:${block.left}%;width:${block.width}%;background:${color}20;border-left:3px solid ${color}"
        title="${escapeHtml(tooltipText).replace(/\n/g, '&#10;')}">
        <div class="cal-block-meta"><span class="cal-block-duration">${formatDuration(block.log.timeSpent)}</span>${block.height > 30 ? ` · ${escapeHtml(block.log.projectName)}` : ''}</div>
        <div class="cal-block-title">${escapeHtml(block.log.issueTitle)}</div>
        ${block.log.note && block.height > 40 ? `<div class="cal-block-note">${escapeHtml(block.log.note)}</div>` : ''}
        <div class="cal-block-resize-handle"></div>
      </div>`;
    }

    // Grid lines
    let gridLinesHtml = '';
    for (let h = gridStartHour; h < gridEndHour; h++) {
      gridLinesHtml += `<div class="cal-grid-line" style="top:${(h - gridStartHour) * CAL_PX_PER_HOUR}px"></div>`;
      gridLinesHtml += `<div class="cal-grid-line cal-grid-line-half" style="top:${(h - gridStartHour) * CAL_PX_PER_HOUR + CAL_PX_PER_HOUR / 2}px"></div>`;
    }
    // Bottom line
    gridLinesHtml += `<div class="cal-grid-line" style="top:${totalHeight}px"></div>`;

    // Current-time indicator
    let nowIndicator = '';
    if (isToday(d)) {
      const now = new Date();
      const nowHours = now.getHours() + now.getMinutes() / 60;
      if (nowHours >= gridStartHour && nowHours <= gridEndHour) {
        const nowTop = (nowHours - gridStartHour) * CAL_PX_PER_HOUR;
        nowIndicator = `<div class="cal-now-line" style="top:${nowTop}px"></div>`;
      }
    }

    dayColumnsHtml += `<div class="cal-day-column${todayClass}${weekendClass}" data-date="${dateKey}" style="height:${totalHeight}px">
      ${gridLinesHtml}
      ${nowIndicator}
      ${blocksHtml}
    </div>`;
  });

  // Week total
  const weekTotal = timelogs.reduce((sum, l) => sum + l.timeSpent, 0);

  let html = `
    <div class="cal-week-total">
      <label class="cal-weekend-toggle">
        <input type="checkbox" id="hideWeekendsCheck" ${hideWeekends ? 'checked' : ''}>
        <span>Hide weekends</span>
      </label>
      <span style="flex:1"></span>
      <span class="week-total-label">Week Total</span>
      <span class="week-total-value">${formatDuration(weekTotal)}</span>
    </div>
    <div class="cal-grid-wrapper">
      <div class="cal-header-row" style="grid-template-columns:60px repeat(${dayCols},1fr)">${dayHeadersHtml}</div>
      <div class="cal-body">
        <div class="cal-time-column" style="height:${totalHeight}px">${timeLabelsHtml}</div>
        <div class="cal-days-container" style="grid-template-columns:repeat(${dayCols},1fr)">${dayColumnsHtml}</div>
      </div>
    </div>
  `;

  // Breakdown sections (reuse from entries)
  html += renderBreakdownSections(entries, null);

  content.innerHTML = html;

  // Attach calendar interactions
  attachCalendarInteractions(content, gridStartHour);

  // Weekend toggle
  const weekendCheck = document.getElementById('hideWeekendsCheck');
  if (weekendCheck) {
    weekendCheck.addEventListener('change', () => {
      hideWeekends = (weekendCheck as HTMLInputElement).checked;
      chrome.storage.sync.set({ hideWeekends });
      renderCalendarWeek(days, timelogs, entries);
    });
  }
}

function renderBreakdownSections(
  displayEntries: WeeklyTimelog[],
  filterDate: string | null
): string {
  let filtered = displayEntries;
  if (filterDate) {
    filtered = displayEntries
      .filter((e) => (e.dailySpent[filterDate] || 0) > 0)
      .map((e) => ({ ...e, timeSpent: e.dailySpent[filterDate] || 0 }))
      .sort((a, b) => b.timeSpent - a.timeSpent);
  }

  if (filtered.length === 0) return '';

  let html = '';
  const byProject = new Map<string, number>();
  const byLabel = new Map<string, number>();

  for (const e of filtered) {
    const pName = e.projectName || 'Unknown';
    byProject.set(pName, (byProject.get(pName) || 0) + e.timeSpent);
    for (const l of e.labels) {
      byLabel.set(l, (byLabel.get(l) || 0) + e.timeSpent);
    }
    if (e.labels.length === 0) {
      byLabel.set('none', (byLabel.get('none') || 0) + e.timeSpent);
    }
  }

  function renderBreakdown(
    title: string,
    data: Map<string, number>,
    colorFn: (name: string, i: number) => string
  ): string {
    const sorted = Array.from(data.entries()).sort((a, b) => b[1] - a[1]);
    const max = sorted[0]?.[1] || 1;
    let s = `<div class="breakdown-section-title">${title}</div>`;
    for (let i = 0; i < sorted.length; i++) {
      const [name, seconds] = sorted[i];
      const pct = (seconds / max) * 100;
      const color = colorFn(name, i);
      s += `
        <div class="breakdown-item">
          <span class="breakdown-dot" style="background:${color}"></span>
          <span class="breakdown-name">${escapeHtml(name)}</span>
          <div class="breakdown-bar-wrap">
            <div class="breakdown-bar-track">
              <div class="breakdown-bar-fill" style="width:${pct}%;background:${color}"></div>
            </div>
          </div>
          <span class="breakdown-time">${formatDuration(seconds)}</span>
        </div>`;
    }
    return s;
  }

  html += `<div class="breakdown-row" style="margin-top: 22px;">`;
  html +=
    `<div>` +
    renderBreakdown(
      'By Project',
      byProject,
      (_name, i) => currentColors.projectPalette[i % currentColors.projectPalette.length]
    ) +
    `</div>`;
  html +=
    `<div>` +
    renderBreakdown('By Label', byLabel, (name, i) => {
      const lower = name.toLowerCase();
      const lc = LABEL_COLORS[lower];
      if (lc) return lc.fg;
      return currentColors.projectPalette[(i + 3) % currentColors.projectPalette.length];
    }) +
    `</div>`;
  html += `</div>`;

  return html;
}

// ── Calendar Interactions (drag, resize, click) ──

function attachCalendarInteractions(container: HTMLElement, gridStartHour: number) {
  const snapPx = CAL_PX_PER_HOUR / 4; // 15-min snap

  function snapToGrid(value: number): number {
    return Math.round(value / snapPx) * snapPx;
  }

  function pxToTimeStr(px: number): string {
    const totalMinutes = Math.round((px / CAL_PX_PER_HOUR) * 60) + gridStartHour * 60;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  function pxToDurationSeconds(px: number): number {
    const raw = Math.round((px / CAL_PX_PER_HOUR) * 3600);
    return Math.max(900, Math.round(raw / 900) * 900); // min 15min, snap 15min
  }

  let dragState: {
    type: 'move' | 'resize';
    block: HTMLElement;
    logId: string;
    startX: number;
    startY: number;
    originalTop: number;
    originalHeight: number;
    mouseOffsetInBlock: number;
    targetDayColumn: HTMLElement;
    hasMoved: boolean;
  } | null = null;

  // Survives past mouseup so the click handler (which fires after mouseup) can check it.
  let justFinishedDrag = false;

  container.addEventListener('mousedown', (e) => {
    const target = e.target as HTMLElement;
    const block = target.closest('.cal-block') as HTMLElement;
    if (!block) return;

    const resizeHandle = target.closest('.cal-block-resize-handle');
    const dayColumn = block.closest('.cal-day-column') as HTMLElement;

    e.preventDefault();

    dragState = {
      type: resizeHandle ? 'resize' : 'move',
      block,
      logId: block.dataset.timelogId!,
      startX: e.clientX,
      startY: e.clientY,
      originalTop: block.offsetTop,
      originalHeight: block.offsetHeight,
      mouseOffsetInBlock: e.clientY - block.getBoundingClientRect().top,
      targetDayColumn: dayColumn,
      hasMoved: false,
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragState) return;

      const dx = ev.clientX - dragState.startX;
      const dy = ev.clientY - dragState.startY;

      if (!dragState.hasMoved && Math.abs(dx) + Math.abs(dy) < 5) return;
      dragState.hasMoved = true;

      document.body.style.userSelect = 'none';

      if (dragState.type === 'move') {
        const colRect = dragState.targetDayColumn.getBoundingClientRect();
        const newTop = snapToGrid(Math.max(0, ev.clientY - colRect.top - dragState.mouseOffsetInBlock));
        dragState.block.style.top = `${newTop}px`;
        dragState.block.classList.add('cal-dragging');
        document.body.style.cursor = 'grabbing';

        container.querySelectorAll('.cal-day-column').forEach((col) => {
          const rect = col.getBoundingClientRect();
          if (ev.clientX >= rect.left && ev.clientX <= rect.right) {
            (col as HTMLElement).style.background = 'var(--accent-dim)';
            dragState!.targetDayColumn = col as HTMLElement;
          } else {
            (col as HTMLElement).style.background = '';
          }
        });
      } else {
        document.body.style.cursor = 'ns-resize';
        const newHeight = snapToGrid(Math.max(snapPx, dragState.originalHeight + dy));
        dragState.block.style.height = `${newHeight}px`;

        const duration = pxToDurationSeconds(newHeight);
        const durationEl = dragState.block.querySelector('.cal-block-duration');
        if (durationEl) durationEl.textContent = formatDuration(duration);
      }
    };

    const onMouseUp = async () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (!dragState) return;
      const state = dragState;
      dragState = null;

      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      state.block.classList.remove('cal-dragging');

      container.querySelectorAll('.cal-day-column').forEach((col) => {
        (col as HTMLElement).style.background = '';
      });

      if (!state.hasMoved) return;

      // Set flag so the click event (which fires right after mouseup) won't open a popover.
      justFinishedDrag = true;
      setTimeout(() => {
        justFinishedDrag = false;
      }, 0);

      const log = cachedTimelogs.find((t) => t.id === state.logId);
      if (!log) return;

      if (state.type === 'move') {
        const newTop = snapToGrid(parseFloat(state.block.style.top));
        const timeStr = pxToTimeStr(newTop);
        const targetDate = state.targetDayColumn.dataset.date!;
        const newSpentAt = `${targetDate}T${timeStr}:00`;

        const oldDate = getDateFromSpentAt(log.spentAt);
        const oldTime = parseTimeFromISO(log.spentAt);
        const oldTimeStr = `${String(oldTime.hours).padStart(2, '0')}:${String(oldTime.minutes).padStart(2, '0')}`;
        if (targetDate === oldDate && timeStr === oldTimeStr) return;

        // Optimistic update: move the block in the DOM to the target column immediately
        // and update cached data so re-render shows the block in its new position.
        const oldSpentAt = log.spentAt;
        log.spentAt = newSpentAt;
        state.block.style.opacity = '1';

        // If moved to a different day, relocate the DOM element
        if (targetDate !== oldDate) {
          state.targetDayColumn.appendChild(state.block);
        }

        // Fire-and-forget: API call + background sync
        performMutation(async () => {
          await deleteTimelog(log.id);
          await createTimelog(
            log.issueGid,
            formatDurationInput(log.timeSpent),
            newSpentAt,
            log.note
          );
        }).then(async (ok) => {
          if (!ok) {
            // Revert optimistic update on failure
            log.spentAt = oldSpentAt;
          }
          await silentRefresh();
        });
      } else {
        const newHeight = snapToGrid(parseFloat(state.block.style.height));
        const newDuration = pxToDurationSeconds(newHeight);
        if (newDuration === log.timeSpent) return;

        // Optimistic update: keep the resized height visible
        const oldTimeSpent = log.timeSpent;
        log.timeSpent = newDuration;
        state.block.style.opacity = '1';

        performMutation(async () => {
          await deleteTimelog(log.id);
          await createTimelog(
            log.issueGid,
            formatDurationInput(newDuration),
            getDateFromSpentAt(log.spentAt),
            log.note
          );
        }).then(async (ok) => {
          if (!ok) {
            log.timeSpent = oldTimeSpent;
          }
          await silentRefresh();
        });
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // Click on block → edit popover
  container.querySelectorAll('.cal-block').forEach((block) => {
    block.addEventListener('click', (ev) => {
      if (justFinishedDrag) return;
      const e = ev as MouseEvent;
      e.stopPropagation();
      const logId = (block as HTMLElement).dataset.timelogId!;
      const log = cachedTimelogs.find((t) => t.id === logId);
      if (log) showEditPopover(e.clientX, e.clientY, log);
    });
  });

  // Click on empty space → add popover
  container.querySelectorAll('.cal-day-column').forEach((col) => {
    col.addEventListener('click', (ev) => {
      if (justFinishedDrag) return;
      const e = ev as MouseEvent;
      const target = e.target as HTMLElement;
      if (target.closest('.cal-block')) return;

      const rect = (col as HTMLElement).getBoundingClientRect();
      const y = e.clientY - rect.top + (col.closest('.cal-body') as HTMLElement).scrollTop;
      const snappedY = snapToGrid(y);
      const timeStr = pxToTimeStr(snappedY);
      const date = (col as HTMLElement).dataset.date!;
      showAddPopover(e.clientX, e.clientY, date, timeStr);
    });
  });
}

// ── Popovers ──

function closeAllPopovers() {
  document.querySelectorAll('.cal-popover, .cal-popover-overlay').forEach((el) => el.remove());
}

function positionPopover(popover: HTMLElement, x: number, y: number) {
  popover.style.left = `${x}px`;
  popover.style.top = `${y}px`;
  requestAnimationFrame(() => {
    const rect = popover.getBoundingClientRect();
    if (rect.right > window.innerWidth - 10) {
      popover.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight - 10) {
      popover.style.top = `${y - rect.height}px`;
    }
  });
}

function formatTimeFromISO(iso: string): string {
  const t = parseTimeFromISO(iso);
  return `${String(t.hours).padStart(2, '0')}:${String(t.minutes).padStart(2, '0')}`;
}

function showEditPopover(x: number, y: number, log: TimelogDetail) {
  closeAllPopovers();

  const overlay = document.createElement('div');
  overlay.className = 'cal-popover-overlay';
  document.body.appendChild(overlay);

  const timeStr = formatTimeFromISO(log.spentAt);
  const useTextarea = log.note.length > 40;

  const popover = document.createElement('div');
  popover.className = 'cal-popover';
  popover.innerHTML = `
    <div class="cal-popover-title">#${log.issueIid} ${escapeHtml(log.issueTitle)}</div>
    <div class="form-row">
      <label class="form-label">Duration</label>
      <input class="form-input" type="text" id="popDuration" value="${formatDurationInput(log.timeSpent)}" placeholder="1h30m" style="max-width:100%">
    </div>
    <div class="form-row" style="display:flex;gap:10px">
      <div style="flex:1">
        <label class="form-label">Date</label>
        <input class="form-input" type="date" id="popDate" value="${getDateFromSpentAt(log.spentAt)}" style="max-width:100%;color-scheme:dark">
      </div>
      <div style="flex:1">
        <label class="form-label">Time</label>
        <input class="form-input" type="time" id="popTime" value="${timeStr}" style="max-width:100%;color-scheme:dark">
      </div>
    </div>
    <div class="form-row">
      <label class="form-label">Note</label>
      ${
        useTextarea
          ? `<textarea class="form-input" id="popNote" placeholder="Description..." style="max-width:100%;min-height:60px;resize:vertical">${escapeHtml(log.note)}</textarea>`
          : `<input class="form-input" type="text" id="popNote" value="${escapeHtml(log.note)}" placeholder="Description..." style="max-width:100%">`
      }
    </div>
    <div class="cal-popover-actions">
      <button class="timelog-cancel-btn" id="popDelete" style="color:var(--red);border-color:rgba(248,113,113,0.3)">Delete</button>
      <span style="flex:1"></span>
      <button class="timelog-cancel-btn" id="popCancel">Cancel</button>
      <button class="timelog-save-btn" id="popSave">Save</button>
    </div>
  `;

  document.body.appendChild(popover);
  positionPopover(popover, x, y);

  overlay.addEventListener('click', closeAllPopovers);
  popover.querySelector('#popCancel')!.addEventListener('click', closeAllPopovers);

  popover.querySelector('#popDelete')!.addEventListener('click', async () => {
    if (!confirm('Delete this time log?')) return;
    closeAllPopovers();
    const ok = await performMutation(async () => {
      await deleteTimelog(log.id);
    });
    if (ok) await silentRefresh();
    else await silentRefresh();
  });

  popover.querySelector('#popSave')!.addEventListener('click', async () => {
    const duration = (popover.querySelector('#popDuration') as HTMLInputElement).value.trim();
    const date = (popover.querySelector('#popDate') as HTMLInputElement).value;
    const time = (popover.querySelector('#popTime') as HTMLInputElement).value;
    const noteEl = popover.querySelector('#popNote') as HTMLInputElement | HTMLTextAreaElement;
    const note = noteEl.value.trim();
    if (!duration || !date) return;

    const saveBtn = popover.querySelector('#popSave') as HTMLButtonElement;
    saveBtn.disabled = true;
    saveBtn.textContent = '...';

    const spentAt = time ? `${date}T${time}:00` : date;
    closeAllPopovers();
    const ok = await performMutation(async () => {
      await deleteTimelog(log.id);
      await createTimelog(log.issueGid, duration, spentAt, note);
    });
    if (ok) await silentRefresh();
    else {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      await silentRefresh();
    }
  });

  popover.querySelectorAll('input, textarea').forEach((el) => {
    el.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Escape') closeAllPopovers();
      if ((ev as KeyboardEvent).key === 'Enter' && el.tagName !== 'TEXTAREA')
        (popover.querySelector('#popSave') as HTMLElement).click();
    });
  });
}

async function searchAssignedIssues(
  query: string
): Promise<{ gid: string; title: string; iid: number; projectName: string }[]> {
  if (!gitlabUrl || !apiToken || query.length < 2) return [];
  try {
    const params = new URLSearchParams({
      scope: 'assigned_to_me',
      search: query,
      state: 'opened',
      per_page: '15',
    });
    const res = await fetch(`${gitlabUrl}/api/v4/issues?${params}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((issue: any) => ({
      gid: `gid://gitlab/Issue/${issue.id}`,
      title: issue.title,
      iid: issue.iid,
      projectName: (issue.references?.full ?? '').split('#')[0].replace(/\/$/, '') || String(issue.project_id),
    }));
  } catch {
    return [];
  }
}

function showAddPopover(x: number, y: number, date: string, time: string) {
  closeAllPopovers();

  // Build initial issue list from cached timelogs (deduplicated, sorted by recency)
  const seen = new Set<string>();
  const cachedIssues: { gid: string; title: string; iid: number; projectName: string }[] = [];
  for (const log of [...cachedTimelogs].reverse()) {
    if (!seen.has(log.issueGid)) {
      seen.add(log.issueGid);
      cachedIssues.push({ gid: log.issueGid, title: log.issueTitle, iid: log.issueIid, projectName: log.projectName });
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'cal-popover-overlay';
  document.body.appendChild(overlay);

  const popover = document.createElement('div');
  popover.className = 'cal-popover';
  popover.innerHTML = `
    <div class="cal-popover-title">Add Time Log</div>
    <div class="form-row">
      <label class="form-label">Issue</label>
      <div class="issue-search-wrapper">
        <input class="form-input" type="text" id="popIssueSearch" placeholder="Search issues…" autocomplete="off" style="max-width:100%">
        <input type="hidden" id="popIssueGid">
        <div class="issue-search-dropdown" id="popIssueDropdown"></div>
      </div>
    </div>
    <div class="form-row">
      <label class="form-label">Duration</label>
      <input class="form-input" type="text" id="popDuration" placeholder="1h30m" style="max-width:100%">
    </div>
    <div class="form-row">
      <label class="form-label">Date</label>
      <input class="form-input" type="date" id="popDate" value="${date}" style="max-width:100%;color-scheme:dark">
    </div>
    <div class="form-row">
      <label class="form-label">Note</label>
      <input class="form-input" type="text" id="popNote" placeholder="Description..." style="max-width:100%">
    </div>
    <div class="cal-popover-actions">
      <button class="timelog-cancel-btn" id="popCancel">Cancel</button>
      <button class="timelog-save-btn" id="popSave">Save</button>
    </div>
  `;

  document.body.appendChild(popover);
  positionPopover(popover, x, y);

  const issueSearchInput = popover.querySelector('#popIssueSearch') as HTMLInputElement;
  const issueGidInput = popover.querySelector('#popIssueGid') as HTMLInputElement;
  const dropdown = popover.querySelector('#popIssueDropdown') as HTMLDivElement;

  // All issues available for search (starts with cached, API results merged in)
  let allIssues = [...cachedIssues];
  let activeIndex = -1;
  let searchDebounce: ReturnType<typeof setTimeout> | null = null;

  function getFilteredIssues(query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return allIssues.slice(0, 12);
    return allIssues
      .filter((iss) => iss.title.toLowerCase().includes(q) || String(iss.iid).includes(q))
      .slice(0, 12);
  }

  function renderDropdown(items: typeof allIssues) {
    activeIndex = -1;
    if (items.length === 0) {
      dropdown.innerHTML = `<div class="issue-search-empty">No issues found</div>`;
    } else {
      dropdown.innerHTML = items
        .map(
          (iss) =>
            `<div class="issue-search-item" data-gid="${iss.gid}">#${iss.iid} ${escapeHtml(iss.title)}</div>`
        )
        .join('');
      dropdown.querySelectorAll('.issue-search-item').forEach((item) => {
        item.addEventListener('mousedown', (ev) => {
          ev.preventDefault(); // prevent blur on search input
          selectIssue((item as HTMLElement).dataset.gid!);
        });
      });
    }
    dropdown.classList.add('visible');
  }

  function selectIssue(gid: string) {
    const iss = allIssues.find((i) => i.gid === gid);
    if (iss) {
      issueSearchInput.value = `#${iss.iid} ${iss.title}`;
      issueGidInput.value = gid;
    }
    dropdown.classList.remove('visible');
    activeIndex = -1;
  }

  issueSearchInput.addEventListener('focus', () => {
    renderDropdown(getFilteredIssues(issueSearchInput.value));
  });

  issueSearchInput.addEventListener('input', () => {
    issueGidInput.value = '';
    const query = issueSearchInput.value;
    renderDropdown(getFilteredIssues(query));

    // Debounced API search to supplement cached results
    if (searchDebounce) clearTimeout(searchDebounce);
    if (query.trim().length >= 2) {
      searchDebounce = setTimeout(async () => {
        const apiResults = await searchAssignedIssues(query.trim());
        const existingGids = new Set(allIssues.map((i) => i.gid));
        for (const r of apiResults) {
          if (!existingGids.has(r.gid)) allIssues.push(r);
        }
        renderDropdown(getFilteredIssues(query));
      }, 300);
    }
  });

  issueSearchInput.addEventListener('keydown', (ev) => {
    const items = dropdown.querySelectorAll<HTMLElement>('.issue-search-item[data-gid]');
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
    } else if (ev.key === 'Enter' && activeIndex >= 0) {
      ev.preventDefault();
      const gid = items[activeIndex]?.dataset.gid;
      if (gid) selectIssue(gid);
    } else if (ev.key === 'Escape') {
      dropdown.classList.remove('visible');
    }
  });

  issueSearchInput.addEventListener('blur', () => {
    // Small delay so mousedown on item fires first
    setTimeout(() => dropdown.classList.remove('visible'), 150);
  });

  overlay.addEventListener('click', closeAllPopovers);
  popover.querySelector('#popCancel')!.addEventListener('click', closeAllPopovers);

  popover.querySelector('#popSave')!.addEventListener('click', async () => {
    let issueGid = issueGidInput.value;
    // If no explicit selection, try to match the typed text
    if (!issueGid) {
      const q = issueSearchInput.value.trim().toLowerCase();
      const match = allIssues.find(
        (iss) => iss.title.toLowerCase() === q || `#${iss.iid}` === q
      );
      if (match) {
        issueGid = match.gid;
      } else {
        issueSearchInput.style.borderColor = 'var(--red)';
        return;
      }
    }

    const duration = (popover.querySelector('#popDuration') as HTMLInputElement).value.trim();
    const dateVal = (popover.querySelector('#popDate') as HTMLInputElement).value;
    const note = (popover.querySelector('#popNote') as HTMLInputElement).value.trim();

    if (!duration || !dateVal) {
      if (!duration)
        (popover.querySelector('#popDuration') as HTMLElement).style.borderColor = 'var(--red)';
      if (!dateVal)
        (popover.querySelector('#popDate') as HTMLElement).style.borderColor = 'var(--red)';
      return;
    }

    const saveBtn = popover.querySelector('#popSave') as HTMLButtonElement;
    saveBtn.disabled = true;
    saveBtn.textContent = '...';

    const spentAt = time ? `${dateVal}T${time}:00` : dateVal;
    closeAllPopovers();
    const ok = await performMutation(async () => {
      await createTimelog(issueGid, duration, spentAt, note);
    });
    if (ok) await silentRefresh();
    else {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      await silentRefresh();
    }
  });

  popover.querySelectorAll<HTMLInputElement>('#popDuration, #popDate, #popNote').forEach((input) => {
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') closeAllPopovers();
      if (ev.key === 'Enter') (popover.querySelector('#popSave') as HTMLElement).click();
    });
  });

  issueSearchInput.focus();
}

// ── Calendar Month View ──

function getMonthDates(offset: number): {
  year: number;
  month: number;
  days: Date[];
  start: Date;
  end: Date;
} {
  const now = new Date();
  const targetMonth = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const year = targetMonth.getFullYear();
  const month = targetMonth.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Monday before or on first day
  const startDow = firstDay.getDay();
  const startOff = startDow === 0 ? -6 : 1 - startDow;
  const gridStart = new Date(year, month, 1 + startOff);

  // Sunday after or on last day
  const endDow = lastDay.getDay();
  const endOff = endDow === 0 ? 0 : 7 - endDow;
  const gridEnd = new Date(year, month + 1, endOff);

  const days: Date[] = [];
  const current = new Date(gridStart);
  while (current <= gridEnd) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  while (days.length < 35) {
    const next = new Date(days[days.length - 1]);
    next.setDate(next.getDate() + 1);
    days.push(next);
  }

  return {
    year,
    month,
    days,
    start: gridStart,
    end: new Date(gridEnd.getFullYear(), gridEnd.getMonth(), gridEnd.getDate() + 1),
  };
}

function getWeekOffsetForDate(date: Date): number {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const currentMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOff);

  const targetDow = date.getDay();
  const targetMondayOff = targetDow === 0 ? -6 : 1 - targetDow;
  const targetMonday = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + targetMondayOff
  );

  const diffMs = targetMonday.getTime() - currentMonday.getTime();
  return Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
}

function renderCalendarMonth(
  days: Date[],
  targetMonth: number,
  timelogs: TimelogDetail[],
  entries: WeeklyTimelog[]
) {
  const content = $('weekContent');

  // Group timelogs by date
  const dailyTotals = new Map<string, number>();
  const dailyProjects = new Map<string, Set<string>>();
  for (const log of timelogs) {
    const dateKey = getDateFromSpentAt(log.spentAt);
    dailyTotals.set(dateKey, (dailyTotals.get(dateKey) || 0) + log.timeSpent);
    if (!dailyProjects.has(dateKey)) dailyProjects.set(dateKey, new Set());
    dailyProjects.get(dateKey)!.add(log.projectName);
  }

  let html = `
    <div class="cal-month-grid">
  `;

  // Header row
  for (const name of DAY_NAMES) {
    html += `<div class="cal-month-header-cell">${name}</div>`;
  }

  // Day cells
  for (const d of days) {
    const dateKey = localDateStr(d);
    const todayClass = isToday(d) ? ' cal-today' : '';
    const otherMonth = d.getMonth() !== targetMonth ? ' cal-other-month' : '';
    const total = dailyTotals.get(dateKey) || 0;
    const zeroClass = total === 0 ? ' zero' : '';
    const projects = dailyProjects.get(dateKey) || new Set();

    // Heatmap background
    const hours = total / 3600;
    const alpha = hours > 0 ? Math.min(0.25, hours / 32) : 0;
    const heatBg = alpha > 0 ? `background:rgba(255,135,53,${alpha})` : '';

    let dotsHtml = '';
    for (const proj of projects) {
      const color = getProjectColor(proj);
      dotsHtml += `<div class="cal-month-dot" style="background:${color}" title="${escapeHtml(proj)}"></div>`;
    }

    html += `<div class="cal-month-cell${todayClass}${otherMonth}" data-date="${dateKey}" style="${heatBg}">
      <div class="cal-month-date">${d.getDate()}</div>
      <div class="cal-month-hours${zeroClass}">${hours > 0 ? formatDuration(total) : ''}</div>
      <div class="cal-month-dots">${dotsHtml}</div>
    </div>`;
  }

  html += `</div>`;

  // Breakdown
  html += renderBreakdownSections(entries, null);

  content.innerHTML = html;

  // Click day → switch to week view
  content.querySelectorAll('.cal-month-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const dateKey = (cell as HTMLElement).dataset.date!;
      const parts = dateKey.split('-');
      const clickedDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));

      currentView = 'week';
      weekOffset = getWeekOffsetForDate(clickedDate);
      updateViewToggle();
      loadView();
    });
  });
}

async function loadMonth() {
  const { year, month, days, start, end } = getMonthDates(monthOffset);
  const monthName = new Date(year, month, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  $('weekLabel').textContent = monthName;
  $('weekLabelTotal').textContent = '';

  const content = $('weekContent');
  content.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading monthly data...</div></div>`;

  try {
    const result = await fetchWeekTimelogs(start, end);
    cachedEntries = result.entries;
    cachedTimelogs = result.timelogs;
    const monthTotal = result.timelogs.reduce((sum, l) => sum + l.timeSpent, 0);
    $('weekLabelTotal').textContent = formatDuration(monthTotal);
    renderCalendarMonth(days, month, result.timelogs, result.entries);
  } catch (err: any) {
    content.innerHTML = `<div class="empty-state"><div class="empty-state-text" style="color:var(--red-500)">${escapeHtml(err.message)}</div></div>`;
  }
}

function updateViewToggle() {
  document.querySelectorAll('.view-toggle-btn').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.view === currentView);
  });
}

async function loadView() {
  if (currentView === 'month') {
    await loadMonth();
  } else {
    await loadWeek();
  }
  // Re-render project colors with any newly detected projects
  if (document.getElementById('projectColorGrid')) {
    renderProjectColors();
  }
}

// Silent refresh: re-fetches data and re-renders without showing loading spinner.
// Used after mutations (drag, resize, edit) to avoid the full-page flash.
async function silentRefresh() {
  // Save scroll position before re-render
  const calBody = document.querySelector('.cal-body');
  const scrollTop = calBody ? calBody.scrollTop : 0;

  try {
    if (currentView === 'month') {
      const { month, days, start, end } = getMonthDates(monthOffset);
      const result = await fetchWeekTimelogs(start, end);
      cachedEntries = result.entries;
      cachedTimelogs = result.timelogs;
      renderCalendarMonth(days, month, result.timelogs, result.entries);
    } else {
      const { start, end, days } = getWeekDates(weekOffset);
      cachedDays = days;
      const result = await fetchWeekTimelogs(start, end);
      cachedEntries = result.entries;
      cachedTimelogs = result.timelogs;
      if (currentView === 'week') {
        renderCalendarWeek(days, result.timelogs, result.entries);
      } else {
        renderWeek(cachedEntries, days, activeFilterDate);
      }
    }
  } catch {
    // Silently ignore — user can manually refresh if needed
  }

  // Restore scroll position after re-render
  const newCalBody = document.querySelector('.cal-body');
  if (newCalBody) newCalBody.scrollTop = scrollTop;
}

// Wraps a mutation (delete+create) with concurrency guard.
// Returns true on success, false on failure.
async function performMutation(fn: () => Promise<void>): Promise<boolean> {
  if (operationInProgress) return false;
  operationInProgress = true;
  try {
    await fn();
    return true;
  } catch (err: any) {
    alert(`Operation failed: ${err.message}`);
    return false;
  } finally {
    operationInProgress = false;
  }
}

async function loadWeek() {
  const { start, end, days } = getWeekDates(weekOffset);
  cachedDays = days;
  activeFilterDate = null;
  $('weekLabel').textContent = `${formatShortDate(start)} - ${formatShortDate(days[6])}`;
  $('weekLabelTotal').textContent = '';

  const content = $('weekContent');
  content.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading weekly data...</div></div>`;

  try {
    const result = await fetchWeekTimelogs(start, end);
    cachedEntries = result.entries;
    cachedTimelogs = result.timelogs;
    const weekTotal = result.timelogs.reduce((sum, l) => sum + l.timeSpent, 0);
    $('weekLabelTotal').textContent = formatDuration(weekTotal);
    if (currentView === 'week') {
      renderCalendarWeek(days, result.timelogs, result.entries);
    } else {
      renderWeek(cachedEntries, days, null);
    }
  } catch (err: any) {
    content.innerHTML = `<div class="empty-state"><div class="empty-state-text" style="color:var(--red-500)">${escapeHtml(err.message)}</div></div>`;
  }
}

// ── Color Settings ──

function renderStatusColorPickers() {
  const grid = $('statusColorGrid');
  grid.innerHTML = STATUS_META.map((s) => {
    const isDefault = currentColors[s.key] === DEFAULT_COLORS[s.key];
    return `
    <div class="color-picker-item">
      <input type="color" class="color-picker-swatch" data-color-key="${s.key}" value="${currentColors[s.key]}" title="${s.label}">
      <div>
        <div class="color-picker-label">${s.label}</div>
        <div class="color-picker-desc">${s.description}</div>
      </div>
      <span class="color-picker-hex" data-hex-for="${s.key}">${currentColors[s.key]}</span>
      <button class="color-reset-btn${isDefault ? ' hidden' : ''}" data-reset-key="${s.key}" title="Reset to default">&#x21ba;</button>
    </div>`;
  }).join('');

  grid.querySelectorAll('.color-picker-swatch').forEach((input) => {
    input.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      const key = el.dataset.colorKey as keyof CustomColors;
      (currentColors as any)[key] = el.value;
      const hexEl = grid.querySelector(`[data-hex-for="${key}"]`);
      if (hexEl) hexEl.textContent = el.value;
      // Show/hide individual reset button
      const resetBtn = grid.querySelector(`[data-reset-key="${key}"]`);
      if (resetBtn) resetBtn.classList.toggle('hidden', el.value === (DEFAULT_COLORS as any)[key]);
      renderColorPreview();
      renderPresetRow();
      saveCustomColors(currentColors);
      projectColorMap.clear();
    });
  });

  grid.querySelectorAll('.color-reset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = (btn as HTMLElement).dataset.resetKey! as keyof CustomColors;
      (currentColors as any)[key] = (DEFAULT_COLORS as any)[key];
      saveCustomColors(currentColors);
      projectColorMap.clear();
      renderStatusColorPickers();
      renderColorPreview();
      renderPresetRow();
    });
  });
}

function renderPresetRow() {
  // Status presets
  const statusRow = $('statusPresetRow');
  if (statusRow) {
    statusRow.innerHTML = STATUS_PRESETS.map((preset) => {
      const isActive = (['unestimated', 'ready', 'active', 'warning', 'over'] as const).every(
        (k) => currentColors[k] === preset.colors[k]
      );
      const dots = [
        preset.colors.ready,
        preset.colors.active,
        preset.colors.warning,
        preset.colors.over,
      ];
      return `
        <button class="preset-chip${isActive ? ' active' : ''}" data-preset-name="${escapeHtml(preset.name)}" title="${escapeHtml(preset.description)}">
          <span class="preset-dots">${dots.map((c) => `<span class="preset-dot" style="background:${c}"></span>`).join('')}</span>
          ${escapeHtml(preset.name)}
        </button>`;
    }).join('');

    statusRow.querySelectorAll('.preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const name = (chip as HTMLElement).dataset.presetName!;
        const preset = STATUS_PRESETS.find((p) => p.name === name);
        if (!preset) return;
        currentColors.unestimated = preset.colors.unestimated;
        currentColors.ready = preset.colors.ready;
        currentColors.active = preset.colors.active;
        currentColors.warning = preset.colors.warning;
        currentColors.over = preset.colors.over;
        saveCustomColors(currentColors);
        projectColorMap.clear();
        renderStatusColorPickers();
        renderColorPreview();
        renderPresetRow();
      });
    });
  }

  // Project palette presets
  const projectRow = $('projectPresetRow');
  if (projectRow) {
    projectRow.innerHTML = PROJECT_PALETTE_PRESETS.map((preset) => {
      const isActive =
        preset.palette.length === currentColors.projectPalette.length &&
        preset.palette.every((c, i) => c === currentColors.projectPalette[i]);
      return `
        <button class="preset-chip${isActive ? ' active' : ''}" data-palette-preset="${escapeHtml(preset.name)}" title="${escapeHtml(preset.description)}">
          <span class="preset-dots">${preset.palette
            .slice(0, 5)
            .map((c) => `<span class="preset-dot" style="background:${c}"></span>`)
            .join('')}</span>
          ${escapeHtml(preset.name)}
        </button>`;
    }).join('');

    projectRow.querySelectorAll('.preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const name = (chip as HTMLElement).dataset.palettePreset!;
        const preset = PROJECT_PALETTE_PRESETS.find((p) => p.name === name);
        if (!preset) return;
        currentColors.projectPalette = [...preset.palette];
        saveCustomColors(currentColors);
        projectColorMap.clear();
        renderProjectColors();
        renderPresetRow();
      });
    });
  }
}

function getDetectedProjects(): string[] {
  const names = new Set<string>();
  for (const log of cachedTimelogs) {
    if (log.projectName) names.add(log.projectName);
  }
  // Also include projects that have saved colors but aren't in current data
  for (const name of Object.keys(currentColors.projectColors)) {
    names.add(name);
  }
  return Array.from(names).sort();
}

function renderProjectColors() {
  const grid = $('projectColorGrid');
  const projects = getDetectedProjects();

  let html = '';

  // Per-project color assignments
  if (projects.length > 0) {
    html += '<div class="project-color-list">';
    for (const name of projects) {
      const color = currentColors.projectColors[name] || getProjectColor(name);
      const isCustom = !!currentColors.projectColors[name];
      html += `
        <div class="project-color-item${isCustom ? ' custom' : ''}">
          <input type="color" class="color-picker-swatch" data-project-name="${escapeHtml(name)}" value="${color}">
          <span class="project-color-name">${escapeHtml(name)}</span>
          ${isCustom ? `<button class="project-color-reset" data-project-name="${escapeHtml(name)}" title="Reset to auto">&times;</button>` : ''}
        </div>`;
    }
    html += '</div>';
  } else {
    html +=
      '<div style="font-size:12px;color:var(--text-muted);padding:8px 0">Load some data in the weekly view to see your projects here.</div>';
  }

  // Default palette section
  html += `
    <div style="margin-top:16px">
      <div class="color-section-desc" style="margin-bottom:8px;margin-top:0">Default palette for new projects without a specific color.</div>
      <div class="palette-row">
        ${currentColors.projectPalette
          .map(
            (color, i) => `
          <div class="palette-swatch-item">
            <input type="color" class="color-picker-swatch" data-palette-index="${i}" value="${color}">
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  grid.innerHTML = html;

  // Attach listeners — project color pickers
  grid.querySelectorAll('[data-project-name].color-picker-swatch').forEach((input) => {
    input.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      const name = el.dataset.projectName!;
      currentColors.projectColors[name] = el.value;
      saveCustomColors(currentColors);
      projectColorMap.clear();
      // Mark as custom
      const item = el.closest('.project-color-item');
      if (item && !item.classList.contains('custom')) {
        item.classList.add('custom');
        const resetBtn = document.createElement('button');
        resetBtn.className = 'project-color-reset';
        resetBtn.dataset.projectName = name;
        resetBtn.title = 'Reset to auto';
        resetBtn.textContent = '\u00d7';
        resetBtn.addEventListener('click', () => removeProjectColor(name));
        item.appendChild(resetBtn);
      }
    });
  });

  // Attach listeners — reset buttons
  grid.querySelectorAll('.project-color-reset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = (btn as HTMLElement).dataset.projectName!;
      removeProjectColor(name);
    });
  });

  // Attach listeners — palette pickers
  grid.querySelectorAll('[data-palette-index]').forEach((input) => {
    input.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      const idx = parseInt(el.dataset.paletteIndex!, 10);
      currentColors.projectPalette[idx] = el.value;
      saveCustomColors(currentColors);
      projectColorMap.clear();
    });
  });
}

function removeProjectColor(name: string) {
  delete currentColors.projectColors[name];
  saveCustomColors(currentColors);
  projectColorMap.clear();
  renderProjectColors();
}

function renderColorPreview() {
  const container = $('colorPreview');
  container.innerHTML = STATUS_META.map((s) => {
    const color = currentColors[s.key];
    const bgAlpha = s.key === 'over' ? 0.08 : 0.06;
    const cardBg = hexToRgba(color, bgAlpha);
    const borderAlpha = s.key === 'unestimated' || s.key === 'ready' ? 1.0 : 0.25;
    const borderColor = borderAlpha < 1 ? hexToRgba(color, borderAlpha) : color;
    const borderWidth =
      s.key === 'unestimated' ? '3px' : s.pct > 100 ? '10px' : s.pct > 50 ? '6px' : '4px';
    const borderStyle = s.borderStyle;
    const chipBg = hexToRgba(color, 0.12);
    const progressPct = Math.min(s.pct, 100);

    let progressBar = '';
    if (s.pct > 0) {
      progressBar = `<div class="preview-card-progress" style="height:${progressPct}%;width:${borderWidth};background:${color};border-radius:2px 0 0 2px"></div>`;
    }

    return `
      <div class="preview-card" style="background:${cardBg};border-left:${borderWidth} ${borderStyle} ${borderColor}">
        ${progressBar}
        <div class="preview-card-body">
          <div class="preview-card-title">${escapeHtml(s.sampleTitle)}</div>
          <div class="preview-card-meta">
            <span class="preview-card-project">${escapeHtml(s.sampleProject)} #${s.sampleIid}</span>
            <span class="preview-time-chip" style="background:${chipBg};color:${color}">
              <span class="preview-dot" style="background:${color}"></span>
              ${s.sampleTime}
            </span>
          </div>
        </div>
        <span class="preview-card-status" style="background:${chipBg};color:${color}">${s.label}</span>
      </div>
    `;
  }).join('');
}

function initSettingsTabs() {
  document.querySelectorAll('.settings-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetTab = (tab as HTMLElement).dataset.settingsTab!;
      document
        .querySelectorAll('.settings-tab')
        .forEach((t) =>
          t.classList.toggle('active', (t as HTMLElement).dataset.settingsTab === targetTab)
        );
      document
        .querySelectorAll('.settings-tab-content')
        .forEach((c) =>
          c.classList.toggle('active', (c as HTMLElement).dataset.settingsTabContent === targetTab)
        );
    });
  });
}

function applyThemeMode(mode: ThemeMode) {
  currentThemeMode = mode;
  const html = document.documentElement;
  if (mode === 'light') {
    html.classList.add('theme-light');
    html.classList.remove('theme-dark');
  } else if (mode === 'dark') {
    html.classList.remove('theme-light');
    html.classList.remove('theme-dark');
  } else {
    // Auto: detect from GitLab setting stored via content script, or OS preference
    chrome.storage.sync.get('gitlabTheme', (result) => {
      const glTheme = result.gitlabTheme; // 'dark' or 'light', set by content script
      if (glTheme === 'light') {
        html.classList.add('theme-light');
      } else if (glTheme === 'dark') {
        html.classList.remove('theme-light');
      } else {
        // Fall back to OS preference
        if (window.matchMedia('(prefers-color-scheme: light)').matches) {
          html.classList.add('theme-light');
        } else {
          html.classList.remove('theme-light');
        }
      }
    });
  }
}

function renderThemeModeSelector() {
  const row = $('themeModeRow');
  if (!row) return;
  row.querySelectorAll('.preset-chip').forEach((chip) => {
    const theme = (chip as HTMLElement).dataset.theme as ThemeMode;
    chip.classList.toggle('active', theme === currentThemeMode);
  });
  row.querySelectorAll('.preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const mode = (chip as HTMLElement).dataset.theme as ThemeMode;
      saveThemeMode(mode);
      applyThemeMode(mode);
      renderThemeModeSelector();
    });
  });
}

/* ── Notification Settings ── */

interface NotificationSettings {
  enabled: boolean;
  startOfDay: { enabled: boolean; time: string; minHours: number };
  endOfDay: { enabled: boolean; time: string; minHours: number };
}

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  startOfDay: { enabled: true, time: '08:45', minHours: 8 },
  endOfDay: { enabled: true, time: '17:00', minHours: 8 },
};

async function loadNotificationSettings(): Promise<NotificationSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get('notificationSettings', (result) => {
      resolve(result.notificationSettings || DEFAULT_NOTIFICATION_SETTINGS);
    });
  });
}

function saveNotificationSettings(settings: NotificationSettings): void {
  chrome.storage.sync.set({ notificationSettings: settings });
}

function readNotificationForm(): NotificationSettings {
  return {
    enabled: ($('notifEnabled') as HTMLInputElement).checked,
    startOfDay: {
      enabled: ($('notifStartEnabled') as HTMLInputElement).checked,
      time: ($('notifStartTime') as HTMLInputElement).value || '08:45',
      minHours: parseFloat(($('notifStartHours') as HTMLInputElement).value) || 8,
    },
    endOfDay: {
      enabled: ($('notifEndEnabled') as HTMLInputElement).checked,
      time: ($('notifEndTime') as HTMLInputElement).value || '17:00',
      minHours: parseFloat(($('notifEndHours') as HTMLInputElement).value) || 8,
    },
  };
}

function populateNotificationForm(settings: NotificationSettings): void {
  ($('notifEnabled') as HTMLInputElement).checked = settings.enabled;
  ($('notifStartEnabled') as HTMLInputElement).checked = settings.startOfDay.enabled;
  ($('notifStartTime') as HTMLInputElement).value = settings.startOfDay.time;
  ($('notifStartHours') as HTMLInputElement).value = String(settings.startOfDay.minHours);
  ($('notifEndEnabled') as HTMLInputElement).checked = settings.endOfDay.enabled;
  ($('notifEndTime') as HTMLInputElement).value = settings.endOfDay.time;
  ($('notifEndHours') as HTMLInputElement).value = String(settings.endOfDay.minHours);
  updateNotifBodyState(settings.enabled);
}

function updateNotifBodyState(enabled: boolean): void {
  const body = $('notifSettingsBody');
  body.style.opacity = enabled ? '1' : '0.45';
  body.style.pointerEvents = enabled ? 'auto' : 'none';
}

function initNotificationSettings(): void {
  loadNotificationSettings().then(populateNotificationForm);

  $('notifEnabled').addEventListener('change', () => {
    const settings = readNotificationForm();
    updateNotifBodyState(settings.enabled);
    saveNotificationSettings(settings);
  });

  // Auto-save on any change
  for (const id of [
    'notifStartEnabled',
    'notifStartTime',
    'notifStartHours',
    'notifEndEnabled',
    'notifEndTime',
    'notifEndHours',
  ]) {
    $(id).addEventListener('change', () => {
      saveNotificationSettings(readNotificationForm());
    });
  }

  $('testNotifBtn').addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.notifications) {
      chrome.notifications.create(`test-${Date.now()}`, {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'GitLab Ninja - Test',
        message: "Notifications are working! You'll get reminders about unlogged time.",
        priority: 1,
      });
    } else {
      // Fallback for browsers without chrome.notifications in options context
      if (Notification.permission === 'granted') {
        new Notification('GitLab Ninja - Test', {
          body: "Notifications are working! You'll get reminders about unlogged time.",
          icon: 'icons/icon-128.png',
        });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((perm) => {
          if (perm === 'granted') {
            new Notification('GitLab Ninja - Test', {
              body: 'Notifications are working!',
              icon: 'icons/icon-128.png',
            });
          }
        });
      }
    }
  });
}

function flashSaveStatus(text: string, ok: boolean) {
  const el = $('saveStatus');
  el.textContent = text;
  el.className = `save-status show ${ok ? 'ok' : 'err'}`;
  setTimeout(() => el.classList.remove('show'), 2500);
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await detectGitlabUrl();

  // Load theme mode and custom colors
  currentThemeMode = await loadThemeMode();
  applyThemeMode(currentThemeMode);
  currentColors = await loadCustomColors();

  // Re-apply theme when GitLab theme changes (for auto mode)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.gitlabTheme && currentThemeMode === 'auto') {
      applyThemeMode('auto');
    }
  });

  initSettingsTabs();
  initNotificationSettings();
  renderThemeModeSelector();
  renderPresetRow();
  renderStatusColorPickers();
  renderProjectColors();
  renderColorPreview();

  $('resetColorsBtn').addEventListener('click', () => {
    if (!confirm('Reset all colors to defaults?')) return;
    currentColors = {
      ...DEFAULT_COLORS,
      projectPalette: [...DEFAULT_COLORS.projectPalette],
      projectColors: {},
    };
    saveCustomColors(currentColors);
    renderPresetRow();
    renderStatusColorPickers();
    renderProjectColors();
    renderColorPreview();
    projectColorMap.clear();
  });

  // Page navigation
  document.querySelectorAll('.topbar-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = (btn as HTMLElement).dataset.page;
      if (!page) return;
      document
        .querySelectorAll('.topbar-nav-btn')
        .forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.page === page));
      document
        .querySelectorAll('.page-view')
        .forEach((v) =>
          v.classList.toggle(
            'active',
            v.id === `page${page.charAt(0).toUpperCase() + page.slice(1)}`
          )
        );
    });
  });

  $('saveBtn').addEventListener('click', async () => {
    const token = ($('apiToken') as HTMLInputElement).value.trim();
    const url = ($('gitlabUrl') as HTMLInputElement).value.trim().replace(/\/+$/, '');
    if (!token) {
      flashSaveStatus('Token is required', false);
      return;
    }
    if (!url) {
      flashSaveStatus('GitLab URL is required', false);
      return;
    }
    const parsedBoardPath = parseBoardInput(
      ($('boardGroupPath') as HTMLInputElement).value.trim(),
      url
    );

    // Request host permission for self-hosted GitLab domains
    try {
      const hostname = new URL(url).hostname;
      if (hostname !== 'gitlab.com') {
        const granted = await chrome.permissions.request({ origins: [`https://${hostname}/*`] });
        if (!granted) {
          flashSaveStatus(
            "Host permission denied — board features won't work on this domain",
            false
          );
          return;
        }
      }
    } catch {
      flashSaveStatus('Invalid GitLab URL', false);
      return;
    }

    chrome.storage.local.set({ apiToken: token });
    chrome.storage.sync.set(
      { lastGitlabUrl: url, boardGroupPath: parsedBoardPath || null },
      async () => {
        apiToken = token;
        gitlabUrl = url;
        boardGroupPath = parsedBoardPath || null;
        if (boardGroupPath) ($('boardGroupPath') as HTMLInputElement).value = boardGroupPath;
        flashSaveStatus('Saved!', true);
        loadWeek();
        // Fetch and cache the current username
        try {
          const res = await fetch(`${url}/api/v4/user`, { headers: { 'PRIVATE-TOKEN': token } });
          if (res.ok) {
            const user = await res.json();
            username = user.username;
            chrome.storage.sync.set({ username });
          }
        } catch {
          /* ignore */
        }
      }
    );
  });

  $('copyTokenBtn').addEventListener('click', () => {
    const token = ($('apiToken') as HTMLInputElement).value;
    if (token) {
      navigator.clipboard.writeText(token);
      flashSaveStatus('Token copied', true);
    }
  });

  $('clearTokenBtn').addEventListener('click', () => {
    ($('apiToken') as HTMLInputElement).value = '';
    apiToken = null;
    chrome.storage.local.remove('apiToken');
    flashSaveStatus('Token cleared', true);
  });

  $('myBoardBtn').addEventListener('click', () => {
    if (!gitlabUrl || !boardGroupPath) {
      alert('Please configure your GitLab URL and board group path in Settings first.');
      return;
    }
    if (!username) {
      alert('Username not available. Save your settings first to fetch your username.');
      return;
    }
    const boardUrl = `${gitlabUrl}/${boardGroupPath}?assignee_username=${encodeURIComponent(username)}`;
    window.open(boardUrl, '_blank');
  });

  $('weekPrev').addEventListener('click', () => {
    if (currentView === 'month') {
      monthOffset--;
      loadMonth();
    } else {
      weekOffset--;
      loadWeek();
    }
  });
  $('weekNext').addEventListener('click', () => {
    if (currentView === 'month') {
      monthOffset++;
      loadMonth();
    } else {
      weekOffset++;
      loadWeek();
    }
  });

  // View toggle
  document.querySelectorAll('.view-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = (btn as HTMLElement).dataset.view as 'list' | 'week' | 'month';
      if (view === currentView) return;
      currentView = view;
      updateViewToggle();
      chrome.storage.sync.set({ calendarView: currentView });
      loadView();
    });
  });

  // Restore saved preferences
  chrome.storage.sync.get(['calendarView', 'hideWeekends'], (result) => {
    if (result.calendarView && ['list', 'week', 'month'].includes(result.calendarView)) {
      currentView = result.calendarView;
      updateViewToggle();
    }
    if (result.hideWeekends) {
      hideWeekends = true;
    }
  });

  if (apiToken && gitlabUrl) {
    loadView();
  } else if (!apiToken) {
    // Navigate to settings page
    document
      .querySelectorAll('.topbar-nav-btn')
      .forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.page === 'settings'));
    document
      .querySelectorAll('.page-view')
      .forEach((v) => v.classList.toggle('active', v.id === 'pageSettings'));
    $('weekContent').innerHTML =
      `<div class="empty-state"><div class="empty-state-text">Add your API token in Settings to see weekly data.</div></div>`;
  } else {
    $('weekContent').innerHTML =
      `<div class="empty-state"><div class="empty-state-text">Open a GitLab page first so we can detect your instance.</div></div>`;
  }
});
