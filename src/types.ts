/**
 * Type definitions for GitLab Ninja extension
 */

export interface TimeInfo {
  spent: number; // in hours
  estimate: number; // in hours
}

export interface ExtensionConfig {
  checkInterval: number;
  debounceDelay: number;
}

export type TimeUnit = 'w' | 'd' | 'h' | 'm';
