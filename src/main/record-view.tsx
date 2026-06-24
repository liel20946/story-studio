import * as React from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  DownloadIcon,
  CircleDotIcon,
  Loader2Icon,
  CheckCircle2Icon,
  TriangleAlertIcon,
  SquareIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
  Button,
  Field,
  Input,
  Text,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  recordingCheck,
  recordingInstallBrowser,
  settingsGet,
} from "../lib/ipc";
import type { RecordingAvailability } from "../lib/contract-types";
import { useRecording, type RecordingPhase } from "../lib/recording-store";

// Prep (availability/install) phases live locally; recording phases come from
// the recording store so they survive a RecordView remount mid-recording.
type PrepPhase =
  | "idle"
  | "checking"
  | "install-browser"
  | "installing"
  | "ready"
  | "error";

type Phase = PrepPhase | RecordingPhase;

function PhaseIcon({ phase }: { phase: Phase }) {
  switch (phase) {
    case "checking":
    case "installing":
    case "starting":
    case "recording":
    case "converting":
      return <Loader2Icon className="size-4 animate-spin text-tertiary" />;
    case "done":
      return <CheckCircle2Icon className="size-4 text-support-green" />;
    case "error":
      return <TriangleAlertIcon className="size-4 text-support-red" />;
    case "install-browser":
      return <DownloadIcon className="size-4 text-support-blue" />;
    case "ready":
      return <CircleDotIcon className="size-4 text-support-green" />;
    default:
      return null;
  }
}

