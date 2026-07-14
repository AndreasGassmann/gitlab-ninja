import { describe, it, expect, beforeEach } from 'vitest';
import { installChromeMock } from '../test/chromeMock';
import {
  AssignedIssue,
  DEFAULT_REPORT_SETTINGS,
  ReportIssue,
  ReportSettings,
  buildReport,
  dueDateCutoff,
  dueSoonIssues,
  isDone,
  isIgnored,
  loadReportSettings,
  reportPeriodStart,
  saveReportSettings,
} from './weeklyReport';

function issue(overrides: Partial<ReportIssue> = {}): ReportIssue {
  return {
    issueIid: 41971,
    issueTitle: 'Extend management backend with Smoldot endpoint',
    issueUrl: 'https://gitlab.example.com/papers/internal/-/issues/41971',
    issueState: 'opened',
    projectName: 'internal',
    labels: [],
    timeSpent: 3600,
    ...overrides,
  };
}

describe('isDone', () => {
  it('closed issue is done', () => {
    expect(isDone(issue({ issueState: 'closed' }), 'done')).toBe(true);
  });

  it('open issue without done label is not done', () => {
    expect(isDone(issue({ labels: ['doing'] }), 'done')).toBe(false);
  });

  it('done label matches case-insensitively', () => {
    expect(isDone(issue({ labels: ['Done'] }), 'done')).toBe(true);
  });

  it('supports multiple comma-separated done labels', () => {
    expect(isDone(issue({ labels: ['deployed'] }), 'done, deployed')).toBe(true);
  });

  it('empty done-labels setting only counts closed issues', () => {
    expect(isDone(issue({ labels: ['done'] }), '')).toBe(false);
    expect(isDone(issue({ issueState: 'closed' }), '')).toBe(true);
  });
});

describe('buildReport', () => {
  const settings: ReportSettings = {
    template: 'DONE:\n{{done}}\n\nWIP:\n{{inProgress}}',
    itemTemplate: '• {{title}} {{url}}',
    doneLabels: 'done',
    emptyText: 'None this week',
    dueWindow: 'nextMonday',
    startDay: 1,
    ignoreTitles: '',
  };

  it('splits issues into done and in-progress sections', () => {
    const report = buildReport(
      [
        issue({ issueState: 'closed', issueTitle: 'Finished thing', issueUrl: 'https://a' }),
        issue({ issueTitle: 'Ongoing thing', issueUrl: 'https://b' }),
      ],
      settings
    );
    expect(report).toBe('DONE:\n• Finished thing https://a\n\nWIP:\n• Ongoing thing https://b');
  });

  it('uses emptyText for empty sections', () => {
    const report = buildReport([issue()], settings);
    expect(report).toContain('DONE:\nNone this week');
  });

  it('fills all item placeholders', () => {
    const report = buildReport([issue({ issueState: 'closed', timeSpent: 5400 })], {
      ...settings,
      itemTemplate: '{{project}}#{{iid}}: {{title}} ({{timeSpent}}) {{url}}',
    });
    expect(report).toContain(
      'internal#41971: Extend management backend with Smoldot endpoint (1h 30m) https://gitlab.example.com/papers/internal/-/issues/41971'
    );
  });

  it('keeps template text outside placeholders verbatim', () => {
    const report = buildReport([], {
      ...settings,
      template: 'Hello.\n\n{{done}}\n\n—— BLOCKED  ——\n\nNone this week\n\nCheers,',
    });
    expect(report).toBe('Hello.\n\nNone this week\n\n—— BLOCKED  ——\n\nNone this week\n\nCheers,');
  });

  it('default template renders with real sections', () => {
    const report = buildReport(
      [
        issue({ issueState: 'closed', issueTitle: 'A', issueUrl: 'https://a' }),
        issue({ issueTitle: 'B', issueUrl: 'https://b' }),
      ],
      DEFAULT_REPORT_SETTINGS
    );
    expect(report).toContain('—— DONE THIS WEEK ——\n\n• A https://a');
    expect(report).toContain('—— IN PROGRESS  ——\n\n• B https://b');
    expect(report).toContain('—— BLOCKED  ——');
    expect(report.endsWith('Cheers,')).toBe(true);
  });
});

