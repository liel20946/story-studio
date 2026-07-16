import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import { app } from "../electron-api.js";
import { broadcast } from "../broadcast.js";
import { listRuns, buildLastRunMap } from "./run-service.js";
import { getStory } from "./stories-service.js";
import { startBulkRun } from "./bulk-runner.js";
import { startAgentRun } from "./agent-runner.js";
import { resolveAgentBinary } from "./agent-provider.js";
import { formatStoryForRun } from "./bowser-stories-service.js";
import { getSettingsValue } from "../handlers/settings.js";
import { getAgentRunConfig } from "./agent-config.js";
import type { ScheduleRepeat, ScheduledRun } from "./contract-types.js";

const SCHEDULES_FILE = () => path.join(app.getPath("userData"), "schedules.json");

let _schedules: ScheduledRun[] = [];
let _loaded = false;
let _timer: ReturnType<typeof setInterval> | null = null;
let _checking = false;

async function load(): Promise<void> {
  if (_loaded) return;
  try {
    const data = await fs.readFile(SCHEDULES_FILE(), "utf-8");
    const parsed = JSON.parse(data) as ScheduledRun[];
    const seen = new Set<string>();
    _schedules = parsed.filter((schedule) => {
      if (seen.has(schedule.id)) return false;
      seen.add(schedule.id);
      return true;
    });
    if (_schedules.length !== parsed.length) {
      await persist();
    }
  } catch {
    _schedules = [];
  }
  _loaded = true;
}

async function persist(): Promise<void> {
  await fs.writeFile(SCHEDULES_FILE(), JSON.stringify(_schedules, null, 2), "utf-8");
}

