import { loadThemeMode, ThemeMode } from './utils/themeManager';

export {};

interface TabInfo {
  gitlabUrl: string;
  group: string;
}

interface TimelogEntry {
  issueIid: number;
  issueTitle: string;
  issueUrl: string;
  labels: string[];
  timeSpent: number;
  timeEstimate: number;
  totalTimeSpent: number;
  summary: string;
}

interface GitLabProject {
  id: number;
  path_with_namespace: string;
  name_with_namespace: string;
}

interface DayTimelog {
  dayLabel: string;
  date: string;
  totalSeconds: number;
  isToday: boolean;
}

interface IssueTemplate {
  id: string;
  name: string;
  title: string;
  description: string;
  projectPath: string;
  projectName: string;
  estimate: string;
  timeSpent: string;
  summary: string;
  spentAtTime?: string; // "HH:MM" for specific time today, empty = current time
}

function applyPopupTheme(mode: ThemeMode) {
  const html = document.documentElement;
  if (mode === 'light') {
    html.classList.add('theme-light');
  } else if (mode === 'dark') {
    html.classList.remove('theme-light');
  } else {
    // Auto: detect from GitLab setting stored via content script, or OS preference
    chrome.storage.sync.get('gitlabTheme', (result) => {
      const glTheme = result.gitlabTheme;
      if (glTheme === 'light') {
        html.classList.add('theme-light');
      } else if (glTheme === 'dark') {
        html.classList.remove('theme-light');
      } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
        html.classList.add('theme-light');
      } else {
        html.classList.remove('theme-light');
      }
    });
  }
}

let selectedProject: string | null = null;
let tabInfo: TabInfo | null = null;
let apiToken: string | null = null;
let allProjects: GitLabProject[] = [];
let highlightedIndex = -1;
let cachedUsername: string | null = null;

const $ = (id: string) => document.getElementById(id)!;

function detectFromUrl(url: string): TabInfo | null {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2) return null;
    const dashIndex = pathParts.indexOf('-');
    if (dashIndex < 2) return null;
    // Skip "groups/" or "projects/" prefix if present
    const prefix = pathParts[0];
    const groupStart = prefix === 'groups' || prefix === 'projects' ? 1 : 0;
    const group = pathParts.slice(groupStart, dashIndex).join('/');
    return { gitlabUrl: parsed.origin, group };
  } catch {
    return null;
  }
}

async function getCurrentTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] || null);
    });
  });
}

async function loadSettings(): Promise<{
  token: string | null;
  lastProject: string | null;
  gitlabUrl: string | null;
  username: string | null;
  boardGroupPath: string | null;
}> {
  const [tokenResult, syncResult] = await Promise.all([
    new Promise<any>((resolve) => chrome.storage.local.get('apiToken', resolve)),
    new Promise<any>((resolve) =>
      chrome.storage.sync.get(
        ['lastProject', 'lastGitlabUrl', 'username', 'boardGroupPath'],
        resolve
      )
    ),
  ]);
  return {
    token: tokenResult.apiToken || null,
    lastProject: syncResult.lastProject || null,
    gitlabUrl: syncResult.lastGitlabUrl || null,
    username: syncResult.username || null,
    boardGroupPath: syncResult.boardGroupPath || null,
  };
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function showStatus(message: string, isError: boolean) {
  const el = $('statusMsg');
  el.textContent = message;
  el.className = `status-msg ${isError ? 'error' : 'success'}`;
}

function updateSubmitButton() {
  const title = ($('ticketTitle') as HTMLInputElement).value.trim();
  ($('submitBtn') as HTMLButtonElement).disabled =
    !title || !apiToken || !tabInfo || !selectedProject;
}

function fuzzyMatch(
  text: string,
  query: string
): { match: boolean; score: number; indices: number[] } {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const indices: number[] = [];
  let qi = 0;
  let score = 0;
  let lastIdx = -1;

  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) {
      indices.push(i);
      // Bonus for consecutive matches
      if (lastIdx === i - 1) score += 5;
      // Bonus for matching at word boundaries
      if (i === 0 || '/- _'.includes(lower[i - 1])) score += 10;
      score += 1;
      lastIdx = i;
      qi++;
    }
  }

  return { match: qi === q.length, score, indices };
}

