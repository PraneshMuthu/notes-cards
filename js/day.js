// "Today" for the app rolls over at 04:00 local time, not midnight, so late-night
// sessions count toward the previous day.

const pad = (n) => String(n).padStart(2, '0');

/**
 * Returns the local-time calendar day (YYYY-MM-DD) of `date` shifted back by `cutoffHour` hours.
 * @param {Date} date
 * @param {number} [cutoffHour=4]
 * @returns {string}
 */
export function dayKey(date, cutoffHour = 4) {
  const shifted = new Date(date.getTime() - cutoffHour * 60 * 60 * 1000);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}
