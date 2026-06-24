/**
 * Background service worker for GitLab Ninja
 * Handles scheduled notifications for time tracking reminders.
 */

import { initWorkSettings } from './utils/workSettings';

interface NotificationSettings {
  enabled: boolean;
  startOfDay: {
    enabled: boolean;
    time: string; // "HH:MM"
    minHours: number; // threshold for previous day
  };
  endOfDay: {
    enabled: boolean;
    time: string; // "HH:MM"
    minHours: number; // threshold for current day
  };
  nagging: {
    enabled: boolean;
    startTime: string; // "HH:MM" - window start
    endTime: string; // "HH:MM" - window end
    intervalHours: number; // how often to nag within the window
    targetHours: number; // full-day target used for pro-rating
  };
}

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  startOfDay: {
    enabled: true,
    time: '08:45',
    minHours: 8,
  },
  endOfDay: {
    enabled: true,
    time: '17:00',
    minHours: 8,
  },
  nagging: {
    enabled: false,
    startTime: '10:00',
    endTime: '16:00',
    intervalHours: 2,
    targetHours: 8,
  },
};

const ALARM_START_OF_DAY = 'gitlab-ninja-start-of-day';
const ALARM_END_OF_DAY = 'gitlab-ninja-end-of-day';
const ALARM_NAGGING = 'gitlab-ninja-nagging';

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getNotificationSettings(): Promise<NotificationSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get('notificationSettings', (result) => {
      const stored = result.notificationSettings;
      if (!stored) {
        resolve(DEFAULT_NOTIFICATION_SETTINGS);
        return;
      }
      // Merge defaults so settings saved before a field existed (e.g. nagging) stay valid.
      resolve({
        ...DEFAULT_NOTIFICATION_SETTINGS,
        ...stored,
        startOfDay: { ...DEFAULT_NOTIFICATION_SETTINGS.startOfDay, ...stored.startOfDay },
        endOfDay: { ...DEFAULT_NOTIFICATION_SETTINGS.endOfDay, ...stored.endOfDay },
        nagging: { ...DEFAULT_NOTIFICATION_SETTINGS.nagging, ...stored.nagging },
      });
    });
  });
}

async function getApiCredentials(): Promise<{ apiToken: string | null; gitlabUrl: string | null }> {
  const [tokenResult, syncResult] = await Promise.all([
    new Promise<any>((resolve) => chrome.storage.local.get('apiToken', resolve)),
    new Promise<any>((resolve) => chrome.storage.sync.get('lastGitlabUrl', resolve)),
  ]);
  return {
    apiToken: tokenResult.apiToken || null,
    gitlabUrl: syncResult.lastGitlabUrl || null,
  };
}

