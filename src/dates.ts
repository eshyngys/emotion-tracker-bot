/** Returns the current local date/time in the configured timezone, as a Date-like set of fields. */
export function localNow(offsetMinutes: number): Date {
  return new Date(Date.now() + offsetMinutes * 60_000);
}

/** "YYYY-MM-DD" for a shifted (already-offset) Date, read via UTC getters to avoid host-TZ interference. */
export function dateKey(shiftedDate: Date): string {
  const y = shiftedDate.getUTCFullYear();
  const m = String(shiftedDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shiftedDate.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const WEEKDAYS_RU = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
];

export function weekdayRu(dateKeyStr: string): string {
  const [y, m, d] = dateKeyStr.split("-").map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d));
  return WEEKDAYS_RU[utcDate.getUTCDay()];
}

/**
 * Given today's local date key and a local window [startHour, endHour), picks a uniformly random
 * instant inside that window and returns it as a real UTC Date.
 */
export function randomTargetForToday(
  todayKeyStr: string,
  windowStartHour: number,
  windowEndHour: number,
  offsetMinutes: number
): Date {
  const [y, m, d] = todayKeyStr.split("-").map(Number);
  const startMinuteOfDay = windowStartHour * 60;
  const endMinuteOfDay = windowEndHour * 60;
  const randomMinuteOfDay =
    startMinuteOfDay + Math.floor(Math.random() * (endMinuteOfDay - startMinuteOfDay));

  // Build the instant as if it were UTC at the local wall-clock time, then subtract the
  // timezone offset to get the true UTC instant (local = UTC + offset  =>  UTC = local - offset).
  const asIfUtc = new Date(Date.UTC(y, m - 1, d, 0, randomMinuteOfDay));
  return new Date(asIfUtc.getTime() - offsetMinutes * 60_000);
}

/** Last `days` local date keys ending today (inclusive), oldest first. */
export function lastNDateKeys(offsetMinutes: number, days: number): string[] {
  const now = localNow(offsetMinutes);
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    keys.push(dateKey(d));
  }
  return keys;
}