function highlightMatches(text: string, indices: number[]): string {
  if (indices.length === 0) return escapeHtml(text);
  const set = new Set(indices);
  let result = '';
  let inMark = false;
  for (let i = 0; i < text.length; i++) {
    if (set.has(i) && !inMark) {
      result += '<mark>';
      inMark = true;
    } else if (!set.has(i) && inMark) {
      result += '</mark>';
      inMark = false;
    }
    result += escapeHtml(text[i]);
  }
  if (inMark) result += '</mark>';
  return result;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderDropdown(query: string) {
  const dropdown = $('projectDropdown');
  const q = query.trim();

  if (allProjects.length === 0) {
    dropdown.style.display = 'none';
    return;
  }

  let items: { project: GitLabProject; score: number; indices: number[] }[];

  if (!q) {
    items = allProjects.map((p) => ({ project: p, score: 0, indices: [] }));
  } else {
    items = [];
    for (const p of allProjects) {
      // Match against both name and path
      const nameMatch = fuzzyMatch(p.name_with_namespace, q);
      const pathMatch = fuzzyMatch(p.path_with_namespace, q);
      const best = nameMatch.score >= pathMatch.score ? nameMatch : pathMatch;
      if (best.match) {
        items.push({
          project: p,
          score: best.score,
          indices: best === nameMatch ? best.indices : [],
        });
      }
    }
    items.sort((a, b) => b.score - a.score);
  }

  if (items.length === 0) {
    dropdown.innerHTML = '<div class="project-no-results">No matching projects</div>';
    dropdown.style.display = 'block';
    highlightedIndex = -1;
    return;
  }

  highlightedIndex = -1;
  dropdown.innerHTML = items
    .map((item, i) => {
      const label =
        item.indices.length > 0
          ? highlightMatches(item.project.name_with_namespace, item.indices)
          : escapeHtml(item.project.name_with_namespace);
      return `<div class="project-option" data-index="${i}" data-path="${escapeHtml(item.project.path_with_namespace)}" data-name="${escapeHtml(item.project.name_with_namespace)}">${label}</div>`;
    })
    .join('');

  dropdown.style.display = 'block';
}

function selectProject(path: string, name: string) {
  selectedProject = path;
  const input = $('projectInput') as HTMLInputElement;
  input.value = name;
  $('projectDropdown').style.display = 'none';
  $('projectClear').style.display = 'block';
  highlightedIndex = -1;
  updateSubmitButton();
}

function clearProject() {
  selectedProject = null;
  const input = $('projectInput') as HTMLInputElement;
  input.value = '';
  $('projectClear').style.display = 'none';
  updateSubmitButton();
}


async function fetchProjects(): Promise<GitLabProject[]> {
  if (!tabInfo || !apiToken) return [];

  const baseUrl = `${tabInfo.gitlabUrl}/api/v4`;
  const res = await fetch(
    `${baseUrl}/projects?membership=true&min_access_level=30&per_page=100&order_by=last_activity_at`,
    {
      headers: { 'PRIVATE-TOKEN': apiToken },
    }
  );

  if (!res.ok) return [];
  return res.json();
}

async function loadProjects() {
  const loading = $('projectLoading');
  loading.style.display = '';

  try {
    allProjects = await fetchProjects();

    // Restore last selected project
    if (selectedProject) {
      const match = allProjects.find((p) => p.path_with_namespace === selectedProject);
      const input = $('projectInput') as HTMLInputElement;
      input.value = match ? match.name_with_namespace : selectedProject;
      $('projectClear').style.display = 'block';
    }
  } catch {
    // Keep as-is
  } finally {
    loading.style.display = 'none';
  }

  updateSubmitButton();
}

function renderProgressRing(pct: number): string {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const r = 14;
  const circ = 2 * Math.PI * r;
  const offset = circ - (clamped / 100) * circ;
  const color = clamped >= 100 ? '#f87171' : clamped >= 75 ? '#fbbf24' : '#34d399';
  return `
    <div class="progress-ring">
      <svg width="36" height="36" viewBox="0 0 36 36">
        <circle class="progress-ring-bg" cx="18" cy="18" r="${r}" fill="none" stroke-width="3"/>
        <circle class="progress-ring-fill" cx="18" cy="18" r="${r}" fill="none"
          stroke="${color}" stroke-width="3" stroke-linecap="round"
          stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
      </svg>
      <span class="progress-pct">${Math.round(clamped)}%</span>
    </div>
  `;
}

async function fetchDayTimelogs(dateStr?: string): Promise<TimelogEntry[]> {
  if (!tabInfo || !apiToken) return [];

  const baseUrl = `${tabInfo.gitlabUrl}/api/graphql`;
  let startDate: string;
  let endDate: string;
  if (dateStr) {
    startDate = dateStr;
    endDate = dateStr;
  } else {
    const today = new Date();
    startDate = localDateStr(today);
    endDate = startDate;
  }

  const query = `query {
    currentUser {
      timelogs(startDate: "${startDate}", endDate: "${endDate}") {
        nodes {
          timeSpent
          spentAt
          summary
          issue {
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
        }
      }
    }
  }`;

  const res = await fetch(baseUrl, {
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

  const map = new Map<number, TimelogEntry>();
  for (const node of nodes) {
    if (!node.issue) continue;
    const iid = parseInt(node.issue.iid, 10);
    const existing = map.get(iid);
    if (existing) {
      existing.timeSpent += node.timeSpent;
      // Append summaries
      if (node.summary && !existing.summary.includes(node.summary)) {
        existing.summary = existing.summary ? `${existing.summary}; ${node.summary}` : node.summary;
      }
    } else {
      const labels = (node.issue.labels?.nodes || []).map((l: any) => l.title);
      map.set(iid, {
        issueIid: iid,
        issueTitle: node.issue.title,
        issueUrl: node.issue.webUrl,
        labels,
        timeSpent: node.timeSpent,
        timeEstimate: node.issue.timeEstimate || 0,
        totalTimeSpent: node.issue.totalTimeSpent || 0,
        summary: node.summary || '',
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.timeSpent - a.timeSpent);
}

function renderTodayList(entries: TimelogEntry[]) {
  const list = $('todayList');
  const totalEl = $('todayTotal');

  if (entries.length === 0) {
    list.innerHTML = `
      <div class="today-empty">
        <div class="today-empty-icon">&#9203;</div>
        <div class="today-empty-text">No time logged</div>
      </div>
    `;
    totalEl.textContent = '0m';
    return;
  }

  const totalSeconds = entries.reduce((sum, e) => sum + e.timeSpent, 0);
  totalEl.textContent = formatDuration(totalSeconds);

  list.innerHTML = entries
    .map((entry) => {
      const pct = entry.timeEstimate > 0 ? (entry.totalTimeSpent / entry.timeEstimate) * 100 : 0;
      const estLabel =
        entry.timeEstimate > 0
          ? `${formatDuration(entry.totalTimeSpent)} / ${formatDuration(entry.timeEstimate)}`
          : 'No estimate';

      const labelsHtml =
        entry.labels.length > 0
          ? entry.labels
              .map((l) => `<span class="today-label" data-label="${l.toLowerCase()}">${l}</span>`)
              .join(' ')
          : '';

      const summaryHtml = entry.summary
        ? `<div class="today-summary-note">${escapeHtml(entry.summary)}</div>`
        : '';

      return `
      <div class="today-item">
        ${entry.timeEstimate > 0 ? renderProgressRing(pct) : renderProgressRing(0)}
        <div class="today-info">
          <a class="today-title" href="${entry.issueUrl}" target="_blank" title="${entry.issueTitle}">#${entry.issueIid} ${entry.issueTitle}</a>
          <div class="today-meta">${labelsHtml ? labelsHtml + ' &middot; ' : ''}${estLabel}</div>
          ${summaryHtml}
        </div>
        <div class="today-time">${formatDuration(entry.timeSpent)}</div>
      </div>
    `;
    })
    .join('');
}

let selectedDayDate: string | null = null;

async function loadToday(dateStr?: string) {
  const list = $('todayList');
  const refreshBtn = $('todayRefresh') as HTMLButtonElement;
  const label = $('todayTotalLabel');

  list.innerHTML = `<div class="today-loading"><div class="spinner"></div><div>Loading timelogs...</div></div>`;
  refreshBtn.disabled = true;

  if (dateStr) {
    selectedDayDate = dateStr;
    const d = new Date(dateStr + 'T00:00:00');
    const todayStr = localDateStr(new Date());
    if (dateStr === todayStr) {
      label.textContent = 'logged today';
    } else {
      const dayNames = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ];
      label.textContent = `logged ${dayNames[d.getDay()]}`;
    }
  } else {
    selectedDayDate = null;
    label.textContent = 'logged today';
  }

  try {
    const entries = await fetchDayTimelogs(dateStr);
    renderTodayList(entries);
  } catch (err: any) {
    list.innerHTML = `<div class="today-empty"><div class="today-empty-text" style="color:var(--red-500)">${escapeHtml(err.message)}</div></div>`;
    $('todayTotal').textContent = '--';
  } finally {
    refreshBtn.disabled = false;
  }
}

async function createTicket() {
  if (!tabInfo || !apiToken) return;

  const projectPath = selectedProject;
  if (!projectPath) return;

  const title = ($('ticketTitle') as HTMLInputElement).value.trim();
  const description = ($('ticketDesc') as HTMLTextAreaElement).value.trim();
  const ticketEstimate = ($('ticketEstimate') as HTMLInputElement).value.trim();
  const ticketSpent = ($('ticketSpent') as HTMLInputElement).value.trim();
  const ticketSummary = ($('ticketSummary') as HTMLInputElement).value.trim();
  if (!title) return;

  const btn = $('submitBtn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Creating...';
  $('statusMsg').className = 'status-msg';

  const encodedProject = encodeURIComponent(projectPath);
  const baseUrl = `${tabInfo.gitlabUrl}/api/v4`;
  const headers = {
    'Content-Type': 'application/json',
    'PRIVATE-TOKEN': apiToken,
  };

  const estimateDuration = ticketEstimate;
  const spentDuration = ticketSpent;

  try {
    const userRes = await fetch(`${baseUrl}/user`, { headers });
    if (!userRes.ok) throw new Error(`Auth failed (${userRes.status}). Check your token.`);
    const user = await userRes.json();

    const issueBody: Record<string, any> = {
      title,
      assignee_ids: [user.id],
      labels: 'done',
    };
    if (description) issueBody.description = description;

    const issueRes = await fetch(`${baseUrl}/projects/${encodedProject}/issues`, {
      method: 'POST',
      headers,
      body: JSON.stringify(issueBody),
    });
    if (!issueRes.ok) {
      const err = await issueRes.json().catch(() => ({}));
      throw new Error(err.message || err.error || `Failed to create issue (${issueRes.status})`);
    }
    const issue = await issueRes.json();

    // Set estimate
    if (estimateDuration) {
      await fetch(`${baseUrl}/projects/${encodedProject}/issues/${issue.iid}/time_estimate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ duration: estimateDuration }),
      });
    }

    // Log time spent
    if (spentDuration) {
      const spentBody: Record<string, string> = { duration: spentDuration };
      if (ticketSummary) spentBody.summary = ticketSummary;
      await fetch(`${baseUrl}/projects/${encodedProject}/issues/${issue.iid}/add_spent_time`, {
        method: 'POST',
        headers,
        body: JSON.stringify(spentBody),
      });
    }

    const issueUrl = `${tabInfo.gitlabUrl}/${projectPath}/-/issues/${issue.iid}`;
    const el = $('statusMsg');
    el.innerHTML = `Created <a href="${issueUrl}" target="_blank">#${issue.iid}</a>: ${escapeHtml(title)}`;
    el.className = 'status-msg success';

    // Save last used project
    chrome.storage.sync.set({ lastProject: projectPath });

    ($('ticketTitle') as HTMLInputElement).value = '';
    ($('ticketDesc') as HTMLTextAreaElement).value = '';
    ($('ticketEstimate') as HTMLInputElement).value = '';
    ($('ticketSpent') as HTMLInputElement).value = '';
    ($('ticketSummary') as HTMLInputElement).value = '';
    btn.textContent = 'Create Ticket';
    updateSubmitButton();
  } catch (err: any) {
    showStatus(err.message || 'Something went wrong', true);
    btn.disabled = false;
    btn.textContent = 'Create Ticket';
  }
}

// ── Week mini chart (in Today view) ──

async function fetchWeekDailyTotals(): Promise<DayTimelog[]> {
  if (!tabInfo || !apiToken) return [];

  const baseUrl = `${tabInfo.gitlabUrl}/api/graphql`;
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ...
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + mondayOffset);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);

  const startDate = localDateStr(monday);
  const endDate = localDateStr(sunday);

  const query = `query {
    currentUser {
      timelogs(startDate: "${startDate}", endDate: "${endDate}") {
        nodes {
          timeSpent
          spentAt
        }
      }
    }
  }`;

  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) return [];
  const data = await res.json();
  if (data.errors?.length) return [];

  const nodes = data.data?.currentUser?.timelogs?.nodes || [];
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const todayStr = localDateStr(today);

  // Build 7-day array
  const days: DayTimelog[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const dateStr = localDateStr(d);
    days.push({
      dayLabel: dayNames[i],
      date: dateStr,
      totalSeconds: 0,
      isToday: dateStr === todayStr,
    });
  }

  // Aggregate timelogs by day
  for (const node of nodes) {
    if (!node.spentAt) continue;
    const spentDate = node.spentAt.substring(0, 10); // "YYYY-MM-DD"
    const day = days.find((d) => d.date === spentDate);
    if (day) day.totalSeconds += node.timeSpent;
  }

  return days;
}

function renderWeekMini(days: DayTimelog[]) {
  const container = $('weekMini');
  const totalContainer = $('weekMiniTotal');
  const maxSeconds = Math.max(...days.map((d) => d.totalSeconds), 1);
  const weekTotal = days.reduce((s, d) => s + d.totalSeconds, 0);

  const activeDate = selectedDayDate || localDateStr(new Date());

  container.innerHTML = days
    .map((day) => {
      const heightPct =
        day.totalSeconds > 0 ? Math.max((day.totalSeconds / maxSeconds) * 100, 8) : 8;
      const hasTime = day.totalSeconds > 0;
      const isActive = day.date === activeDate;
      const todayClass = isActive ? ' today-bar' : '';
      const labelClass = isActive ? ' today-label' : '';
      const hoursClass = isActive ? ' today-hours' : '';
      const timeStr = hasTime ? formatDuration(day.totalSeconds) : '';

      return `
      <div class="week-mini-day" data-date="${day.date}" style="cursor:pointer">
        <div class="week-mini-hours${hoursClass}">${timeStr}</div>
        <div class="week-mini-bar-wrap">
          <div class="week-mini-bar${todayClass}${hasTime ? ' has-time' : ''}" style="height:${heightPct}%"></div>
        </div>
        <div class="week-mini-label${labelClass}">${day.dayLabel}</div>
      </div>
    `;
    })
    .join('');

  // Attach click handlers to day columns
  container.querySelectorAll('.week-mini-day[data-date]').forEach((el) => {
    el.addEventListener('click', () => {
      const date = (el as HTMLElement).dataset.date!;
      loadToday(date);
      // Update active styling immediately
      container.querySelectorAll('.week-mini-day').forEach((d) => {
        const dDate = (d as HTMLElement).dataset.date;
        const isNowActive = dDate === date;
        d.querySelector('.week-mini-bar')?.classList.toggle('today-bar', isNowActive);
        d.querySelector('.week-mini-label')?.classList.toggle('today-label', isNowActive);
        d.querySelector('.week-mini-hours')?.classList.toggle('today-hours', isNowActive);
      });
    });
  });

  totalContainer.innerHTML = `
    <span class="week-mini-total-value">${formatDuration(weekTotal)}</span>
    <span class="week-mini-total-label">this week</span>
  `;
}

async function loadWeekMini() {
  try {
    const days = await fetchWeekDailyTotals();
    if (days.length > 0) renderWeekMini(days);
  } catch {
    // Silently fail - mini chart is non-critical
  }
}

async function fetchCurrentUsername(): Promise<string | null> {
  if (cachedUsername) return cachedUsername;
  if (!tabInfo || !apiToken) return null;

  try {
    const res = await fetch(`${tabInfo.gitlabUrl}/api/v4/user`, {
      headers: { 'PRIVATE-TOKEN': apiToken },
    });
    if (!res.ok) return null;
    const user = await res.json();
    cachedUsername = user.username;
    chrome.storage.sync.set({ username: cachedUsername });
    return cachedUsername;
  } catch {
    return null;
  }
}

let boardGroupPath: string | null = null;

function updateBoardLink() {
  const link = $('boardLink') as HTMLAnchorElement;
  if (tabInfo && cachedUsername && boardGroupPath) {
    link.href = `${tabInfo.gitlabUrl}/${boardGroupPath}?assignee_username=${encodeURIComponent(cachedUsername)}`;
    link.style.display = '';
  } else {
    link.style.display = 'none';
  }
}

// ── Notes ──

let notes: string[] = [];

async function loadNotes(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['quickNotes'], (result) => {
      resolve(result.quickNotes || []);
    });
  });
}

async function saveNotes(items: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ quickNotes: items }, resolve);
  });
}