async function fetchDayTimeSpent(date: Date): Promise<number> {
  const { apiToken, gitlabUrl } = await getApiCredentials();
  if (!apiToken || !gitlabUrl) return 0;

  const dateStr = localDateStr(date);
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDateStr = localDateStr(nextDay);

  const query = `query {
    currentUser {
      timelogs(startDate: "${dateStr}", endDate: "${nextDateStr}") {
        nodes {
          timeSpent
          spentAt
        }
      }
    }
  }`;

  try {
    const response = await fetch(`${gitlabUrl}/api/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': apiToken,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) return 0;

    const data = await response.json();
    const nodes = data?.data?.currentUser?.timelogs?.nodes || [];

    let totalSeconds = 0;
    for (const node of nodes) {
      const spentDate = node.spentAt?.split('T')[0] || '';
      if (spentDate === dateStr) {
        totalSeconds += node.timeSpent || 0;
      }
    }
    return totalSeconds;
  } catch {
    return 0;
  }
}

function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0 && m === 0) return '0h';
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function getPreviousWorkday(date: Date): Date {
  const prev = new Date(date);
  do {
    prev.setDate(prev.getDate() - 1);
  } while (!isWeekday(prev));
  return prev;
}

function timeStrToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

function getNextAlarmTime(timeStr: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const now = new Date();
  const alarm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);

  // If the time has already passed today, schedule for tomorrow
  if (alarm <= now) {
    alarm.setDate(alarm.getDate() + 1);
  }

  return alarm;
}

async function scheduleAlarms(): Promise<void> {
  // Clear existing alarms
  await chrome.alarms.clear(ALARM_START_OF_DAY);
  await chrome.alarms.clear(ALARM_END_OF_DAY);
  await chrome.alarms.clear(ALARM_NAGGING);

  const settings = await getNotificationSettings();
  if (!settings.enabled) return;

  if (settings.startOfDay.enabled) {
    const nextTime = getNextAlarmTime(settings.startOfDay.time);
    chrome.alarms.create(ALARM_START_OF_DAY, {
      when: nextTime.getTime(),
      periodInMinutes: 24 * 60, // repeat daily
    });
  }

  if (settings.endOfDay.enabled) {
    const nextTime = getNextAlarmTime(settings.endOfDay.time);
    chrome.alarms.create(ALARM_END_OF_DAY, {
      when: nextTime.getTime(),
      periodInMinutes: 24 * 60, // repeat daily
    });
  }

  if (settings.nagging.enabled) {
    // Repeat on the interval; fires outside the window are filtered in handleNaggingAlarm.
    const interval = Math.max(0.25, settings.nagging.intervalHours);
    const nextTime = getNextNagTime(settings.nagging.startTime, settings.nagging.endTime, interval);
    chrome.alarms.create(ALARM_NAGGING, {
      when: nextTime.getTime(),
      periodInMinutes: interval * 60,
    });
  }
}

// Soonest interval-aligned slot inside today's window, else the window start tomorrow.
function getNextNagTime(startTime: string, endTime: string, intervalHours: number): Date {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = timeStrToMinutes(startTime);
  const endMin = timeStrToMinutes(endTime);
  const intervalMin = intervalHours * 60;

  const at = (minutes: number, dayOffset: number): Date => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    d.setDate(d.getDate() + dayOffset);
    d.setMinutes(minutes);
    return d;
  };

  if (nowMin < startMin) return at(startMin, 0);
  if (nowMin <= endMin) {
    const slotsElapsed = Math.ceil((nowMin - startMin) / intervalMin);
    const nextSlot = startMin + slotsElapsed * intervalMin;
    if (nextSlot <= endMin) return at(nextSlot, 0);
  }
  return at(startMin, 1);
}

async function handleStartOfDayAlarm(): Promise<void> {
  await initWorkSettings();
  const now = new Date();
  // Only fire on weekdays
  if (!isWeekday(now)) return;

  const settings = await getNotificationSettings();
  if (!settings.enabled || !settings.startOfDay.enabled) return;

  const previousWorkday = getPreviousWorkday(now);
  const totalSeconds = await fetchDayTimeSpent(previousWorkday);
  const thresholdSeconds = settings.startOfDay.minHours * 3600;

  if (totalSeconds < thresholdSeconds) {
    const logged = formatHours(totalSeconds);
    const target = `${settings.startOfDay.minHours}h`;
    const dayName = previousWorkday.toLocaleDateString('en-US', { weekday: 'long' });

    chrome.notifications.create(`start-of-day-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'GitLab Ninja - Time Log Reminder',
      message: `You only logged ${logged} on ${dayName} (target: ${target}). Don't forget to log your remaining time!`,
      priority: 1,
    });
  }
}

async function handleEndOfDayAlarm(): Promise<void> {
  await initWorkSettings();
  const now = new Date();
  // Only fire on weekdays
  if (!isWeekday(now)) return;

  const settings = await getNotificationSettings();
  if (!settings.enabled || !settings.endOfDay.enabled) return;

  const totalSeconds = await fetchDayTimeSpent(now);
  const thresholdSeconds = settings.endOfDay.minHours * 3600;

  if (totalSeconds < thresholdSeconds) {
    const logged = formatHours(totalSeconds);
    const target = `${settings.endOfDay.minHours}h`;

    chrome.notifications.create(`end-of-day-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'GitLab Ninja - End of Day Reminder',
      message: `You've logged ${logged} today (target: ${target}). Remember to log your time before you leave!`,
      priority: 1,
    });
  }
}

