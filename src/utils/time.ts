/**
 * Time parsing and formatting utilities
 */

import { TimeUnit } from '../types';
import { getWorkSettings } from './workSettings';

/**
 * Parse time string (e.g., "2h", "1d", "30m") to hours
 */
export function parseTimeToHours(timeStr: string | null | undefined): number {
  if (!timeStr) return 0;

  const match = timeStr.match(/(\d+(?:\.\d+)?)\s*([hdmw])/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase() as TimeUnit;

  const { hoursPerDay, hoursPerWeek } = getWorkSettings();
  switch (unit) {
    case 'w':
      return value * hoursPerWeek;
    case 'd':
      return value * hoursPerDay;
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
  const { hoursPerDay, hoursPerWeek } = getWorkSettings();

  if (hours >= hoursPerWeek) {
    const weeks = Math.floor(hours / hoursPerWeek);
    const remainingHours = hours % hoursPerWeek;
    return remainingHours > 0 ? `${weeks}w ${remainingHours}h` : `${weeks}w`;
  }

  if (hours >= hoursPerDay) {
    const days = Math.floor(hours / hoursPerDay);
    const remainingHours = hours % hoursPerDay;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }

  return `${hours}h`;
}