async function notifyChanged(): Promise<void> {
  broadcast("schedules:changed", await listSchedules());
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

function computeNextRunAt(
  repeat: ScheduleRepeat,
  scheduledAt: number,
  hour: number,
  minute: number,
  dayOfWeek: number | undefined,
  fromMs = Date.now(),
): number {
  if (repeat === "once") return scheduledAt;

  const from = new Date(fromMs);
  if (repeat === "daily") {
    let candidate = atLocalTime(
      from.getFullYear(),
      from.getMonth(),
      from.getDate(),
      hour,
      minute,
    );
    if (candidate <= fromMs) {
      const next = new Date(from);
      next.setDate(next.getDate() + 1);
      candidate = atLocalTime(
        next.getFullYear(),
        next.getMonth(),
        next.getDate(),
        hour,
        minute,
      );
    }
    return candidate;
  }

  const targetDay = dayOfWeek ?? 0;
  const cursor = new Date(from);
  cursor.setHours(hour, minute, 0, 0);
  for (let i = 0; i < 8; i++) {
    if (cursor.getDay() === targetDay && cursor.getTime() > fromMs) {
      return cursor.getTime();
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(hour, minute, 0, 0);
  }
  return cursor.getTime();
}

function normalizeSchedule(raw: ScheduledRun): ScheduledRun {
  const repeat = raw.repeat ?? "once";
  const d = new Date(raw.scheduledAt);
  const hour = raw.hour ?? d.getHours();
  const minute = raw.minute ?? d.getMinutes();
  const dayOfWeek = raw.dayOfWeek ?? d.getDay();
  const scheduledAt =
    repeat === "once"
      ? raw.scheduledAt
      : computeNextRunAt(repeat, raw.scheduledAt, hour, minute, dayOfWeek);
  return { ...raw, repeat, hour, minute, dayOfWeek, scheduledAt };
}

export async function listSchedules(): Promise<ScheduledRun[]> {
  await load();
  return _schedules
    .slice()
    .map(normalizeSchedule)
    .sort((a, b) => a.scheduledAt - b.scheduledAt);
}

export async function getSchedule(id: string): Promise<ScheduledRun> {
  await load();
  const schedule = _schedules.find((s) => s.id === id);
  if (!schedule) throw new Error(`Schedule not found: ${id}`);
  return normalizeSchedule(schedule);
}

export async function createSchedule(input: {
  name: string;
  storyNames: string[];
  scheduledAt: number;
  repeat?: ScheduleRepeat;
  hour?: number;
  minute?: number;
  dayOfWeek?: number;
  enabled?: boolean;
}): Promise<ScheduledRun> {
  await load();
  if (!input.name.trim()) throw new Error("Schedule name is required");
  if (input.storyNames.length === 0) throw new Error("Select at least one story");

  const repeat = input.repeat ?? "once";
  const d = new Date(input.scheduledAt);
  const hour = input.hour ?? d.getHours();
  const minute = input.minute ?? d.getMinutes();
  const dayOfWeek = input.dayOfWeek ?? d.getDay();
  const scheduledAt = computeNextRunAt(
    repeat,
    input.scheduledAt,
    hour,
    minute,
    dayOfWeek,
  );

  if (repeat === "once" && scheduledAt <= Date.now()) {
    throw new Error("Scheduled time must be in the future");
  }

  const schedule: ScheduledRun = {
    id: randomUUID(),
    name: input.name.trim(),
    storyNames: [...input.storyNames],
    scheduledAt,
    repeat,
    hour,
    minute,
    dayOfWeek: repeat === "weekly" ? dayOfWeek : undefined,
    enabled: input.enabled ?? true,
    createdAt: Date.now(),
    lastRunAt: null,
  };
  _schedules.push(schedule);
  await persist();
  await notifyChanged();
  return schedule;
}

export async function updateSchedule(
  id: string,
  patch: Partial<
    Pick<
      ScheduledRun,
      | "name"
      | "storyNames"
      | "scheduledAt"
      | "repeat"
      | "hour"
      | "minute"
      | "dayOfWeek"
      | "enabled"
      | "lastRunAt"
    >
  >,
): Promise<ScheduledRun> {
  await load();
  const idx = _schedules.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error(`Schedule not found: ${id}`);

  const current = normalizeSchedule(_schedules[idx]);
  const timingPatch =
    patch.scheduledAt !== undefined ||
    patch.repeat !== undefined ||
    patch.hour !== undefined ||
    patch.minute !== undefined ||
    patch.dayOfWeek !== undefined;

  let repeat: ScheduleRepeat;
  let hour: number;
  let minute: number;
  let dayOfWeek: number | undefined;
  let scheduledAt: number;

  if (timingPatch) {
    repeat = patch.repeat ?? current.repeat ?? "once";
    const d = new Date(patch.scheduledAt ?? current.scheduledAt);
    hour = patch.hour ?? current.hour ?? d.getHours();
    minute = patch.minute ?? current.minute ?? d.getMinutes();
    dayOfWeek = patch.dayOfWeek ?? current.dayOfWeek ?? d.getDay();
    scheduledAt = computeNextRunAt(
      repeat,
      patch.scheduledAt ?? current.scheduledAt,
      hour,
      minute,
      dayOfWeek,
    );
  } else {
    repeat = current.repeat ?? "once";
    const d = new Date(current.scheduledAt);
    hour = current.hour ?? d.getHours();
    minute = current.minute ?? d.getMinutes();
    dayOfWeek = current.dayOfWeek;
    scheduledAt = current.scheduledAt;
  }

  const next: ScheduledRun = {
    ...current,
    ...patch,
    name: patch.name !== undefined ? patch.name.trim() : current.name,
    storyNames: patch.storyNames !== undefined ? [...patch.storyNames] : current.storyNames,
    repeat,
    hour,
    minute,
    dayOfWeek: repeat === "weekly" ? dayOfWeek : undefined,
    scheduledAt,
  };

  if (!next.name) throw new Error("Schedule name is required");
  if (next.storyNames.length === 0) throw new Error("Select at least one story");
  if (timingPatch && repeat === "once" && scheduledAt <= Date.now()) {
    throw new Error("Scheduled time must be in the future");
  }

  _schedules[idx] = next;
  await persist();
  await notifyChanged();
  return next;
}

export async function deleteSchedule(id: string): Promise<void> {
  await load();
  _schedules = _schedules.filter((s) => s.id !== id);
  await persist();
  await notifyChanged();
}

async function fireSchedule(schedule: ScheduledRun): Promise<void> {
  const settings = getSettingsValue();
  const agentBinary = await resolveAgentBinary(
    settings.agentProvider,
    settings.codexBinaryPath,
    settings.claudeBinaryPath,
    {
      computerUse:
        settings.agentProvider === "codex" && settings.codexComputerUse,
    },
  );
  const agentConfig = getAgentRunConfig(settings.agentProvider, settings);
  const computerUse =
    settings.agentProvider === "codex" && settings.codexComputerUse;
  const runOptionsBase = {
    browserMcp: settings.browserMcp,
    computerUse,
  };
  const runs = await listRuns();
  const lastRunMap = buildLastRunMap(runs);

  const validStories: { storyName: string; storyTitle: string; storyContents: string }[] = [];
  for (const storyName of schedule.storyNames) {
    try {
      const story = await getStory(storyName, lastRunMap);
      validStories.push({
        storyName,
        storyTitle: story.title,
        storyContents: formatStoryForRun(story),
      });
    } catch {
      // Story may have been deleted — skip it.
    }
  }

  const repeat = schedule.repeat ?? "once";
  const now = Date.now();

  if (validStories.length === 0) {
    const idx = _schedules.findIndex((s) => s.id === schedule.id);
    if (idx >= 0) {
      _schedules[idx] = { ...schedule, enabled: false, lastRunAt: now };
      await persist();
      await notifyChanged();
    }
    return;
  }

  let runItems: { storyName: string; storyTitle: string; runId: string }[] = [];

  if (validStories.length === 1) {
    const story = validStories[0];
    const runId = randomUUID();
    runItems = [{ storyName: story.storyName, storyTitle: story.storyTitle, runId }];
    startAgentRun(
      settings.agentProvider,
      runId,
      story.storyName,
      story.storyTitle,
      story.storyContents,
      agentBinary,
      settings.runHook,
      agentConfig,
      runOptionsBase,
    ).catch((err) => {
      console.error("[schedule] unhandled run error", { scheduleId: schedule.id, err: String(err) });
    });
  } else {
    const bulkId = randomUUID();
    const bulkStories = validStories.map((s) => ({
      runId: randomUUID(),
      storyName: s.storyName,
      storyTitle: s.storyTitle,
      storyContents: s.storyContents,
    }));
    runItems = bulkStories.map((s) => ({
      storyName: s.storyName,
      storyTitle: s.storyTitle,
      runId: s.runId,
    }));
    startBulkRun(
      bulkId,
      bulkStories,
      settings.agentProvider,
      agentBinary,
      settings.runHook,
      undefined,
      agentConfig,
      { ...runOptionsBase, bulk: true },
    ).catch((err) => {
      console.error("[schedule] unhandled bulk run error", { scheduleId: schedule.id, err: String(err) });
    });
  }

  const idx = _schedules.findIndex((s) => s.id === schedule.id);
  if (idx >= 0) {
    const hour = schedule.hour ?? new Date(schedule.scheduledAt).getHours();
    const minute = schedule.minute ?? new Date(schedule.scheduledAt).getMinutes();
    const dayOfWeek = schedule.dayOfWeek ?? new Date(schedule.scheduledAt).getDay();

    if (repeat === "once") {
      _schedules[idx] = {
        ...schedule,
        enabled: false,
        lastRunAt: now,
      };
    } else {
      _schedules[idx] = {
        ...schedule,
        enabled: true,
        lastRunAt: now,
        scheduledAt: computeNextRunAt(repeat, schedule.scheduledAt, hour, minute, dayOfWeek, now + 1000),
      };
    }
    await persist();
    await notifyChanged();
  }

  broadcast("schedules:fired", {
    scheduleId: schedule.id,
    items: runItems,
    agentProvider: settings.agentProvider,
    agentModel: agentConfig.model,
  });
}

async function checkDueSchedules(): Promise<void> {
  if (_checking) return;
  _checking = true;
  try {
    await load();
    const now = Date.now();
    const due = _schedules
      .map(normalizeSchedule)
      .filter((s) => s.enabled && s.scheduledAt <= now);
    for (const schedule of due) {
      if (schedule.repeat === "once" && schedule.lastRunAt) continue;
      await fireSchedule(schedule);
    }
  } finally {
    _checking = false;
  }
}

export function startScheduleWatcher(intervalMs = 30_000): void {
  if (_timer) return;
  void checkDueSchedules();
  _timer = setInterval(() => {
    void checkDueSchedules();
  }, intervalMs);
}

export function stopScheduleWatcher(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