function updateNotesBadge() {
  const badge = $('notesBadge');
  badge.textContent = notes.length > 0 ? String(notes.length) : '';
}

function renderNotes() {
  updateNotesBadge();
  const list = $('notesList');
  if (notes.length === 0) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = notes
    .map(
      (note, i) => `
    <div class="note-item" draggable="true" data-idx="${i}">
      <span class="note-drag-handle">
        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="3" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="12" r="1.2"/><circle cx="7" cy="12" r="1.2"/></svg>
      </span>
      <span class="note-text">${escapeHtml(note)}</span>
      <button class="note-delete" data-idx="${i}" title="Delete">&times;</button>
    </div>
  `
    )
    .join('');

  setupNoteDragAndDrop();
}

function setupNoteDragAndDrop() {
  const list = $('notesList');
  let dragIdx: number | null = null;

  list.querySelectorAll('.note-item').forEach((item) => {
    const el = item as HTMLElement;

    el.addEventListener('dragstart', (e) => {
      dragIdx = parseInt(el.dataset.idx || '0', 10);
      el.classList.add('dragging');
      (e as DragEvent).dataTransfer!.effectAllowed = 'move';
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      list.querySelectorAll('.note-item').forEach((n) => n.classList.remove('drag-over'));
      dragIdx = null;
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      (e as DragEvent).dataTransfer!.dropEffect = 'move';
      list.querySelectorAll('.note-item').forEach((n) => n.classList.remove('drag-over'));
      el.classList.add('drag-over');
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });

    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const dropIdx = parseInt(el.dataset.idx || '0', 10);
      if (dragIdx !== null && dragIdx !== dropIdx) {
        const [moved] = notes.splice(dragIdx, 1);
        notes.splice(dropIdx, 0, moved);
        await saveNotes(notes);
        renderNotes();
      }
    });
  });
}

