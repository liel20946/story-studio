import { ipcInvoke } from "./ipc";

export const closeWindow = (): Promise<void> => ipcInvoke("window:close");

export const minimizeWindow = (): Promise<void> => ipcInvoke("window:minimize");

export const toggleMaximizeWindow = (): Promise<void> =>
  ipcInvoke("window:toggleMaximize");
