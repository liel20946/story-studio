import * as React from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  PlayIcon,
  Loader2Icon,
  PencilIcon,
  CircleDotIcon,
  CopyIcon,
  CheckIcon,
} from "lucide-react";
import {
  ScrollArea,
  Toolbar,
  ToolbarRow,
  ToolbarContent,
  ToolbarTitle,
  ToolbarActions,
  Button,
  Badge,
  Text,
  EmptyState,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui";
import {
  storiesGet,
  storiesOpenFile,
  clipboardWriteText,
  runStart,
} from "../lib/ipc";
import { cn } from "@/lib/utils";
import type { StoryDetail } from "../lib/contract-types";
import { InlineCode, stripCode } from "../components/inline-code";
import { useActiveRunForStory, useRegisterRun } from "../lib/run-store";
import { ContentCard } from "../components/content-card";

// ---------- per-variable colors ----------
// Each variable name gets a stable color from the design-system support palette
// (cycled by definition order) so it reads the same in the Variables list and
// wherever it's referenced in Steps/Assertions. `text` tints the name in the
// Variables list; `chip` tints the inline-code chip in steps/assertions.
const VAR_PALETTE: { text: string; chip: string }[] = [
  { text: "text-support-blue", chip: "bg-support-blue-10 text-support-blue" },
  { text: "text-support-purple", chip: "bg-support-purple-10 text-support-purple" },
  { text: "text-support-green", chip: "bg-support-green-10 text-support-green" },
  { text: "text-support-orange", chip: "bg-support-orange-10 text-support-orange" },
  { text: "text-support-red", chip: "bg-support-red-10 text-support-red" },
  { text: "text-support-yellow", chip: "bg-support-yellow-10 text-support-yellow" },
];

function buildVarColors(story: StoryDetail) {
  const text: Record<string, string> = {};
  const chip: Record<string, string> = {};
  story.variables.forEach((v, i) => {
    const key = stripCode(v.key);
    const c = VAR_PALETTE[i % VAR_PALETTE.length];
    text[key] = c.text;
    chip[key] = c.chip;
  });
  return { text, chip };
}

// ---------- section (Variables / Steps / Assertions) ----------
function Section({
  title,
  children,
  variant = "card",
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  variant?: "card" | "plain";
}) {
  if (variant === "plain") {
    return (
      <div className="codex-section">
        <span className="section-label">{title}</span>
        {children}
      </div>
    );
  }
  return <ContentCard title={title}>{children}</ContentCard>;
}

// ---------- copy-to-clipboard button (with transient "copied" check) ----------
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function handleCopy() {
    try {
      await clipboardWriteText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      console.error("[StoryView] clipboard:writeText failed", err);
    }
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={handleCopy}
      className="flex items-center text-tertiary transition-colors hover:text-secondary"
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-support-green" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </button>
  );
}