async function addNote(text: string) {
  if (!text.trim()) return;
  notes.push(text.trim());
  await saveNotes(notes);
  renderNotes();
}

async function deleteNote(idx: number) {
  notes.splice(idx, 1);
  await saveNotes(notes);
  renderNotes();
}

// ── Quick Templates ──

let templates: IssueTemplate[] = [];
let tplSelectedProject: string | null = null;
let tplHighlightedIndex = -1;

async function loadTemplates(): Promise<IssueTemplate[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['issueTemplates'], (result) => {
      resolve(result.issueTemplates || []);
    });
  });
}

async function saveTemplates(tpls: IssueTemplate[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ issueTemplates: tpls }, resolve);
  });
}

function renderTemplateList() {
  const list = $('quickList');

  if (templates.length === 0) {
    list.innerHTML = `
      <div class="today-empty">
        <div class="today-empty-icon" style="font-size:22px">&#9889;</div>
        <div class="today-empty-text">No templates yet</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Add a recurring task template below</div>
      </div>
    `;
    return;
  }

  list.innerHTML = templates
    .map((tpl) => {
      const projectShort = tpl.projectName.split('/').pop()?.trim() || tpl.projectPath;
      const timeParts: string[] = [];
      if (tpl.estimate) timeParts.push(`est ${tpl.estimate}`);
      if (tpl.timeSpent) timeParts.push(`spent ${tpl.timeSpent}`);
      const timeStr = timeParts.length > 0 ? timeParts.join(' · ') : '';
      const meta = [projectShort, timeStr].filter(Boolean).join(' · ');

      return `
      <div class="quick-item" data-tpl-id="${tpl.id}">
        <div class="quick-item-icon">${(tpl.name || '?').charAt(0).toUpperCase()}</div>
        <div class="quick-item-info">
          <div class="quick-item-name">${escapeHtml(tpl.name)}</div>
          <div class="quick-item-meta">${escapeHtml(meta)}</div>
        </div>
        <div class="quick-item-actions">
          <button class="quick-item-action edit" data-tpl-id="${tpl.id}" title="Edit">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="quick-item-action delete" data-tpl-id="${tpl.id}" title="Delete">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>
      </div>
    `;
    })
    .join('');
}

