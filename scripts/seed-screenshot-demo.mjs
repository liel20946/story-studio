#!/usr/bin/env node
/**
 * Seeds a local demo run with missing screenshot files for UI preview.
 * Quit Story Studio before running, then reopen and open the Runs tab.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const base = path.join(os.homedir(), "Library/Application Support/Story Studio");
const storiesDir = path.join(base, "stories");
const runsDir = path.join(base, "runs");
const runsJson = path.join(runsDir, "runs.json");

const runId = "demo-screenshot-ui-001";
const now = Date.now();
const started = now - 383_000;

const runsBase = path.join(runsDir, runId);
const screenshotsDir = path.join(runsBase, "screenshots");
fs.mkdirSync(screenshotsDir, { recursive: true });

const missing = Array.from({ length: 7 }, (_, i) =>
  path.join(screenshotsDir, `step-${String(i + 1).padStart(2, "0")}-placeholder.png`),
);

const steps = [
  { index: 0, text: "Open the homepage", status: "passed", screenshot: missing[0], error: null },
  { index: 1, text: "Click 'Email' field", status: "passed", screenshot: missing[1], error: null },
  { index: 2, text: "Type test@example.com", status: "passed", screenshot: null, error: null },
  { index: 3, text: "Click 'Password' field", status: "passed", screenshot: missing[2], error: null },
  { index: 4, text: "Type password", status: "passed", screenshot: null, error: null },
  { index: 5, text: "Click 'Sign in' button", status: "passed", screenshot: missing[3], error: null },
  { index: 6, text: "Click 'Issue Gift Card' button", status: "passed", screenshot: missing[4], error: null },
  { index: 7, text: "Verify gift card dialog opened", status: "passed", screenshot: missing[5], error: null },
  { index: 8, text: "Fill gift card amount", status: "passed", screenshot: missing[6], error: null },
  { index: 9, text: "Click 'Confirm' button", status: "passed", screenshot: null, error: null },
];

const events = [
  ["navigate", "Navigate", "https://example.com/login"],
  ["click", "Click", "Email field"],
  ["type", "Type", "test@example.com"],
  ["click", "Click", "Password field"],
  ["type", "Type", "••••••••"],
  ["click", "Click", "Sign in"],
  ["click", "Click", "Issue Gift Card"],
  ["assert", "Verify", "Gift card dialog opened"],
].map(([kind, label, detail], seq) => ({
  runId,
  seq,
  ts: started + seq * 15_000,
  kind,
  label,
  detail,
  status: "ok",
}));

const record = {
  runId,
  storyName: "demo--screenshot-ui-demo",
  storyTitle: "Screenshot UI Demo",
  status: "passed",
  summary: "Local demo run with missing screenshot files for UI preview.",
  assertions: [
    { text: "Login succeeded and dashboard loaded", passed: true },
    { text: "Gift card issue dialog opened", passed: true },
    { text: "Gift card amount field is visible", passed: true },
    { text: "Confirmation step completed", passed: true },
  ],
  screenshotPath: missing[6],
  screenshotPaths: missing,
  steps,
  startedAt: started,
  finishedAt: now,
  events,
};

const storyYaml = `stories:
  - id: screenshot-ui-demo
    name: Screenshot UI Demo
    url: https://example.com/
    tags:
      - demo
    mode: recorded
    workflow: |-
      Open the homepage
      Click 'Email' field
      Type test@example.com
      Click 'Password' field
      Type password
      Click 'Sign in' button
      Click 'Issue Gift Card' button
      Fill gift card amount
      Click 'Confirm' button
    assertions: |-
      @1 Verify gift card dialog opened
      @10 Verify confirmation step completed
    created_at: ${now}
`;

fs.writeFileSync(path.join(storiesDir, "demo.yaml"), storyYaml);
fs.writeFileSync(path.join(runsBase, "steps.json"), JSON.stringify(steps, null, 2));

let runs = [];
try {
  runs = JSON.parse(fs.readFileSync(runsJson, "utf8"));
} catch {
  runs = [];
}

runs = runs.filter((r) => r.runId !== runId);
runs.unshift(record);
fs.writeFileSync(runsJson, JSON.stringify(runs, null, 2));

console.log("Seeded screenshot UI demo.");
console.log("Run id:", runId);
console.log("Quit Story Studio if open, then reopen → Runs tab → Screenshot UI Demo");
