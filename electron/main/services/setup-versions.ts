/** Bundled Playwright CLI version (keep in sync with package.json optionalDependencies). */
export const PLAYWRIGHT_VERSION = "1.46.1";

/** Pinned @playwright/mcp version — do not use @latest (breaks reproducibility). */
export const PLAYWRIGHT_MCP_VERSION = "0.0.77";

export function playwrightMcpPackageSpec(): string {
  return `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`;
}
