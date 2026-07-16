#!/usr/bin/env node
/**
 * Seeds Story Studio with demo stories, runs, and generate conversations
 * for local UI preview (typography, sidebar, detail views).
 *
 * Quit Story Studio before running, then reopen the app.
 *
 * Usage: npm run seed:demo
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

function getUserDataDir() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library/Application Support/Story Studio");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(home, "AppData", "Roaming"),
      "Story Studio",
    );
  }
  return path.join(home, ".config/Story Studio");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, "utf8");
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

const base = getUserDataDir();
const storiesDir = path.join(base, "stories");
const runsDir = path.join(base, "runs");
const runsJsonPath = path.join(runsDir, "runs.json");
const conversationsDir = path.join(base, "generate-conversations");
const draftsDir = path.join(base, "drafts");

const now = Date.now();

// ---------- Stories ----------
const exampleComYaml = `stories:
  - id: login-flow
    name: Login Flow
    url: https://example.com/login
    mode: recorded
    workflow: |-
      Open https://example.com/login
      Click the Email field
      Type test@example.com
      Click the Password field
      Type password123
      Click Sign in
    assertions: |-
      @5 Verify dashboard heading is visible
      @5 Verify user menu shows test@example.com
    variables:
      email: test@example.com
      password: password123
    created_at: ${now - 86400000 * 5}

  - id: checkout
    name: Checkout Flow
    url: https://shop.example.com
    mode: generated
    workflow: |-
      Open https://shop.example.com/products/widget
      Click Add to cart
      Click View cart
      Click Proceed to checkout
      Fill shipping address with "123 Main St"
      Click Place order
    assertions: |-
      @5 Verify order confirmation page loads
      @5 Verify order number is displayed
    created_at: ${now - 86400000 * 2}
`;

const acmeYaml = `stories:
  - id: onboarding
    name: User Onboarding
    url: https://acme.example.com
    mode: recorded
    workflow: |-
      Open https://acme.example.com/welcome
      Click Get started
      Fill Full name with "Jane Doe"
      Fill Work email with "jane@acme.com"
      Click Continue
      Select role "Engineer"
      Click Finish setup
    assertions: |-
      @6 Verify welcome dashboard is shown
      @6 Verify onboarding checklist is complete
    created_at: ${now - 86400000 * 8}

  - id: settings-update
    name: Update Notification Settings
    url: https://acme.example.com
    mode: recorded
    workflow: |-
      Open https://acme.example.com/settings
      Click Notifications tab
      Toggle Weekly digest off
      Toggle Product updates on
      Click Save changes
    assertions: |-
      @5 Verify settings saved toast appears
    created_at: ${now - 86400000}
`;

ensureDir(storiesDir);
writeText(path.join(storiesDir, "example-com.yaml"), exampleComYaml);
writeText(path.join(storiesDir, "acme.yaml"), acmeYaml);

// ---------- Runs ----------
function makeRun({
  runId,
  storyName,
  storyTitle,
  status,
  summary,
  assertions,
  startedAt,
  finishedAt,
  events,
  steps,
}) {
  const runBase = path.join(runsDir, runId);
  ensureDir(path.join(runBase, "screenshots"));
  if (steps?.length) {
    writeJson(path.join(runBase, "steps.json"), steps);
  }
  return {
    runId,
    storyName,
    storyTitle,
    status,
    summary,
    assertions,
    startedAt,
    finishedAt,
    events,
    steps,
    agentProvider: "codex",
    agentModel: "gpt-5.4",
  };
}

const runLoginPassed = makeRun({
  runId: "demo-run-login-passed",
  storyName: "example-com--login-flow",
  storyTitle: "Login Flow",
  status: "passed",
  summary: "All assertions passed. Dashboard loaded in 4.2s.",
  assertions: [
    { text: "Dashboard heading is visible", passed: true },
    { text: "User menu shows test@example.com", passed: true },
  ],
  startedAt: now - 420_000,
  finishedAt: now - 12_000,
  events: [
    ["navigate", "Navigate", "https://example.com/login"],
    ["click", "Click", "Email field"],
    ["type", "Type", "test@example.com"],
    ["click", "Click", "Password field"],
    ["type", "Type", "•••••••••••"],
    ["click", "Click", "Sign in"],
    ["assert", "Verify", "Dashboard heading is visible"],
  ].map(([kind, label, detail], seq) => ({
    runId: "demo-run-login-passed",
    seq,
    ts: now - 420_000 + seq * 18_000,
    kind,
    label,
    detail,
    status: "ok",
  })),
  steps: [
    { index: 0, text: "Open https://example.com/login", status: "passed", screenshot: null, error: null },
    { index: 1, text: "Click the Email field", status: "passed", screenshot: null, error: null },
    { index: 2, text: "Type test@example.com", status: "passed", screenshot: null, error: null },
    { index: 3, text: "Click Sign in", status: "passed", screenshot: null, error: null },
    { index: 4, text: "Verify dashboard heading is visible", status: "passed", screenshot: null, error: null },
  ],
});

const runCheckoutFailed = makeRun({
  runId: "demo-run-checkout-failed",
  storyName: "example-com--checkout",
  storyTitle: "Checkout Flow",
  status: "failed",
  summary: "Assertion failed: order confirmation page did not load.",
  assertions: [
    { text: "Order confirmation page loads", passed: false },
    { text: "Order number is displayed", passed: false },
  ],
  startedAt: now - 1_800_000,
  finishedAt: now - 1_620_000,
  events: [
    ["navigate", "Navigate", "https://shop.example.com/products/widget"],
    ["click", "Click", "Add to cart"],
    ["click", "Click", "Proceed to checkout"],
    ["assert", "Verify", "Order confirmation page loads"],
  ].map(([kind, label, detail], seq) => ({
    runId: "demo-run-checkout-failed",
    seq,
    ts: now - 1_800_000 + seq * 25_000,
    kind,
    label,
    detail,
    status: seq === 3 ? "error" : "ok",
  })),
  steps: [
    { index: 0, text: "Open product page", status: "passed", screenshot: null, error: null },
    { index: 1, text: "Click Add to cart", status: "passed", screenshot: null, error: null },
    { index: 2, text: "Click Place order", status: "passed", screenshot: null, error: null },
    { index: 3, text: "Verify order confirmation page loads", status: "failed", screenshot: null, error: "Timeout waiting for confirmation heading" },
  ],
});

const runOnboardingPassed = makeRun({
  runId: "demo-run-onboarding-passed",
  storyName: "acme--onboarding",
  storyTitle: "User Onboarding",
  status: "passed",
  summary: "Onboarding completed successfully.",
  assertions: [
    { text: "Welcome dashboard is shown", passed: true },
    { text: "Onboarding checklist is complete", passed: true },
  ],
  startedAt: now - 3_600_000,
  finishedAt: now - 3_300_000,
  events: [],
  steps: [
    { index: 0, text: "Open welcome page", status: "passed", screenshot: null, error: null },
    { index: 1, text: "Click Get started", status: "passed", screenshot: null, error: null },
    { index: 2, text: "Fill profile details", status: "passed", screenshot: null, error: null },
    { index: 3, text: "Click Finish setup", status: "passed", screenshot: null, error: null },
  ],
});

const runSettingsCancelled = makeRun({
  runId: "demo-run-settings-cancelled",
  storyName: "acme--settings-update",
  storyTitle: "Update Notification Settings",
  status: "cancelled",
  summary: "Run cancelled by user.",
  assertions: [],
  startedAt: now - 720_000,
  finishedAt: now - 680_000,
  events: [],
  steps: [
    { index: 0, text: "Open settings", status: "passed", screenshot: null, error: null },
    { index: 1, text: "Click Notifications tab", status: "passed", screenshot: null, error: null },
  ],
});

const demoRuns = [
  runLoginPassed,
  runCheckoutFailed,
  runOnboardingPassed,
  runSettingsCancelled,
];

let runs = readJson(runsJsonPath, []);
const demoRunIds = new Set(demoRuns.map((r) => r.runId));
runs = runs.filter((r) => !demoRunIds.has(r.runId));
runs.unshift(...demoRuns);
writeJson(runsJsonPath, runs);

// ---------- Generate conversations ----------
const convoActiveId = "demo-convo-gift-card";
const convoActiveDraftId = `example-com-${now - 120_000}`;

const convoCompleteId = "demo-convo-password-reset";
const convoCompleteDraftId = `example-com-${now - 900_000}`;

const convoReviewId = "demo-convo-api-health";
const convoReviewDraftId = `acme-${now - 45_000}`;

const activeDraftYaml = `stories:
  - id: gift-card-issue
    name: Issue Gift Card
    url: https://example.com/dashboard
    mode: generated
    workflow: |-
      Open https://example.com/dashboard
      Click Issue Gift Card
      Fill Amount with "50"
      Click Send gift card
    assertions: |-
      @4 Verify gift card confirmation dialog appears
`;

const activeDraftMd = `# Issue Gift Card

## Variables
- \`amount\`: 50
- \`recipient\`: dashboard-user

## Steps
1. Open dashboard
2. Click **Issue Gift Card**
3. Fill amount with \`50\`
4. Click **Send gift card**

## Assertions
- Gift card confirmation dialog appears
`;

ensureDir(path.join(draftsDir, convoActiveDraftId));
writeText(path.join(draftsDir, convoActiveDraftId, "draft.story.yaml"), activeDraftYaml);
writeText(path.join(draftsDir, convoActiveDraftId, "draft.story.md"), activeDraftMd);

const reviewDraftYaml = `stories:
  - id: api-health-check
    name: API Health Check
    url: https://acme.example.com/api
    mode: generated
    workflow: |-
      Open https://acme.example.com/status
      Verify status badge shows Healthy
    assertions: |-
      @2 Verify response time is under 500ms
`;

ensureDir(path.join(draftsDir, convoReviewDraftId));
writeText(path.join(draftsDir, convoReviewDraftId, "draft.story.yaml"), reviewDraftYaml);
writeText(
  path.join(draftsDir, convoReviewDraftId, "draft.story.md"),
  "# API Health Check\n\nMonitor the status page and assert healthy response.\n",
);

ensureDir(conversationsDir);

const conversations = [
  {
    id: convoActiveId,
    title: "Gift card purchase flow",
    status: "active",
    draftId: convoActiveDraftId,
    createdAt: now - 180_000,
    updatedAt: now - 30_000,
    generating: false,
    messages: [
      {
        kind: "user",
        text: "Create a story that issues a $50 gift card from the dashboard.",
        at: now - 180_000,
      },
      {
        kind: "assistant",
        text: "I'll draft a story that opens the dashboard, starts the gift card flow, and verifies the confirmation dialog.",
        at: now - 150_000,
      },
      {
        kind: "draft",
        at: now - 120_000,
        storyTitle: "Issue Gift Card",
        summary: "Dashboard → Issue Gift Card → fill $50 → send",
        draftMd: activeDraftMd,
      },
    ],
  },
  {
    id: convoCompleteId,
    title: "Password reset email",
    status: "complete",
    draftId: convoCompleteDraftId,
    storyName: "example-com--login-flow",
    createdAt: now - 86400000,
    updatedAt: now - 86000000,
    generating: false,
    messages: [
      {
        kind: "user",
        text: "Test the password reset flow on example.com",
        at: now - 86400000,
      },
      {
        kind: "draft",
        at: now - 86300000,
        storyTitle: "Password Reset",
        summary: "Forgot password → email link → set new password",
      },
      {
        kind: "assistant",
        text: "Story saved as Login Flow. You can run it from the Stories tab.",
        at: now - 86000000,
      },
    ],
  },
  {
    id: convoReviewId,
    title: "API health monitoring",
    status: "active",
    draftId: convoReviewDraftId,
    createdAt: now - 90_000,
    updatedAt: now - 15_000,
    generating: false,
    messages: [
      {
        kind: "user",
        text: "Build a quick health check for acme.example.com/status",
        at: now - 90_000,
      },
      {
        kind: "status",
        text: "Exploring the status page…",
        at: now - 60_000,
      },
      {
        kind: "draft",
        at: now - 45_000,
        storyTitle: "API Health Check",
        summary: "Open status page → verify Healthy badge → check response time",
      },
    ],
  },
];

for (const conversation of conversations) {
  writeJson(path.join(conversationsDir, `${conversation.id}.json`), conversation);
}

console.log("Seeded Story Studio demo data.");
console.log(`Data directory: ${base}`);
console.log("");
console.log("Stories (4):");
console.log("  • example-com--login-flow");
console.log("  • example-com--checkout");
console.log("  • acme--onboarding");
console.log("  • acme--settings-update");
console.log("");
console.log("Runs (4): passed, failed, passed, cancelled");
console.log("");
console.log("Generate conversations (3):");
console.log("  • Gift card purchase flow (active, draft)");
console.log("  • Password reset email (complete)");
console.log("  • API health monitoring (active, draft)");
console.log("");
console.log("Quit Story Studio if it is open, then reopen to load the demo data.");
