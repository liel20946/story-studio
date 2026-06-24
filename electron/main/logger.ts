export const logger = {
  info: (scope: string, message: string, meta?: unknown) => {
    console.log(`[${scope}] ${message}`, meta ?? "");
  },
  debug: (scope: string, message: string, meta?: unknown) => {
    console.debug(`[${scope}] ${message}`, meta ?? "");
  },
  error: (scope: string, message: string, error?: unknown) => {
    console.error(`[${scope}] ${message}`, error ?? "");
  },
};
