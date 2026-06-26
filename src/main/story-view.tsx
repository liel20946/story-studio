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
  Text,
  EmptyState,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui";
import {
  storiesGet,
  storiesList,
  storiesOpenFile,
  clipboardWriteText,
  runStart,
} from "../lib/ipc";
import { cn } from "@/lib/utils";
import { reportAppErrorFromUnknown } from "@/lib/app-error";
import type { StoryDetail } from "../lib/contract-types";
import { InlineCode, stripCode } from "../components/inline-code";
import { RailAssertionLine } from "../components/rail-assertion-line";
import { useActiveRunForStory, useRegisterRun } from "../lib/run-store";
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

// ---------- section (Steps on the left; Variables / Assertions on the rail) ----------
function Section({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="codex-section">
      <span className="section-label">{title}</span>
      {children}
    </div>
  );
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
      reportAppErrorFromUnknown("Failed to copy variable", err);
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

// Variables are edited through the "Edit" toolbar action (site YAML), so they
// render read-only here: key on the left, value beside it, and a copy button
// that fades in on row hover. Secrets stay masked.
function ReadOnlyVariables({
  story,
  nameColors,
}: {
  story: StoryDetail;
  nameColors: Record<string, string>;
}) {
  return (
    <div className="flex flex-col">
      {story.variables.map((v) => {
        const key = stripCode(v.key);
        const value = stripCode(v.value);
        const show = !v.secret;
        return (
          <div
            key={v.key}
            className="group/var flex items-center gap-1.5 py-0.5 min-w-0 rounded-control transition-colors hover:bg-surface-hover"
          >
            <span
              className={cn(
                "w-[5.5rem] shrink-0 truncate font-mono text-[10px] leading-[13px]",
                nameColors[key] ?? "text-tertiary",
              )}
            >
              {key}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate font-mono text-[10px] leading-[13px]",
                value ? "text-secondary" : "text-quaternary",
              )}
            >
              {value ? (show ? value : "••••••") : "empty"}
            </span>
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
  const [isStarting, setIsStarting] = React.useState(false);

  const storyQuery = useQuery({
    queryKey: ["stories:get", name],
    queryFn: () => storiesGet(name),
    // Keep the previously-viewed story on screen while the next one loads so
    // switching items doesn't flash the loading skeleton.
    placeholderData: keepPreviousData,
  });

  const storiesListQuery = useQuery({
    queryKey: ["stories:list"],
    queryFn: storiesList,
  });

  // Deleted stories stay in the stories:get cache (staleTime + keepPreviousData).
  // Redirect home once the list no longer contains this story.
  React.useEffect(() => {
    const stories = storiesListQuery.data;
    if (!stories) return;
    if (!stories.some((s) => s.name === name)) {
      navigate({ to: "/" });
    }
  }, [storiesListQuery.data, name, navigate]);

  const story = storyQuery.isError ? undefined : storyQuery.data;
  const activeRun = useActiveRunForStory(name, story?.title);

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
      const { runId, agentProvider, agentModel } = await runStart(story.name);
      registerRun(runId, story.name, story.title, { agentProvider, agentModel });
      navigate({ to: "/run/$runId", params: { runId } });
    } catch (err) {
      reportAppErrorFromUnknown("Failed to start run", err);
    } finally {
      setIsStarting(false);
    }
  }

  async function handleEdit() {
    if (!story) return;
    try {
      await storiesOpenFile(story.name);
    } catch (err) {
      reportAppErrorFromUnknown("Failed to open story file", err);
    }
  }

  function handleRecordAgain() {
    // Use the route param for the story id — query data can lag behind
    // (keepPreviousData) when switching stories in the sidebar.
    const baseUrl =
      story?.name === name ? (story.baseUrl ?? "") : "";
    const title = story?.name === name ? story.title : undefined;
    navigate({
      to: "/record",
      search: { storyKey: name, title, url: baseUrl },
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
          <ToolbarRow inset="main" className="main-titlebar-row detail-view-toolbar">
            <ToolbarContent className="detail-view-toolbar-content">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <ToolbarTitle>{story.title}</ToolbarTitle>
              </div>
            </ToolbarContent>
            <ToolbarActions className="detail-view-toolbar-actions">
              {/* Primary action grouped with nearby context (Edit, Record
                  again) so the run button isn't visually isolated. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="transparent"
                    size="titlebar"
                    iconOnly
                    onClick={handleEdit}
                    aria-label="Edit YAML file"
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
                    size="titlebar"
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
                variant={activeRun ? "filled" : "accent"}
                size="titlebar"
                radius="full"
                onClick={handleRun}
                disabled={isStarting}
              >
                {activeRun || isStarting ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <PlayIcon className="size-4" />
                )}
                {activeRun ? "View run" : "Run"}
              </Button>
            </ToolbarActions>
          </ToolbarRow>
        </Toolbar>
      }
    >
      {/* Two-column detail: steps on the left; variables + assertions on the
          right rail card (matches run view layout and typography). */}
      <div className="detail-view">
        <div className="detail-view-main story-sections">
          {story.steps.length > 0 && (
            <Section title="Steps">
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

          {story.steps.length === 0 && (
            <EmptyState placement="inline" title="No steps yet." />
          )}
        </div>

        {(story.variables.length > 0 ||
          story.assertions.length > 0) && (
          <div className="detail-rail detail-rail--card">
            {story.variables.length > 0 && (
              <Section title="Variables">
                <ReadOnlyVariables story={story} nameColors={varColors.text} />
              </Section>
            )}

            {story.assertions.length > 0 && (
              <Section title="Assertions">
                <div className="flex flex-col">
                  {story.assertions.map((assertion, i) => (
                    <RailAssertionLine
                      key={i}
                      text={assertion}
                      colorMap={varColors.chip}
                    />
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
