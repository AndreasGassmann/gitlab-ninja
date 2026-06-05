/**
 * Type definitions for GitLab Ninja extension
 */

export interface TimeInfo {
  spent: number; // in hours
  estimate: number; // in hours
  dueDate?: string | null; // ISO date string (YYYY-MM-DD) or null
}

export interface ExtensionConfig {
  checkInterval: number;
  debounceDelay: number;
}

export type TimeUnit = 'w' | 'd' | 'h' | 'm';
