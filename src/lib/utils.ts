import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initLogging(): void {
  // no-op in Electron build
}

export function isDevelopmentFlavor(): boolean {
  return import.meta.env.DEV;
}
