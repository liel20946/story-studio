import type { BrowserWindowConstructorOptions } from "electron";

export const MAC_WINDOW_CHROME_QUERY = "macWindowChrome";

/** macOS-only: transparent shell so the OS clips content to native rounded corners. */
export function getMacWindowChromeOptions(): Partial<BrowserWindowConstructorOptions> {
  if (process.platform !== "darwin") return {};
  return {
    transparent: true,
    backgroundColor: "#00000000",
    roundedCorners: true,
  };
}

export function withMacWindowChromeQuery(
  query?: Record<string, string>,
): Record<string, string> | undefined {
  if (process.platform !== "darwin") return query;
  return { ...query, [MAC_WINDOW_CHROME_QUERY]: "1" };
}
