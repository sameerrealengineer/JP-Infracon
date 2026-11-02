/**
 * Start time for a record that must apply immediately. MySQL TIMESTAMP columns keep whole
 * seconds and round fractions, so "now" can be stored up to half a second in the future and the
 * record would not yet count as effective. Taking the previous whole second avoids that.
 */
export function effectiveNow(now = new Date()): Date {
  return new Date(Math.floor(now.getTime() / 1000) * 1000 - 1000);
}
