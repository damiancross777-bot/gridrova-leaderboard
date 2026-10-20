// All competition time comes from here so tests can drive the clock deterministically.
let override: (() => number) | null = null;

export function now(): number {
  return override ? override() : Date.now();
}

/** Test hook only. Never called by production code paths. */
export function setClockForTests(fn: (() => number) | null): void {
  override = fn;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** True only for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isValidDate(date: unknown): date is string {
  if (typeof date !== "string" || !DATE_RE.test(date)) return false;
  const t = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(t) && utcDay(t) === date;
}

export function dayStart(date: string): number {
  return Date.parse(date + "T00:00:00Z");
}

/** The instant a competition date stops accepting finishes (next UTC midnight). */
export function closesAt(date: string): number {
  return dayStart(date) + 86_400_000;
}

export function addDays(date: string, days: number): string {
  return utcDay(dayStart(date) + days * 86_400_000);
}