function showTemplateForm(tpl?: IssueTemplate) {
  const form = $('quickForm');
  const title = $('quickFormTitle');
  const editId = $('tplEditId') as HTMLInputElement;

  if (tpl) {
    title.textContent = 'Edit Template';
    editId.value = tpl.id;
    ($('tplName') as HTMLInputElement).value = tpl.name;
    ($('tplProjectInput') as HTMLInputElement).value = tpl.projectName;
    tplSelectedProject = tpl.projectPath;
    $('tplProjectClear').style.display = tpl.projectPath ? 'block' : 'none';
    ($('tplTitle') as HTMLInputElement).value = tpl.title;
    ($('tplDesc') as HTMLTextAreaElement).value = tpl.description;
    ($('tplEstimate') as HTMLInputElement).value = tpl.estimate;
    ($('tplSpent') as HTMLInputElement).value = tpl.timeSpent;
    ($('tplSummary') as HTMLInputElement).value = tpl.summary;
    ($('tplSpentAtTime') as HTMLInputElement).value = tpl.spentAtTime || '';
  } else {
    title.textContent = 'New Template';
    editId.value = '';
    ($('tplName') as HTMLInputElement).value = '';
    ($('tplProjectInput') as HTMLInputElement).value = '';
    tplSelectedProject = selectedProject; // Default to last used project
    if (tplSelectedProject) {
      const match = allProjects.find((p) => p.path_with_namespace === tplSelectedProject);
      ($('tplProjectInput') as HTMLInputElement).value =
        match?.name_with_namespace || tplSelectedProject;
      $('tplProjectClear').style.display = 'block';
    } else {
      $('tplProjectClear').style.display = 'none';
    }
    ($('tplTitle') as HTMLInputElement).value = '';
    ($('tplDesc') as HTMLTextAreaElement).value = '';
    ($('tplEstimate') as HTMLInputElement).value = '';
    ($('tplSpent') as HTMLInputElement).value = '';
    ($('tplSummary') as HTMLInputElement).value = '';
    ($('tplSpentAtTime') as HTMLInputElement).value = '';
  }

  form.style.display = '';
  ($('tplName') as HTMLInputElement).focus();
}