export function RecordView() {
  const navigate = useNavigate();
  const rec = useRecording();
  // "Record again" prefills these from the originating story so re-recording
  // overwrites the same .story.md with the same start URL.
  const search = useSearch({ from: "/record" });
  const [open, setOpen] = React.useState(true);
  const [storyName, setStoryName] = React.useState(search.name ?? "");
  const [url, setUrl] = React.useState(search.url ?? "");
  // Seed the Start URL from the configured Starting URL setting on mount, unless
  // the user has already typed into the field OR a URL was prefilled.
  const urlEditedRef = React.useRef(Boolean(search.url));

  // Availability / install state (pre-recording).
  const [prepPhase, setPrepPhase] = React.useState<PrepPhase>("idle");
  const [prepMessage, setPrepMessage] = React.useState("");
  const [_availability, setAvailability] =
    React.useState<RecordingAvailability | null>(null);
  const [installError, setInstallError] = React.useState<string | null>(null);

  // While a recording session is active the visible phase/message come from the
  // store; otherwise from the local prep state.
  const phase: Phase = rec.active ? rec.phase : prepPhase;
  const phaseMessage = rec.active ? rec.message : prepMessage;

  // Load the configured Starting URL once on mount.
  React.useEffect(() => {
    let cancelled = false;
    settingsGet()
      .then((s) => {
        if (!cancelled && !urlEditedRef.current && s.startingUrl) {
          setUrl(s.startingUrl);
        }
      })
      .catch(() => {
        // Settings may not be ready; leave the field empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Check availability on mount (only when no recording is in flight — a
  // remount during recording must not clobber the live session).
  React.useEffect(() => {
    if (!open) return;
    if (rec.active) return;
    // Clear any leftover finished session from a previous recording.
    if (rec.phase !== "idle") rec.reset();
    setPrepPhase("checking");
    setPrepMessage("Checking prerequisites…");
    recordingCheck()
      .then((avail) => {
        setAvailability(avail);
        // Branch on the actual missing prerequisite. Only a genuinely missing
        // Chromium gets the install button — a missing Codex CLI or Playwright
        // is a different problem (installing Chromium won't fix it).
        if (!avail.codexAvailable) {
          setPrepPhase("error");
          setPrepMessage(
            "Codex CLI not found. Install Codex CLI (or set its path in Settings) to record stories.",
          );
        } else if (!avail.playwrightAvailable) {
          setPrepPhase("error");
          setPrepMessage(
            "Playwright is not available, so recording can't start. Reinstall the app or check your setup.",
          );
        } else if (!avail.browserInstalled) {
          setPrepPhase("install-browser");
          setPrepMessage(
            "Chromium browser not installed. Install it to enable recording.",
          );
        } else {
          setPrepPhase("ready");
          setPrepMessage("Ready to record.");
        }
      })
      .catch(() => {
        setPrepPhase("error");
        setPrepMessage("Failed to check prerequisites.");
      });
  }, [open]);

  // Navigate to the new story once the recording is saved.
  React.useEffect(() => {
    if (rec.active && rec.phase === "review" && rec.draftId) {
      rec.reset();
      navigate({ to: "/draft/$draftId", params: { draftId: rec.draftId } });
      return;
    }
    if (rec.active && rec.phase === "done" && rec.storyName) {
      const name = rec.storyName;
      const t = setTimeout(() => {
        setOpen(false);
        rec.reset();
        navigate({ to: "/story/$name", params: { name } });
      }, 800);
      return () => clearTimeout(t);
    }
  }, [rec, navigate]);

  async function handleInstallBrowser() {
    setPrepPhase("installing");
    setPrepMessage("Installing Chromium… this may take a minute.");
    setInstallError(null);
    try {
      const res = await recordingInstallBrowser();
      if (res.ok) {
        setPrepPhase("ready");
        setPrepMessage("Chromium installed. Ready to record.");
        setAvailability((prev) =>
          prev ? { ...prev, browserInstalled: true } : prev,
        );
      } else {
        setPrepPhase("error");
        setPrepMessage(res.error ?? "Installation failed.");
        setInstallError(res.error ?? "Unknown error");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPrepPhase("error");
      setPrepMessage(`Installation failed: ${msg}`);
      setInstallError(msg);
    }
  }

  function handleStart() {
    if (!storyName.trim() || !url.trim()) return;
    void rec.start(storyName.trim(), url.trim());
  }

  function handleStopRecording() {
    void rec.stop();
  }

  // "Active" = a recording session that can't be dismissed by closing.
  const isActive =
    rec.active && ["starting", "recording", "converting"].includes(rec.phase);
  const isReady = prepPhase === "ready" && !rec.active;
  const isDone = phase === "done";
  const isError = phase === "error";
  const needsInstall = prepPhase === "install-browser" && !rec.active;
  const isInstalling = prepPhase === "installing";
  const isChecking = prepPhase === "checking";

  const canStart =
    isReady && storyName.trim().length > 0 && url.trim().length > 0;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !isActive) {
      setOpen(false);
      rec.reset();
      navigate({ to: "/" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
    <DialogContent
      size="medium"
      onEscapeKeyDown={() => !isActive && handleOpenChange(false)}
    >
      <DialogHeader>
        <DialogTitle>Record Story</DialogTitle>
        <DialogDescription>
          Open a browser, perform your actions, then close the Playwright
          Inspector window to save a story.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="flex flex-col gap-3">
          {/* Tight, cohesive field stack (FieldSet's auto FieldGroup spread the
              two fields too far apart). */}
          <div className="flex flex-col gap-2">
            <Field label="Story name" orientation="vertical">
              <Input
                placeholder="e.g. login-smoke-test"
                value={storyName}
                onChange={(e) => setStoryName(e.target.value)}
                disabled={isActive || isDone}
              />
            </Field>
            <Field label="Start URL" orientation="vertical">
              <Input
                placeholder="https://…"
                value={url}
                onChange={(e) => {
                  urlEditedRef.current = true;
                  setUrl(e.target.value);
                }}
                disabled={isActive || isDone}
              />
            </Field>
          </div>

          {/* Status area */}
          {phase !== "idle" && (
            <div
              className={cn(
                "flex items-start gap-2.5 rounded-card p-3 bg-well",
                isError && "bg-well",
              )}
            >
              <PhaseIcon phase={phase} />
              <Text
                variant="small"
                color={
                  isError ? "primary" : isDone ? "primary" : "secondary"
                }
                className={cn(isError && "text-support-red", isDone && "text-support-green")}
              >
                {phaseMessage}
              </Text>
            </div>
          )}

          {/* Install browser step */}
          {needsInstall && (
            <Button
              variant="accent"
              onClick={handleInstallBrowser}
              disabled={isInstalling}
            >
              <DownloadIcon className="size-4.5" />
              Install Chromium
            </Button>
          )}

          {installError && (
            <Text variant="small" color="tertiary">
              Error: {installError}
            </Text>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button
            variant="filled"
            onClick={() => handleOpenChange(false)}
            disabled={isActive}
          >
            Cancel
          </Button>
        </DialogClose>
        {phase === "recording" ? (
          <Button variant="accent" onClick={handleStopRecording}>
            <SquareIcon className="size-4.5" />
            Stop &amp; Save Recording
          </Button>
        ) : (
          <Button
            variant="accent"
            onClick={handleStart}
            disabled={!canStart || isActive || isDone || isChecking}
          >
            {phase === "converting" ? (
              // Single spinner only — the status panel above already shows one.
              "Converting…"
            ) : phase === "starting" ? (
              "Starting…"
            ) : isDone ? (
              <>
                <CheckCircle2Icon className="size-4.5" />
                Done
              </>
            ) : (
              "Start recording"
            )}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
    </Dialog>
  );
}