describe('dueDateCutoff', () => {
  it('nextMonday from a Thursday is the coming Monday', () => {
    // 2026-07-16 is a Thursday
    expect(dueDateCutoff('nextMonday', new Date(2026, 6, 16))).toBe('2026-07-20');
  });

  it('nextMonday from a Monday is the following Monday, not today', () => {
    // 2026-07-13 is a Monday
    expect(dueDateCutoff('nextMonday', new Date(2026, 6, 13))).toBe('2026-07-20');
  });

  it('nextMonday from a Sunday is tomorrow', () => {
    // 2026-07-19 is a Sunday
    expect(dueDateCutoff('nextMonday', new Date(2026, 6, 19))).toBe('2026-07-20');
  });

  it('twoWeeks and fourWeeks add fixed day counts', () => {
    expect(dueDateCutoff('twoWeeks', new Date(2026, 6, 16))).toBe('2026-07-30');
    expect(dueDateCutoff('fourWeeks', new Date(2026, 6, 16))).toBe('2026-08-13');
  });

  it('none returns null', () => {
    expect(dueDateCutoff('none', new Date(2026, 6, 16))).toBe(null);
  });
});

describe('dueSoonIssues', () => {
  function assigned(overrides: Partial<AssignedIssue> = {}): AssignedIssue {
    return { ...issue(), dueDate: '2026-07-20', ...overrides };
  }

  it('keeps assigned issues due on or before the cutoff', () => {
    const extras = dueSoonIssues(
      [],
      [
        assigned({ issueUrl: 'https://a', dueDate: '2026-07-20' }),
        assigned({ issueUrl: 'https://b', dueDate: '2026-07-21' }),
      ],
      '2026-07-20'
    );
    expect(extras.map((i) => i.issueUrl)).toEqual(['https://a']);
  });

  it('skips issues without a due date', () => {
    expect(dueSoonIssues([], [assigned({ dueDate: null })], '2026-07-20')).toEqual([]);
  });

  it('dedupes against already-timelogged issues by URL', () => {
    const logged = issue({ issueUrl: 'https://a' });
    expect(dueSoonIssues([logged], [assigned({ issueUrl: 'https://a' })], '2026-07-20')).toEqual(
      []
    );
  });

  it('null cutoff returns nothing', () => {
    expect(dueSoonIssues([issue()], [assigned()], null)).toEqual([]);
  });
});

describe('reportPeriodStart', () => {
  it('Monday start from a Thursday is this week Monday', () => {
    // 2026-07-16 is a Thursday
    expect(reportPeriodStart(1, new Date(2026, 6, 16))).toEqual(new Date(2026, 6, 13));
  });

  it('Monday start on a Monday is today', () => {
    expect(reportPeriodStart(1, new Date(2026, 6, 13))).toEqual(new Date(2026, 6, 13));
  });

  it('Friday start from a Thursday is last week Friday', () => {
    expect(reportPeriodStart(5, new Date(2026, 6, 16))).toEqual(new Date(2026, 6, 10));
  });
});

describe('isIgnored', () => {
  it('matches title substrings case-insensitively', () => {
    expect(isIgnored(issue({ issueTitle: 'Daily Standup Meeting' }), 'standup')).toBe(true);
  });

  it('supports multiple comma-separated patterns', () => {
    expect(isIgnored(issue({ issueTitle: 'Weekly sync' }), 'standup, sync')).toBe(true);
  });

  it('empty setting ignores nothing', () => {
    expect(isIgnored(issue({ issueTitle: 'Standup' }), '')).toBe(false);
  });
});

describe('buildReport with extras and ignores', () => {
  const settings: ReportSettings = {
    template: 'DONE:\n{{done}}\n\nWIP:\n{{inProgress}}',
    itemTemplate: '• {{title}}',
    doneLabels: 'done',
    emptyText: 'None',
    dueWindow: 'nextMonday',
    startDay: 1,
    ignoreTitles: 'standup',
  };

  it('extras land in inProgress even with a done label', () => {
    const report = buildReport([], settings, [issue({ issueTitle: 'Due soon', labels: ['done'] })]);
    expect(report).toBe('DONE:\nNone\n\nWIP:\n• Due soon');
  });

  it('ignored titles are dropped from both sections', () => {
    const report = buildReport(
      [
        issue({ issueTitle: 'Daily Standup', issueState: 'closed' }),
        issue({ issueTitle: 'Real work' }),
      ],
      settings,
      [issue({ issueTitle: 'Standup planning' })]
    );
    expect(report).toBe('DONE:\nNone\n\nWIP:\n• Real work');
  });
});

describe('report settings storage', () => {
  beforeEach(() => installChromeMock());

  it('returns defaults when nothing stored', async () => {
    expect(await loadReportSettings()).toEqual(DEFAULT_REPORT_SETTINGS);
  });

  it('merges partial stored settings over defaults', async () => {
    saveReportSettings({ ...DEFAULT_REPORT_SETTINGS, doneLabels: 'done, shipped' });
    const loaded = await loadReportSettings();
    expect(loaded.doneLabels).toBe('done, shipped');
    expect(loaded.itemTemplate).toBe(DEFAULT_REPORT_SETTINGS.itemTemplate);
  });
});
