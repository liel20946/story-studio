import { ipcMain } from "../electron-api.js";
import {
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from "../services/schedule-service.js";

export function registerSchedulesHandlers(): void {
  ipcMain.handle("schedules:list", async () => listSchedules());

  ipcMain.handle("schedules:get", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["id"] !== "string"
    ) {
      throw new Error("schedules:get requires { id: string }");
    }
    const { id } = params as { id: string };
    return getSchedule(id);
  });

  ipcMain.handle("schedules:create", async (_event, params: unknown) => {
    if (typeof params !== "object" || params === null) {
      throw new Error("schedules:create requires schedule fields");
    }
    const { name, storyNames, scheduledAt, enabled, repeat, hour, minute, dayOfWeek } = params as {
      name: string;
      storyNames: string[];
      scheduledAt: number;
      enabled?: boolean;
      repeat?: import("../services/contract-types.js").ScheduleRepeat;
      hour?: number;
      minute?: number;
      dayOfWeek?: number;
    };
    return createSchedule({ name, storyNames, scheduledAt, enabled, repeat, hour, minute, dayOfWeek });
  });

  ipcMain.handle("schedules:update", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["id"] !== "string"
    ) {
      throw new Error("schedules:update requires { id: string, ...patch }");
    }
    const { id, ...patch } = params as {
      id: string;
      name?: string;
      storyNames?: string[];
      scheduledAt?: number;
      enabled?: boolean;
      repeat?: import("../services/contract-types.js").ScheduleRepeat;
      hour?: number;
      minute?: number;
      dayOfWeek?: number;
      lastRunAt?: number | null;
    };
    return updateSchedule(id, patch);
  });

  ipcMain.handle("schedules:delete", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["id"] !== "string"
    ) {
      throw new Error("schedules:delete requires { id: string }");
    }
    const { id } = params as { id: string };
    await deleteSchedule(id);
    return { ok: true as const };
  });
}