function hideTemplateForm() {
  $('quickForm').style.display = 'none';
}

async function saveTemplate() {
  const name = ($('tplName') as HTMLInputElement).value.trim();
  const issueTitle = ($('tplTitle') as HTMLInputElement).value.trim();
  if (!name || !issueTitle || !tplSelectedProject) return;

  const editId = ($('tplEditId') as HTMLInputElement).value;
  const projectInput = ($('tplProjectInput') as HTMLInputElement).value;

  const tpl: IssueTemplate = {
    id: editId || crypto.randomUUID(),
    name,
    title: issueTitle,
    description: ($('tplDesc') as HTMLTextAreaElement).value.trim(),
    projectPath: tplSelectedProject,
    projectName: projectInput,
    estimate: ($('tplEstimate') as HTMLInputElement).value.trim(),
    timeSpent: ($('tplSpent') as HTMLInputElement).value.trim(),
    summary: ($('tplSummary') as HTMLInputElement).value.trim(),
    spentAtTime: ($('tplSpentAtTime') as HTMLInputElement).value.trim() || undefined,
  };

  if (editId) {
    const idx = templates.findIndex((t) => t.id === editId);
    if (idx >= 0) templates[idx] = tpl;
  } else {
    templates.push(tpl);
  }

  await saveTemplates(templates);
  renderTemplateList();
  hideTemplateForm();
}

async function deleteTemplate(id: string) {
  templates = templates.filter((t) => t.id !== id);
  await saveTemplates(templates);
  renderTemplateList();
}

function confirmAndCreateFromTemplate(tplId: string) {
  const tpl = templates.find((t) => t.id === tplId);
  if (!tpl || !tabInfo || !apiToken) return;

  const item = document.querySelector(
    `.quick-item[data-tpl-id="${CSS.escape(tplId)}"]`
  ) as HTMLElement;
  if (!item) return;

  // If already showing confirm, ignore
  if (item.querySelector('.quick-confirm')) return;

  const actionsEl = item.querySelector('.quick-item-actions') as HTMLElement;
  if (actionsEl) actionsEl.style.display = 'none';

  const confirmEl = document.createElement('div');
  confirmEl.className = 'quick-confirm';
  confirmEl.innerHTML = `
    <button class="quick-confirm-btn confirm" data-tpl-id="${tplId}">Create</button>
    <button class="quick-confirm-btn cancel">Cancel</button>
  `;
  item.appendChild(confirmEl);

  confirmEl.querySelector('.cancel')!.addEventListener('click', (e) => {
    e.stopPropagation();
    confirmEl.remove();
    if (actionsEl) actionsEl.style.display = '';
  });

  confirmEl.querySelector('.confirm')!.addEventListener('click', (e) => {
    e.stopPropagation();
    confirmEl.remove();
    executeTemplateCreation(tplId, item, actionsEl);
  });
}

