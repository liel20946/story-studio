import type { ScheduleRepeat, ScheduledRun } from "./contract-types";

export interface ScheduleTiming {
  repeat: ScheduleRepeat;
  /** Date portion for one-time schedules (local). */
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
}

const REPEAT_OPTIONS = [
  { value: "once" as const, label: "Once" },
  { value: "daily" as const, label: "Daily" },
  { value: "weekly" as const, label: "Weekly" },
] as const;

export { REPEAT_OPTIONS };

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function weekdayLabel(day: number): string {
  return WEEKDAY_LABELS[day] ?? "Sun";
}

export function defaultScheduleTiming(): ScheduleTiming {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return {
    repeat: "once",
    year: d.getFullYear(),
    month: d.getMonth(),
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    dayOfWeek: d.getDay(),
  };
}

export function scheduledRunToTiming(run: ScheduledRun): ScheduleTiming {
  const d = new Date(run.scheduledAt);
  return {
    repeat: run.repeat ?? "once",
    year: d.getFullYear(),
    month: d.getMonth(),
    day: d.getDate(),
    hour: run.hour ?? d.getHours(),
    minute: run.minute ?? d.getMinutes(),
    dayOfWeek: run.dayOfWeek ?? d.getDay(),
  };
}

function atLocalTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  return new Date(year, month, day, hour, minute, 0, 0).getTime();
}

/** Next occurrence at or after `fromMs` for daily/weekly; exact datetime for once. */
export function computeNextRunAt(timing: ScheduleTiming, fromMs = Date.now()): number {
  if (timing.repeat === "once") {
    return atLocalTime(
      timing.year,
      timing.month,
      timing.day,
      timing.hour,
      timing.minute,
    );
  }

  const from = new Date(fromMs);
  if (timing.repeat === "daily") {
    let candidate = atLocalTime(
      from.getFullYear(),
      from.getMonth(),
      from.getDate(),
      timing.hour,
      timing.minute,
    );
    if (candidate <= fromMs) {
      const next = new Date(from);
      next.setDate(next.getDate() + 1);
      candidate = atLocalTime(
        next.getFullYear(),
        next.getMonth(),
        next.getDate(),
        timing.hour,
        timing.minute,
      );
    }
    return candidate;
  }

  // weekly
  const targetDay = timing.dayOfWeek;
  const cursor = new Date(from);
  cursor.setHours(timing.hour, timing.minute, 0, 0);
  for (let i = 0; i < 8; i++) {
    if (cursor.getDay() === targetDay && cursor.getTime() > fromMs) {
      return cursor.getTime();
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(timing.hour, timing.minute, 0, 0);
  }
  return cursor.getTime();
}

const TIME_24H: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatScheduleDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatScheduleSummary(timing: ScheduleTiming): string {
  const time = formatTime(timing.hour, timing.minute);
  if (timing.repeat === "once") {
    const d = new Date(
      timing.year,
      timing.month,
      timing.day,
      timing.hour,
      timing.minute,
    );
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      ...TIME_24H,
    });
  }
  if (timing.repeat === "daily") {
    return `Every day at ${time}`;
  }
  return `Every ${weekdayLabel(timing.dayOfWeek)} at ${time}`;
}

export function formatScheduledRunSummary(run: ScheduledRun): string {
  return formatScheduleSummary(scheduledRunToTiming(run));
}

/** Compact date+time for schedule list rows (home upcoming, etc.). */
export function formatUpcomingScheduleLabel(run: ScheduledRun): string {
  const timing = scheduledRunToTiming(run);
  if (timing.repeat !== "once") {
    return formatScheduleSummary(timing);
  }

  const d = new Date(
    timing.year,
    timing.month,
    timing.day,
    timing.hour,
    timing.minute,
  );
  const now = new Date();
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
    ...TIME_24H,
  });
}

export function timingPayload(timing: ScheduleTiming) {
  const scheduledAt = computeNextRunAt(timing);
  return {
    repeat: timing.repeat,
    scheduledAt,
    hour: timing.hour,
    minute: timing.minute,
    dayOfWeek: timing.repeat === "weekly" ? timing.dayOfWeek : undefined,
  };
}

/** Bump a one-time schedule to the next future local date/time, preserving clock time. */
export function ensureFutureOnceTiming(timing: ScheduleTiming): ScheduleTiming {
  if (timing.repeat !== "once") return timing;
  if (computeNextRunAt(timing) > Date.now()) return timing;

  const d = new Date();
  d.setHours(timing.hour, timing.minute, 0, 0);
  if (d.getTime() <= Date.now()) {
    d.setDate(d.getDate() + 1);
  }
  return {
    ...timing,
    year: d.getFullYear(),
    month: d.getMonth(),
    day: d.getDate(),
  };
}

export function calendarDays(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }
  return cells;
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function isSameDay(a: Date, b: { year: number; month: number; day: number }): boolean {
  return (
    a.getFullYear() === b.year &&
    a.getMonth() === b.month &&
    a.getDate() === b.day
  );
}

export function isToday(date: Date): boolean {
  return isSameDay(date, {
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    day: new Date().getDate(),
  });
}
