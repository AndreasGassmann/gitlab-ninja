/**
 * Theme Manager — shared color types and utilities for customizable status/project colors.
 * Used by both the options page (settings UI + preview) and the content script (inject overrides).
 */

export interface CustomColors {
  unestimated: string;
  ready: string;
  active: string;
  warning: string;
  over: string;
  projectPalette: string[];
  projectColors: Record<string, string>; // projectName → hex color
}

export const DEFAULT_COLORS: CustomColors = {
  unestimated: '#9ca3af',
  ready: '#818cf8',
  active: '#34d399',
  warning: '#fbbf24',
  over: '#f87171',
  projectPalette: ['#ff8735', '#34d399', '#60a5fa', '#f87171', '#a78bfa', '#2dd4bf', '#fb923c'],
  projectColors: {},
};

export type StatusKey = keyof Omit<CustomColors, 'projectPalette' | 'projectColors'>;

export type ThemeMode = 'auto' | 'light' | 'dark';

export interface StatusPreset {
  name: string;
  description: string;
  colors: Pick<CustomColors, 'unestimated' | 'ready' | 'active' | 'warning' | 'over'>;
}

export interface ProjectPalettePreset {
  name: string;
  description: string;
  palette: string[];
}

export const STATUS_PRESETS: StatusPreset[] = [
  {
    name: 'Default',
    description: 'Balanced, accessible palette',
    colors: {
      unestimated: '#9ca3af',
      ready: '#818cf8',
      active: '#34d399',
      warning: '#fbbf24',
      over: '#f87171',
    },
  },
  {
    name: 'Ocean',
    description: 'Cool blues and teals',
    colors: {
      unestimated: '#94a3b8',
      ready: '#38bdf8',
      active: '#2dd4bf',
      warning: '#fb923c',
      over: '#f43f5e',
    },
  },
  {
    name: 'Sunset',
    description: 'Warm tones, pinks and golds',
    colors: {
      unestimated: '#a1a1aa',
      ready: '#c084fc',
      active: '#fb923c',
      warning: '#f59e0b',
      over: '#ef4444',
    },
  },
  {
    name: 'Forest',
    description: 'Earthy greens and warm neutrals',
    colors: {
      unestimated: '#a8a29e',
      ready: '#84cc16',
      active: '#22c55e',
      warning: '#eab308',
      over: '#dc2626',
    },
  },
  {
    name: 'Neon',
    description: 'Vivid and high-contrast',
    colors: {
      unestimated: '#71717a',
      ready: '#a78bfa',
      active: '#4ade80',
      warning: '#facc15',
      over: '#ff6b6b',
    },
  },
  {
    name: 'Monochrome',
    description: 'Subtle grayscale with accent',
    colors: {
      unestimated: '#a1a1aa',
      ready: '#a1a1aa',
      active: '#d4d4d8',
      warning: '#fbbf24',
      over: '#f87171',
    },
  },
];