async function executeTemplateCreation(
  tplId: string,
  item: HTMLElement,
  actionsEl: HTMLElement | null
) {
  const tpl = templates.find((t) => t.id === tplId);
  if (!tpl || !tabInfo || !apiToken) return;

  const statusEl = document.createElement('span');
  statusEl.className = 'quick-item-status creating';
  statusEl.textContent = 'Creating...';
  item.appendChild(statusEl);
  item.style.pointerEvents = 'none';

  const encodedProject = encodeURIComponent(tpl.projectPath);
  const baseUrl = `${tabInfo.gitlabUrl}/api/v4`;
  const headers = {
    'Content-Type': 'application/json',
    'PRIVATE-TOKEN': apiToken,
  };

  try {
    const userRes = await fetch(`${baseUrl}/user`, { headers });
    if (!userRes.ok) throw new Error('Auth failed');
    const user = await userRes.json();

    const issueBody: Record<string, any> = {
      title: tpl.title,
      assignee_ids: [user.id],
      labels: 'done',
    };
    if (tpl.description) issueBody.description = tpl.description;

    const issueRes = await fetch(`${baseUrl}/projects/${encodedProject}/issues`, {
      method: 'POST',
      headers,
      body: JSON.stringify(issueBody),
    });
    if (!issueRes.ok) throw new Error(`Failed (${issueRes.status})`);
    const issue = await issueRes.json();

    if (tpl.estimate) {
      await fetch(`${baseUrl}/projects/${encodedProject}/issues/${issue.iid}/time_estimate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ duration: tpl.estimate }),
      });
    }

    if (tpl.timeSpent) {
      const spentBody: Record<string, string> = { duration: tpl.timeSpent };
      if (tpl.summary) spentBody.summary = tpl.summary;
      if (tpl.spentAtTime) {
        const now = new Date();
        const [hours, minutes] = tpl.spentAtTime.split(':').map(Number);
        const spentAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
        spentBody.spent_at = spentAt.toISOString();
      }
      await fetch(`${baseUrl}/projects/${encodedProject}/issues/${issue.iid}/add_spent_time`, {
        method: 'POST',
        headers,
        body: JSON.stringify(spentBody),
      });
    }

    const issueUrl = `${tabInfo!.gitlabUrl}/${tpl.projectPath}/-/issues/${issue.iid}`;
    statusEl.className = 'quick-item-status done';
    statusEl.innerHTML = `<a href="${issueUrl}" target="_blank" class="quick-issue-link">#${issue.iid}</a>`;
    item.style.pointerEvents = '';
    setTimeout(() => {
      statusEl.remove();
      if (actionsEl) actionsEl.style.display = '';
    }, 5000);
  } catch (err: any) {
    statusEl.className = 'quick-item-status failed';
    statusEl.textContent = 'Failed';
    setTimeout(() => {
      statusEl.remove();
      if (actionsEl) actionsEl.style.display = '';
      item.style.pointerEvents = '';
    }, 3000);
  }
}

function setupTemplateProjectAutocomplete() {
  const input = $('tplProjectInput') as HTMLInputElement;
  const dropdown = $('tplProjectDropdown');

  function renderTplDropdown(query: string) {
    const q = query.trim();
    if (allProjects.length === 0) {
      dropdown.style.display = 'none';
      return;
    }

    let items: { project: GitLabProject; score: number; indices: number[] }[];
    if (!q) {
      items = allProjects.map((p) => ({ project: p, score: 0, indices: [] }));
    } else {
      items = [];
      for (const p of allProjects) {
        const nameMatch = fuzzyMatch(p.name_with_namespace, q);
        const pathMatch = fuzzyMatch(p.path_with_namespace, q);
        const best = nameMatch.score >= pathMatch.score ? nameMatch : pathMatch;
        if (best.match) {
          items.push({
            project: p,
            score: best.score,
            indices: best === nameMatch ? best.indices : [],
          });
        }
      }
      items.sort((a, b) => b.score - a.score);
    }

    if (items.length === 0) {
      dropdown.innerHTML = '<div class="project-no-results">No matching projects</div>';
      dropdown.style.display = 'block';
      tplHighlightedIndex = -1;
      return;
    }

    tplHighlightedIndex = -1;
    dropdown.innerHTML = items
      .map((item, i) => {
        const label =
          item.indices.length > 0
            ? highlightMatches(item.project.name_with_namespace, item.indices)
            : escapeHtml(item.project.name_with_namespace);
        return `<div class="project-option" data-index="${i}" data-path="${escapeHtml(item.project.path_with_namespace)}" data-name="${escapeHtml(item.project.name_with_namespace)}">${label}</div>`;
      })
      .join('');
    dropdown.style.display = 'block';
  }

  input.addEventListener('input', () => {
    tplSelectedProject = null;
    $('tplProjectClear').style.display = input.value ? 'block' : 'none';
    renderTplDropdown(input.value);
  });

  input.addEventListener('focus', () => renderTplDropdown(input.value));

  input.addEventListener('keydown', (e) => {
    const options = dropdown.querySelectorAll('.project-option');
    if (!options.length || dropdown.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      tplHighlightedIndex = Math.min(tplHighlightedIndex + 1, options.length - 1);
      options.forEach((o, i) => o.classList.toggle('highlighted', i === tplHighlightedIndex));
      options[tplHighlightedIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      tplHighlightedIndex = Math.max(tplHighlightedIndex - 1, 0);
      options.forEach((o, i) => o.classList.toggle('highlighted', i === tplHighlightedIndex));
      options[tplHighlightedIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (tplHighlightedIndex >= 0 && options[tplHighlightedIndex]) {
        const el = options[tplHighlightedIndex] as HTMLElement;
        tplSelectedProject = el.dataset.path || null;
        input.value = el.dataset.name || '';
        dropdown.style.display = 'none';
        $('tplProjectClear').style.display = 'block';
      }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });

  dropdown.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const option = (e.target as HTMLElement).closest('.project-option') as HTMLElement | null;
    if (option) {
      tplSelectedProject = option.dataset.path || null;
      input.value = option.dataset.name || '';
      dropdown.style.display = 'none';
      $('tplProjectClear').style.display = 'block';
    }
  });

  $('tplProjectClear').addEventListener('click', () => {
    tplSelectedProject = null;
    input.value = '';
    $('tplProjectClear').style.display = 'none';
    input.focus();
  });

  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('#tplProjectAutocomplete')) {
      dropdown.style.display = 'none';
    }
  });
}

// ── Initialize App (API-dependent) ──

function initializeApp() {
  updateSubmitButton();
  updateBoardLink();

  if (apiToken && tabInfo && !cachedUsername) {
    fetchCurrentUsername().then(() => updateBoardLink());
  }

  if (apiToken && tabInfo) {
    loadProjects();
    loadToday();
    loadWeekMini();
  }
}

// ── Onboarding ──