async function handleNaggingAlarm(): Promise<void> {
  await initWorkSettings();
  const now = new Date();
  // Only fire on weekdays
  if (!isWeekday(now)) return;

  const settings = await getNotificationSettings();
  if (!settings.enabled || !settings.nagging.enabled) return;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = timeStrToMinutes(settings.nagging.startTime);
  const endMin = timeStrToMinutes(settings.nagging.endTime);
  // Outside today's window — alarm interval doesn't align to the window, so skip.
  if (nowMin < startMin || nowMin > endMin) return;

  const totalSeconds = await fetchDayTimeSpent(now);

  // Pro-rate the daily target by how far we are through the window.
  const span = Math.max(1, endMin - startMin);
  const fraction = Math.min(1, Math.max(0, (nowMin - startMin) / span));
  const expectedSeconds = settings.nagging.targetHours * 3600 * fraction;

  if (totalSeconds < expectedSeconds) {
    const logged = formatHours(totalSeconds);
    const expected = formatHours(expectedSeconds);

    chrome.notifications.create(`nagging-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'GitLab Ninja - Time Log Reminder',
      message: `You've logged ${logged} so far — about ${expected} expected by now. Keep logging your time!`,
      priority: 1,
    });
  }
}

// Listen for alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_START_OF_DAY) {
    handleStartOfDayAlarm();
  } else if (alarm.name === ALARM_END_OF_DAY) {
    handleEndOfDayAlarm();
  } else if (alarm.name === ALARM_NAGGING) {
    handleNaggingAlarm();
  }
});

// ── Dynamic content script registration for self-hosted GitLab ──

const DYNAMIC_CONTENT_SCRIPT_ID = 'gitlab-ninja-custom-domain';
const DYNAMIC_INJECTED_SCRIPT_ID = 'gitlab-ninja-custom-domain-injected';

// Serialize calls to avoid duplicate registration races
let registerPromise: Promise<void> = Promise.resolve();
function registerCustomDomainScript(): Promise<void> {
  registerPromise = registerPromise.then(
    registerCustomDomainScriptImpl,
    registerCustomDomainScriptImpl
  );
  return registerPromise;
}

async function registerCustomDomainScriptImpl(): Promise<void> {
  // Unregister any existing dynamic scripts
  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: [DYNAMIC_CONTENT_SCRIPT_ID, DYNAMIC_INJECTED_SCRIPT_ID],
  });
  if (existing.length > 0) {
    await chrome.scripting.unregisterContentScripts({
      ids: existing.map((s) => s.id),
    });
  }

  const result = await new Promise<{ lastGitlabUrl?: string }>((resolve) => {
    chrome.storage.sync.get('lastGitlabUrl', resolve);
  });

  const gitlabUrl = result.lastGitlabUrl;
  if (!gitlabUrl) return;

  let hostname: string;
  try {
    hostname = new URL(gitlabUrl).hostname;
  } catch {
    return;
  }

  // Skip if it's already covered by the static manifest pattern
  if (hostname === 'gitlab.com') return;

  const pattern = `https://${hostname}/*/boards*`;

  // Check if we have permission for this host
  const hasPermission = await chrome.permissions.contains({ origins: [`https://${hostname}/*`] });
  if (!hasPermission) return;

  await chrome.scripting.registerContentScripts([
    {
      id: DYNAMIC_CONTENT_SCRIPT_ID,
      matches: [pattern],
      js: ['content.js'],
      css: ['styles.css'],
      runAt: 'document_start',
    },
    {
      id: DYNAMIC_INJECTED_SCRIPT_ID,
      matches: [pattern],
      js: ['injected.js'],
      runAt: 'document_start',
      world: 'MAIN' as any,
    },
  ]);
}

// Re-schedule alarms when settings change
chrome.storage.onChanged.addListener((changes) => {
  if (changes.notificationSettings) {
    scheduleAlarms();
  }
  if (changes.lastGitlabUrl) {
    registerCustomDomainScript();
  }
});

// Schedule alarms and register custom domain on install/update
chrome.runtime.onInstalled.addListener(() => {
  scheduleAlarms();
  registerCustomDomainScript();
});

// Schedule alarms and register custom domain on browser startup
chrome.runtime.onStartup.addListener(() => {
  scheduleAlarms();
  registerCustomDomainScript();
});

// Also schedule on service worker activation (in case it was suspended)
scheduleAlarms();
registerCustomDomainScript();