// ---------- read-only variables ----------
// ---------- read-only variables ----------
// Variables are edited through the "Edit" toolbar action (site YAML), so they
// render read-only here: key on the LEFT, value beside it, and a copy button
// that fades in on row hover. Secrets stay masked.
// that fades in on row hover. Secrets stay masked.
function ReadOnlyVariables({
  story,
  nameColors,
}: {
  story: StoryDetail;
  nameColors: Record<string, string>;
}) {
  return (
    <div className="flex flex-col px-1 py-1">
      {story.variables.map((v) => {
        const key = stripCode(v.key);
        const value = stripCode(v.value);
        const show = !v.secret;
        return (
          <div
            key={v.key}
            className="group/var flex items-center gap-1.5 rounded-control px-0.5 py-0.5 transition-colors hover:bg-surface-hover"
          >
            <Text
              variant="micro-mono"
              className={cn(
                "w-[4rem] shrink-0 truncate",
                nameColors[key] ?? "text-tertiary",
              )}
            >
              {key}
            </Text>
            <Text
              variant="micro-mono"
              color={value ? "secondary" : "quaternary"}
              className="min-w-0 flex-1 truncate"
            >
              {value ? (show ? value : "••••••") : "empty"}
            </Text>
            {/* Copy reveals on row hover to keep the table clean at rest. */}
            <span className="shrink-0 opacity-0 transition-opacity group-hover/var:opacity-100">
              <CopyButton value={value} label={`Copy ${key}`} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function StoryView() {
  const { name } = useParams({ from: "/story/$name" });
  const navigate = useNavigate();
  const registerRun = useRegisterRun();
  const activeRun = useActiveRunForStory(name);
  const [isStarting, setIsStarting] = React.useState(false);

  const storyQuery = useQuery({
    queryKey: ["stories:get", name],
    queryFn: () => storiesGet(name),
    // Keep the previously-viewed story on screen while the next one loads so
    // switching items doesn't flash the loading skeleton.
    placeholderData: keepPreviousData,
  });

  const story = storyQuery.data;

  // Stable color per variable name, reused across the Variables list and the
  // inline chips in Steps/Assertions.
  const varColors = React.useMemo(
    () => (story ? buildVarColors(story) : { text: {}, chip: {} }),
    [story],
  );

  async function handleRun() {
    if (!story || isStarting) return;
    // Already running in the background → jump to its live timeline.
    if (activeRun) {
      navigate({ to: "/run/$runId", params: { runId: activeRun.runId } });
      return;
    }
    setIsStarting(true);
    try {
      const { runId } = await runStart(story.name);
      registerRun(runId, story.name, story.title);
      navigate({ to: "/run/$runId", params: { runId } });
    } catch (err) {
      console.error("[StoryView] run:start failed", err);
    } finally {
      setIsStarting(false);
    }
  }

  async function handleEdit() {
    if (!story) return;
    try {
      await storiesOpenFile(story.name);
    } catch (err) {
      console.error("[StoryView] stories:openFile failed", err);
    }
  }

  function handleRecordAgain() {
    if (!story) return;
    // Prefill the recorder with this story's id + start URL so re-recording
    // overwrites the same .story.md.
    navigate({
      to: "/record",
      search: { name: story.name, url: story.baseUrl ?? "" },
    });
  }

  if (storyQuery.isLoading) {
    return (
      <ScrollArea title="Story">
        <div className="flex flex-col gap-4 detail-view">
          {/* Skeleton */}
          <div className="h-6 w-48 rounded-md bg-control animate-pulse" />
          <div className="h-4 w-32 rounded-md bg-control animate-pulse" />
          <div className="h-px bg-separator" />
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-4 w-full rounded-md bg-control animate-pulse" />
            ))}
          </div>
        </div>
      </ScrollArea>
    );
  }

  if (storyQuery.isError || !story) {
    return (
      <ScrollArea title="Story">
        <EmptyState
          title="Story not found"
          description="This story may have been deleted."
          actions={
            <Button variant="filled" onClick={() => navigate({ to: "/" })}>
              Go back
            </Button>
          }
        />
      </ScrollArea>
    );
  }

  return (
    <ScrollArea
      toolbar={
        <Toolbar titlebar surface="main" seamless>
          <ToolbarRow inset="main" className="detail-view-toolbar">
            <ToolbarContent className="detail-view-toolbar-content">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <ToolbarTitle className="shrink-0">{story.title}</ToolbarTitle>
                {(story.tags ?? []).map((tag) => (
                  <Badge key={tag} color="secondary" size="xs">
                    {tag}
                  </Badge>
                ))}
                {story.mode && (
                  <Badge color="secondary" size="xs">
                    {story.mode}
                  </Badge>
                )}
              </div>
            </ToolbarContent>
            <ToolbarActions className="detail-view-toolbar-actions">
              {/* Primary action grouped with nearby context (Edit, Record
                  again) so the run button isn't visually isolated. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="transparent"
                    size="small"
                    iconOnly
                    onClick={handleEdit}
                    aria-label="Edit story file"
                  >
                    <PencilIcon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit site YAML</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="transparent"
                    size="small"
                    iconOnly
                    onClick={handleRecordAgain}
                    aria-label="Record again"
                  >
                    <CircleDotIcon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Record again</TooltipContent>
              </Tooltip>
              <Button
                variant="accent"
                size="small"
                radius="full"
                onClick={handleRun}
                disabled={isStarting}
              >
                {activeRun || isStarting ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <PlayIcon className="size-4" />
                )}
                Run
              </Button>
            </ToolbarActions>
          </ToolbarRow>
        </Toolbar>
      }
    >
      {/* Two-column detail: the main flow (Steps + Assertions) on the left,
          status + Variables on the right so wide pages don't read sparse. */}
      <div className="detail-view">
        <div className="detail-view-main story-sections">
          {story.steps.length > 0 && (
            <Section title="Steps" variant="plain">
              <ol className="flex flex-col">
                {story.steps.map((step, i) => (
                  <li key={i} className="story-step-row">
                    <span className="story-step-num">{i + 1}</span>
                    <Text variant="small" color="secondary">
                      <InlineCode text={step} colorMap={varColors.chip} />
                    </Text>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {story.assertions.length > 0 && (
            <Section title="Assertions" variant="plain">
              <ul className="flex flex-col">
                {story.assertions.map((assertion, i) => (
                  <li key={i} className="story-step-row">
                    <span
                      aria-hidden
                      className="story-step-num !rounded-full !text-[8px]"
                    >
                      •
                    </span>
                    <Text variant="small" color="secondary">
                      <InlineCode text={assertion} colorMap={varColors.chip} />
                    </Text>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {story.steps.length === 0 && story.assertions.length === 0 && (
            <EmptyState
              placement="inline"
              title="No steps yet"
              description="This story has no steps or assertions. Record again or edit the file to add them."
            />
          )}
        </div>

        {/* Right: variables in a floating card (matches run view rail). */}
        {(activeRun || story.variables.length > 0) && (
          <div className="detail-rail detail-rail--card">
            {activeRun && (
              <button
                type="button"
                onClick={() =>
                  navigate({
                    to: "/run/$runId",
                    params: { runId: activeRun.runId },
                  })
                }
                className="flex items-center gap-2 self-start rounded-control px-2 py-1.5 hover:bg-control transition-colors"
              >
                <Loader2Icon className="size-3 text-support-blue shrink-0 animate-spin" />
                <Badge color="blue" size="xs">
                  Running
                </Badge>
                <Text variant="mini" color="tertiary">
                  View live timeline
                </Text>
              </button>
            )}

            {story.variables.length > 0 && (
              <Section title="Variables" variant="plain">
                <ReadOnlyVariables story={story} nameColors={varColors.text} />
              </Section>
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