export const PROJECT_PALETTE_PRESETS: ProjectPalettePreset[] = [
  {
    name: 'Default',
    description: 'Warm and colorful',
    palette: ['#ff8735', '#34d399', '#60a5fa', '#f87171', '#a78bfa', '#2dd4bf', '#fb923c'],
  },
  {
    name: 'Ocean',
    description: 'Cool blues and teals',
    palette: ['#0ea5e9', '#14b8a6', '#6366f1', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'],
  },
  {
    name: 'Sunset',
    description: 'Warm pinks and golds',
    palette: ['#f97316', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#6366f1', '#f43f5e'],
  },
  {
    name: 'Forest',
    description: 'Earthy greens and ambers',
    palette: ['#16a34a', '#ca8a04', '#0d9488', '#dc2626', '#7c3aed', '#2563eb', '#ea580c'],
  },
  {
    name: 'Neon',
    description: 'Vivid and high-contrast',
    palette: ['#06ffa5', '#bf5af2', '#ff375f', '#ffd60a', '#5e5ce6', '#64d2ff', '#ff9f0a'],
  },
  {
    name: 'Pastel',
    description: 'Soft and muted',
    palette: ['#fda4af', '#a5b4fc', '#86efac', '#fde68a', '#c4b5fd', '#67e8f9', '#fdba74'],
  },
];

// Keep backward-compatible COLOR_PRESETS (combines status + first matching project palette)
export interface ColorPreset {
  name: string;
  description: string;
  colors: Omit<CustomColors, 'projectColors'>;
}

export const COLOR_PRESETS: ColorPreset[] = STATUS_PRESETS.map((sp) => {
  const pp = PROJECT_PALETTE_PRESETS.find((p) => p.name === sp.name) || PROJECT_PALETTE_PRESETS[0];
  return {
    name: sp.name,
    description: sp.description,
    colors: { ...sp.colors, projectPalette: [...pp.palette] },
  };
});

export const STATUS_META: {
  key: StatusKey;
  label: string;
  description: string;
  sampleTitle: string;
  sampleProject: string;
  sampleIid: number;
  sampleTime: string;
  borderStyle: string;
  pct: number;
}[] = [
  {
    key: 'unestimated',
    label: 'Unestimated',
    description: 'No estimate set',
    sampleTitle: 'Set up CI/CD pipeline for staging',
    sampleProject: 'my-project',
    sampleIid: 42,
    sampleTime: '1d',
    borderStyle: 'dashed',
    pct: 0,
  },
  {
    key: 'ready',
    label: 'Ready',
    description: 'Estimated, no time logged',
    sampleTitle: 'Add search to dashboard',
    sampleProject: 'frontend-app',
    sampleIid: 108,
    sampleTime: '2h',
    borderStyle: 'solid',
    pct: 0,
  },
  {
    key: 'active',
    label: 'Active',
    description: 'In progress, within budget',
    sampleTitle: 'Refactor API endpoint validation',
    sampleProject: 'backend-service',
    sampleIid: 23,
    sampleTime: '0.5h / 4h',
    borderStyle: 'solid',
    pct: 12,
  },
  {
    key: 'warning',
    label: 'Warning',
    description: 'In progress, >80% of budget',
    sampleTitle: 'Update authentication flow for v2',
    sampleProject: 'auth-service',
    sampleIid: 47,
    sampleTime: '3.5h / 4h',
    borderStyle: 'solid',
    pct: 87,
  },
  {
    key: 'over',
    label: 'Over Budget',
    description: 'Spent exceeds estimate',
    sampleTitle: 'Migrate database to new schema',
    sampleProject: 'data-platform',
    sampleIid: 5,
    sampleTime: '5h / 4h',
    borderStyle: 'solid',
    pct: 125,
  },
];

export function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Lighten a hex color for dark-mode chip text */
function lighten(hex: string, amount: number): string {
  const cleaned = hex.replace('#', '');
  const r = Math.min(255, parseInt(cleaned.slice(0, 2), 16) + amount);
  const g = Math.min(255, parseInt(cleaned.slice(2, 4), 16) + amount);
  const b = Math.min(255, parseInt(cleaned.slice(4, 6), 16) + amount);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Generate a CSS string that overrides the default status colors.
 * This is injected as a <style> element on GitLab board pages.
 */
export function generateColorOverrideCSS(colors: CustomColors): string {
  return `
    :root {
      --gn-unestimated: ${colors.unestimated};
      --gn-ready: ${colors.ready};
      --gn-active: ${colors.active};
      --gn-warning: ${colors.warning};
      --gn-over: ${colors.over};
      --gn-unestimated-bg: ${hexToRgba(colors.unestimated, 0.06)};
      --gn-ready-bg: ${hexToRgba(colors.ready, 0.06)};
      --gn-active-bg: ${hexToRgba(colors.active, 0.06)};
      --gn-warning-bg: ${hexToRgba(colors.warning, 0.06)};
      --gn-over-bg: ${hexToRgba(colors.over, 0.08)};
    }
    .gn-time-chip.gn-chip-unestimated { background: ${hexToRgba(colors.unestimated, 0.12)}; }
    .gn-time-chip.gn-chip-unestimated .gn-dot { background: ${colors.unestimated}; }
    .gn-time-chip.gn-chip-ready { background: ${hexToRgba(colors.ready, 0.1)}; }
    .gn-time-chip.gn-chip-ready .gn-dot { background: ${colors.ready}; }
    .gn-time-chip.gn-chip-active { background: ${hexToRgba(colors.active, 0.1)}; }
    .gn-time-chip.gn-chip-active .gn-dot { background: ${colors.active}; }
    .gn-time-chip.gn-chip-warning { background: ${hexToRgba(colors.warning, 0.14)}; }
    .gn-time-chip.gn-chip-warning .gn-dot { background: ${colors.warning}; }
    .gn-time-chip.gn-chip-over { background: ${hexToRgba(colors.over, 0.12)}; }
    .gn-time-chip.gn-chip-over .gn-dot { background: ${colors.over}; }

    .board-card.gn-status-unestimated,
    li.board-card.gn-status-unestimated {
      border-left-color: ${colors.unestimated} !important;
      background-color: ${hexToRgba(colors.unestimated, 0.06)} !important;
    }
    .board-card.gn-status-ready,
    li.board-card.gn-status-ready {
      border-left-color: ${colors.ready} !important;
      background-color: ${hexToRgba(colors.ready, 0.06)} !important;
    }
    .board-card.gn-status-active,
    li.board-card.gn-status-active {
      border-left-color: ${hexToRgba(colors.active, 0.25)} !important;
      background-color: ${hexToRgba(colors.active, 0.06)} !important;
      --gn-bar-color: ${colors.active};
    }
    .board-card.gn-status-warning,
    li.board-card.gn-status-warning {
      border-left-color: ${hexToRgba(colors.warning, 0.25)} !important;
      background-color: ${hexToRgba(colors.warning, 0.06)} !important;
      --gn-bar-color: ${colors.warning};
    }
    .board-card.gn-status-over,
    li.board-card.gn-status-over {
      border-left-color: ${hexToRgba(colors.over, 0.25)} !important;
      background-color: ${hexToRgba(colors.over, 0.08)} !important;
      --gn-bar-color: ${colors.over};
    }

    @media (prefers-color-scheme: dark) {
      .gn-time-chip.gn-chip-ready  { color: ${lighten(colors.ready, 40)}; }
      .gn-time-chip.gn-chip-active { color: ${lighten(colors.active, 40)}; }
      .gn-time-chip.gn-chip-warning { color: ${lighten(colors.warning, 40)}; }
      .gn-time-chip.gn-chip-over   { color: ${lighten(colors.over, 40)}; }
    }
    .gl-dark .gn-time-chip.gn-chip-ready  { color: ${lighten(colors.ready, 40)}; }
    .gl-dark .gn-time-chip.gn-chip-active { color: ${lighten(colors.active, 40)}; }
    .gl-dark .gn-time-chip.gn-chip-warning { color: ${lighten(colors.warning, 40)}; }
    .gl-dark .gn-time-chip.gn-chip-over   { color: ${lighten(colors.over, 40)}; }
  `;
}

export async function loadCustomColors(): Promise<CustomColors> {
  return new Promise((resolve) => {
    chrome.storage.sync.get('customColors', (result) => {
      if (result.customColors) {
        resolve({ ...DEFAULT_COLORS, ...result.customColors });
      } else {
        resolve({ ...DEFAULT_COLORS });
      }
    });
  });
}

export function saveCustomColors(colors: CustomColors): void {
  chrome.storage.sync.set({ customColors: colors });
}

export async function loadThemeMode(): Promise<ThemeMode> {
  return new Promise((resolve) => {
    chrome.storage.sync.get('themeMode', (result) => {
      resolve(result.themeMode || 'auto');
    });
  });
}

export function saveThemeMode(mode: ThemeMode): void {
  chrome.storage.sync.set({ themeMode: mode });
}

/**
 * Inject a <style> element with custom color overrides into the current page.
 * Called from the content script to apply user colors to GitLab board pages.
 */
export function applyColorOverrides(colors: CustomColors): void {
  // Check if colors differ from defaults — skip injection if all default
  const isDefault = (Object.keys(DEFAULT_COLORS) as (keyof CustomColors)[]).every((key) => {
    if (key === 'projectPalette') {
      const a = colors.projectPalette;
      const b = DEFAULT_COLORS.projectPalette;
      return a.length === b.length && a.every((v, i) => v === b[i]);
    }
    if (key === 'projectColors') {
      return Object.keys(colors.projectColors).length === 0;
    }
    return colors[key] === DEFAULT_COLORS[key];
  });

  const styleId = 'gn-custom-colors';
  let styleEl = document.getElementById(styleId);

  if (isDefault) {
    if (styleEl) styleEl.remove();
    return;
  }

  const css = generateColorOverrideCSS(colors);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}