function showOnboarding() {
  document.querySelector('.header')!.setAttribute('style', 'display:none');
  document
    .querySelectorAll('.tab-panel')
    .forEach((p) => ((p as HTMLElement).style.display = 'none'));
  document.querySelector('.footer')!.setAttribute('style', 'display:none');

  const overlay = $('onboarding');
  overlay.style.display = '';

  $('obOpenSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Apply theme early
  const themeMode = await loadThemeMode();
  applyPopupTheme(themeMode);
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.themeMode?.newValue) applyPopupTheme(changes.themeMode.newValue);
    if (changes.gitlabTheme) loadThemeMode().then(applyPopupTheme);
  });

  const settings = await loadSettings();
  apiToken = settings.token;
  selectedProject = settings.lastProject;
  cachedUsername = settings.username;

  const tab = await getCurrentTab();
  if (tab?.url) tabInfo = detectFromUrl(tab.url);

  // Save detected URL, or fall back to saved URL
  if (tabInfo) {
    chrome.storage.sync.set({ lastGitlabUrl: tabInfo.gitlabUrl });
  } else if (settings.gitlabUrl) {
    tabInfo = { gitlabUrl: settings.gitlabUrl, group: '' };
  }

  boardGroupPath = settings.boardGroupPath;

  if (!apiToken) {
    showOnboarding();
  } else {
    initializeApp();
  }

  // Tab switching
  document.querySelectorAll('.tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      tabBtn.classList.add('active');
      const panelId = `panel-${(tabBtn as HTMLElement).dataset.tab}`;
      $(panelId)?.classList.add('active');

      if ((tabBtn as HTMLElement).dataset.tab === 'today') {
        loadToday();
        loadWeekMini();
      }
      if ((tabBtn as HTMLElement).dataset.tab === 'quick') {
        hideTemplateForm();
      }
    });
  });

  // Project autocomplete
  const projectInput = $('projectInput') as HTMLInputElement;
  const projectDropdown = $('projectDropdown');

  projectInput.addEventListener('input', () => {
    // If user edits, clear the selected project
    selectedProject = null;
    $('projectClear').style.display = projectInput.value ? 'block' : 'none';
    renderDropdown(projectInput.value);
    updateSubmitButton();
  });

  projectInput.addEventListener('focus', () => {
    renderDropdown(projectInput.value);
  });

  projectInput.addEventListener('keydown', (e) => {
    const options = projectDropdown.querySelectorAll('.project-option');
    if (!options.length || projectDropdown.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, options.length - 1);
      options.forEach((o, i) => o.classList.toggle('highlighted', i === highlightedIndex));
      options[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      options.forEach((o, i) => o.classList.toggle('highlighted', i === highlightedIndex));
      options[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && options[highlightedIndex]) {
        const el = options[highlightedIndex] as HTMLElement;
        selectProject(el.dataset.path || '', el.dataset.name || '');
      }
    } else if (e.key === 'Escape') {
      projectDropdown.style.display = 'none';
    }
  });

  projectDropdown.addEventListener('mousedown', (e) => {
    e.preventDefault(); // Prevent input blur
    const option = (e.target as HTMLElement).closest('.project-option') as HTMLElement | null;
    if (option) {
      selectProject(option.dataset.path || '', option.dataset.name || '');
    }
  });

  $('projectClear').addEventListener('click', () => {
    clearProject();
    projectInput.focus();
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('#projectAutocomplete')) {
      projectDropdown.style.display = 'none';
    }
  });

  // Options page links
  $('optionsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  $('optionsLink').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Time prefill buttons
  document.querySelectorAll('.time-prefill-btns').forEach((group) => {
    group.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.time-prefill') as HTMLElement | null;
      if (!btn) return;
      const targetId = (group as HTMLElement).dataset.target;
      if (targetId) {
        ($(targetId) as HTMLInputElement).value = btn.dataset.value || '';
      }
    });
  });

  $('ticketTitle').addEventListener('input', updateSubmitButton);
  $('submitBtn').addEventListener('click', createTicket);

  $('todayRefresh').addEventListener('click', () => {
    loadToday(selectedDayDate || undefined);
    loadWeekMini();
  });

  // ── Notes ──
  notes = await loadNotes();
  renderNotes();

  const noteInputHandler = () => {
    const input = $('noteInput') as HTMLInputElement;
    if (input.value.trim()) {
      addNote(input.value);
      input.value = '';
      input.focus();
    }
  };

  $('noteInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') noteInputHandler();
  });

  $('noteAddBtn').addEventListener('click', noteInputHandler);

  $('notesList').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.note-delete') as HTMLElement | null;
    if (btn?.dataset.idx != null) {
      deleteNote(parseInt(btn.dataset.idx, 10));
    }
  });

  // ── Quick Templates ──
  templates = await loadTemplates();
  renderTemplateList();
  setupTemplateProjectAutocomplete();

  $('quickAddBtn').addEventListener('click', () => showTemplateForm());
  $('tplCancelBtn').addEventListener('click', hideTemplateForm);
  $('tplSaveBtn').addEventListener('click', saveTemplate);

  $('quickList').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // Edit button
    const editBtn = target.closest('.quick-item-action.edit') as HTMLElement | null;
    if (editBtn) {
      e.stopPropagation();
      const tpl = templates.find((t) => t.id === editBtn.dataset.tplId);
      if (tpl) showTemplateForm(tpl);
      return;
    }

    // Delete button
    const deleteBtn = target.closest('.quick-item-action.delete') as HTMLElement | null;
    if (deleteBtn) {
      e.stopPropagation();
      if (deleteBtn.dataset.tplId) deleteTemplate(deleteBtn.dataset.tplId);
      return;
    }

    // Ignore clicks on links or status badges
    if (
      target.closest('.quick-issue-link') ||
      target.closest('.quick-item-status') ||
      target.closest('.quick-confirm')
    )
      return;

    // Click on item to create (with confirmation)
    const item = target.closest('.quick-item') as HTMLElement | null;
    if (item?.dataset.tplId) {
      confirmAndCreateFromTemplate(item.dataset.tplId);
    }
  });

  // Board link click
  $('boardLink').addEventListener('click', (e) => {
    const link = $('boardLink') as HTMLAnchorElement;
    if (!link.href || link.href === '#') {
      e.preventDefault();
    }
  });
});
