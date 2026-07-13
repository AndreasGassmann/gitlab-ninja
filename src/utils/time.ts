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

  // Work in whole minutes to avoid float artifacts like "0.16666666666666h"
  let totalMinutes = Math.round(hours * 60);
  if (totalMinutes === 0) return '0h';

  const minutesPerDay = Math.round(hoursPerDay * 60);
  const minutesPerWeek = Math.round(hoursPerWeek * 60);

  const weeks = Math.floor(totalMinutes / minutesPerWeek);
  totalMinutes %= minutesPerWeek;
  const days = Math.floor(totalMinutes / minutesPerDay);
  totalMinutes %= minutesPerDay;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;

  const parts: string[] = [];
  if (weeks > 0) parts.push(`${weeks}w`);
  if (days > 0) parts.push(`${days}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  return parts.join(' ');
}
