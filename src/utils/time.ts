/**
 * Time parsing and formatting utilities
 */

import { TimeUnit } from '../types';

/**
 * Parse time string (e.g., "2h", "1d", "30m") to hours
 */
export function parseTimeToHours(timeStr: string | null | undefined): number {
  if (!timeStr) return 0;

  const match = timeStr.match(/(\d+(?:\.\d+)?)\s*([hdmw])/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase() as TimeUnit;

  switch (unit) {
    case 'w':
      return value * 40; // 1 week = 40 hours
    case 'd':
      return value * 8; // 1 day = 8 hours
    case 'h':
      return value;
    case 'm':
      return value / 60;
    default:
      return 0;
  }
}

/**
 * Format hours to readable string
 */
export function formatHours(hours: number): string {
  if (hours === 0) return '0h';

  if (hours >= 40) {
    const weeks = Math.floor(hours / 40);
    const remainingHours = hours % 40;
    return remainingHours > 0 ? `${weeks}w ${remainingHours}h` : `${weeks}w`;
  }

  if (hours >= 8) {
    const days = Math.floor(hours / 8);
    const remainingHours = hours % 8;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }

  return `${hours}h`;
}
