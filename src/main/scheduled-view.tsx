import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClockIcon,
  Loader2Icon,
  ChevronRightIcon,
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
  Checkbox,
  EmptyState,
  Input,
} from "@/components/ui";
import { reportAppError, reportAppErrorFromUnknown } from "@/lib/app-error";
import { cn } from "@/lib/utils";
import {
  storiesList,
  schedulesList,
  schedulesGet,
  schedulesCreate,
  schedulesUpdate,
  onSchedulesChanged,
} from "../lib/ipc";
import type { StorySummary, ScheduledRun } from "../lib/contract-types";
import {
  useSections,
  DEFAULT_SECTION_ID,
  type StorySection,
} from "../lib/sections-store";

import { SchedulePicker } from "@/components/schedule-picker";
import {
  type ScheduleTiming,
  defaultScheduleTiming,
  scheduledRunToTiming,
  timingPayload,
  ensureFutureOnceTiming,
  formatUpcomingScheduleLabel,
} from "@/lib/schedule-timing";

interface Group {
  id: string;
  name: string;
  stories: StorySummary[];
}

function ScheduledToolbar({
  title,
  actions,
}: {
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <Toolbar titlebar surface="main" seamless>
      <ToolbarRow inset="main" className="main-titlebar-row detail-view-toolbar">
        <ToolbarContent className="detail-view-toolbar-content">
          <ToolbarTitle>{title}</ToolbarTitle>
        </ToolbarContent>
        {actions ? (
          <ToolbarActions className="detail-view-toolbar-actions">
            {actions}
          </ToolbarActions>
        ) : null}
      </ToolbarRow>
    </Toolbar>
  );
}

function StoryRow({
  story,
  checked,
  onToggle,
}: {
  story: StorySummary;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-control px-3 py-2",
        "hover:bg-surface-hover",
      )}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <Text variant="regular" className="truncate">
        {story.title}
      </Text>
    </label>
  );
}

function StorySelection({
  groups,
  total,
  selected,
  onToggleStory,
  onToggleGroup,
}: {
  groups: Group[];
  total: number;
  selected: Set<string>;
  onToggleStory: (name: string) => void;
  onToggleGroup: (group: Group, select: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => {
        const groupNames = group.stories.map((s) => s.name);
        const selectedInGroup = groupNames.filter((n) => selected.has(n)).length;
        const allSelected =
          group.stories.length > 0 && selectedInGroup === group.stories.length;
        return (
          <div key={group.id} className="flex flex-col">
            <label className="mb-1 flex cursor-pointer items-center gap-2 px-1 py-0.5">
              <Checkbox
                checked={
                  allSelected
                    ? true
                    : selectedInGroup > 0
                      ? "indeterminate"
                      : false
                }
                onCheckedChange={() => onToggleGroup(group, !allSelected)}
              />
              <Text variant="small-strong" color="secondary">
                {group.name}
              </Text>
              <Text variant="small" color="tertiary">
                {selectedInGroup}/{group.stories.length}
              </Text>
            </label>
            <div className="flex flex-col">
              {group.stories.map((story) => (
                <StoryRow
                  key={story.name}
                  story={story}
                  checked={selected.has(story.name)}
                  onToggle={() => onToggleStory(story.name)}
                />
              ))}
            </div>
          </div>
        );
      })}
      {total === 0 && (
        <EmptyState title="No stories yet." />
      )}
    </div>
  );
}

function ScheduleRail({
  name,
  onNameChange,
  timing,
  onTimingChange,
  isNew,
  lastRunAt,
  readOnly,
  pickerOpen,
  onPickerOpenChange,
}: {
  name: string;
  onNameChange: (v: string) => void;
  timing: ScheduleTiming;
  onTimingChange: (v: ScheduleTiming) => void;
  isNew?: boolean;
  lastRunAt?: number | null;
  readOnly?: boolean;
  pickerOpen?: boolean;
  onPickerOpenChange?: (open: boolean) => void;
}) {
  const pickerDisabled = readOnly || (!isNew && !!lastRunAt && timing.repeat === "once");

  return (
    <aside className="detail-rail detail-rail--card">
      <div className="codex-section">
        <span className="section-label">Schedule</span>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <Text variant="small" color="secondary">
              Name
            </Text>
            <Input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Morning smoke test"
              disabled={readOnly}
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <Text variant="small" color="secondary">
              Run at
            </Text>
            <SchedulePicker
              value={timing}
              onChange={onTimingChange}
              disabled={pickerDisabled}
              open={pickerOpen}
              onOpenChange={onPickerOpenChange}
            />
          </div>

        </div>
      </div>
    </aside>
  );
}

function useStoryGroups() {
  const { sections, assignments } = useSections();
  const storiesQuery = useQuery({
    queryKey: ["stories:list"],
    queryFn: storiesList,
  });
  const stories = React.useMemo(
    () => storiesQuery.data ?? [],
    [storiesQuery.data],
  );

  const groups: Group[] = React.useMemo(() => {
    const ids = new Set(sections.map((s) => s.id));
    const bySection = new Map<string, StorySummary[]>();
    const unassigned: StorySummary[] = [];
    for (const story of stories) {
      const sid = assignments[story.name];
      if (sid && ids.has(sid)) {
        const arr = bySection.get(sid);
        if (arr) arr.push(story);
        else bySection.set(sid, [story]);
      } else {
        unassigned.push(story);
      }
    }
    const result: Group[] = sections
      .map((s: StorySection) => ({
        id: s.id,
        name: s.name,
        stories: bySection.get(s.id) ?? [],
      }))
      .filter((g) => g.stories.length > 0);
    if (unassigned.length > 0) {
      result.push({
        id: DEFAULT_SECTION_ID,
        name: "Stories",
        stories: unassigned,
      });
    }
    return result;
  }, [stories, sections, assignments]);

  return { stories, groups, total: stories.length };
}

export function ScheduledOverviewView() {
  const navigate = useNavigate();
  const schedulesQuery = useQuery({
    queryKey: ["schedules:list"],
    queryFn: schedulesList,
  });
  const schedules = schedulesQuery.data ?? [];
  const ranCount = React.useMemo(
    () => schedules.filter((s) => s.lastRunAt !== null).length,
    [schedules],
  );
  const upcomingCount = React.useMemo(
    () =>
      schedules.filter(
        (s) =>
          s.enabled &&
          ((s.repeat ?? "once") !== "once" || !s.lastRunAt),
      ).length,
    [schedules],
  );
  const upcoming = React.useMemo(
    () =>
      schedules
        .filter((s) => s.enabled)
        .sort((a, b) => a.scheduledAt - b.scheduledAt),
    [schedules],
  );

  return (
    <div className="home-shell">
      <div className="home-view">
        <div className="home-content">
          <div className="home-prompt">
            <h1 className="home-prompt-title">What stories should we schedule ?</h1>
            <p className="home-prompt-sub">
              {ranCount} ran · {upcomingCount} upcoming
            </p>
            <div className="home-actions">
              <Button
                variant="accent"
                size="medium"
                radius="full"
                onClick={() =>
                  navigate({ to: "/scheduled/$id", params: { id: "new" } })
                }
              >
                <ClockIcon className="size-4" />
                New schedule
              </Button>
            </div>
          </div>

          {upcoming.length > 0 && (
            <div className="home-recent-section">
              <p className="section-label mb-2">Upcoming</p>
              <div className="home-recent-list">
                {upcoming.map((schedule) => (
                  <button
                    key={schedule.id}
                    type="button"
                    className="home-link-row home-link-row--schedule w-full"
                    onClick={() =>
                      navigate({
                        to: "/scheduled/$id",
                        params: { id: schedule.id },
                      })
                    }
                  >
                    <span className="home-link-row-title">{schedule.name}</span>
                    <span className="home-link-row-meta">
                      {formatUpcomingScheduleLabel(schedule)}
                    </span>
                    <ChevronRightIcon className="size-3 shrink-0 text-quaternary" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ScheduledEditorView({ scheduleId }: { scheduleId?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = !scheduleId;
  const { stories, groups, total } = useStoryGroups();

  const scheduleQuery = useQuery({
    queryKey: ["schedules:get", scheduleId],
    queryFn: () => schedulesGet(scheduleId!),
    enabled: !!scheduleId,
  });

  const [name, setName] = React.useState("");
  const [timing, setTiming] = React.useState<ScheduleTiming>(defaultScheduleTiming);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [initialized, setInitialized] = React.useState(isNew);
  const [pickerOpen, setPickerOpen] = React.useState(isNew);
  const [rescheduling, setRescheduling] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const savingRef = React.useRef(false);
  const creatingRef = React.useRef(false);
  const skipAutoSaveRef = React.useRef(false);

  // Re-initialize when switching between schedules or entering create mode.
  React.useEffect(() => {
    skipAutoSaveRef.current = true;
    setRescheduling(false);
    setCreating(false);
    creatingRef.current = false;

    if (!scheduleId) {
      setName("");
      setTiming(defaultScheduleTiming());
      setSelected(new Set());
      setInitialized(true);
      setPickerOpen(true);
      return;
    }

    setInitialized(false);
    setPickerOpen(false);
    setName("");
    setTiming(defaultScheduleTiming());
    setSelected(new Set());
  }, [scheduleId]);

  React.useEffect(() => {
    if (isNew || !scheduleId || !scheduleQuery.data || initialized) return;
    if (scheduleQuery.data.id !== scheduleId) return;
    const schedule = scheduleQuery.data;
    skipAutoSaveRef.current = true;
    setName(schedule.name);
    setTiming(scheduledRunToTiming(schedule));
    setSelected(new Set(schedule.storyNames));
    setInitialized(true);
  }, [isNew, scheduleId, scheduleQuery.data, initialized]);

  React.useEffect(() => {
    const unsub = onSchedulesChanged((updated) => {
      queryClient.setQueryData(["schedules:list"], updated);
      if (scheduleId) {
        const match = updated.find((s) => s.id === scheduleId);
        if (match) queryClient.setQueryData(["schedules:get", scheduleId], match);
      }
    });
    return unsub;
  }, [queryClient, scheduleId]);

  const allSelected = total > 0 && selected.size === total;
  const hasRunOnce =
    !isNew &&
    !!scheduleQuery.data?.lastRunAt &&
    (scheduleQuery.data.repeat ?? "once") === "once";
  const readOnly = hasRunOnce && !rescheduling;

  function toggleStory(storyName: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(storyName)) next.delete(storyName);
      else next.add(storyName);
      return next;
    });
  }

  function toggleGroup(group: Group, select: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of group.stories) {
        if (select) next.add(s.name);
        else next.delete(s.name);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(stories.map((s) => s.name)));
  }

  function handleReschedule() {
    setRescheduling(true);
    setPickerOpen(true);
    setTiming((current) => ensureFutureOnceTiming(current));
  }

  const selectedStoryNames = React.useMemo(
    () => stories.filter((s) => selected.has(s.name)).map((s) => s.name),
    [stories, selected],
  );
  const timingKey = React.useMemo(() => JSON.stringify(timingPayload(timing)), [timing]);

  async function handleCreate() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      reportAppError("Schedule name is required");
      return;
    }
    if (selectedStoryNames.length === 0) {
      reportAppError("Select at least one story");
      return;
    }
    if (creating || creatingRef.current) return;

    const payload = timingPayload(timing);
    if (timing.repeat === "once" && payload.scheduledAt <= Date.now()) {
      reportAppError("Scheduled time must be in the future");
      return;
    }

    creatingRef.current = true;
    setCreating(true);
    try {
      const created = await schedulesCreate({
        name: trimmedName,
        storyNames: selectedStoryNames,
        ...payload,
        enabled: true,
      });
      queryClient.setQueryData(["schedules:get", created.id], created);
      queryClient.invalidateQueries({ queryKey: ["schedules:list"] });
      setPickerOpen(false);
      navigate({
        to: "/scheduled/$id",
        params: { id: created.id },
        replace: true,
      });
    } catch (err) {
      reportAppErrorFromUnknown("Failed to create schedule", err);
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  React.useEffect(() => {
    if (isNew || !initialized || readOnly || !scheduleId) return;
    const trimmedName = name.trim();
    if (!trimmedName || selectedStoryNames.length === 0) return;

    const payload = timingPayload(timing);
    if (timing.repeat === "once" && payload.scheduledAt <= Date.now()) return;

    if (skipAutoSaveRef.current) {
      skipAutoSaveRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        if (savingRef.current) return;
        savingRef.current = true;
        try {
          const wasRescheduling = rescheduling;
          const updated = await schedulesUpdate(scheduleId, {
            name: trimmedName,
            storyNames: selectedStoryNames,
            ...payload,
            enabled: true,
            ...(wasRescheduling ? { lastRunAt: null } : {}),
          });
          skipAutoSaveRef.current = true;
          setName(updated.name);
          setTiming(scheduledRunToTiming(updated));
          setSelected(new Set(updated.storyNames));
          setRescheduling(false);
          queryClient.setQueryData(["schedules:get", scheduleId], updated);
          queryClient.invalidateQueries({ queryKey: ["schedules:list"] });
        } catch (err) {
          reportAppErrorFromUnknown("Failed to save schedule", err);
        } finally {
          savingRef.current = false;
        }
      })();
    }, 500);

    return () => window.clearTimeout(timer);
  }, [
    isNew,
    initialized,
    readOnly,
    name,
    timingKey,
    selectedStoryNames,
    scheduleId,
    rescheduling,
    queryClient,
  ]);

  if (!isNew && (scheduleQuery.isLoading || !initialized)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2Icon className="size-5 animate-spin text-tertiary" />
      </div>
    );
  }

  if (!isNew && scheduleQuery.isError) {
    return (
      <EmptyState
        title="Schedule not found"
        description="It may have been deleted."
        actions={
          <Button variant="accent" onClick={() => navigate({ to: "/scheduled" })}>
            Back to scheduled
          </Button>
        }
      />
    );
  }

  const title = isNew ? "New schedule" : name || "Schedule";

  const toolbarActions = (
    <>
      {hasRunOnce && readOnly && (
        <Button
          variant="accent"
          size="titlebar"
          radius="full"
          onClick={handleReschedule}
        >
          <ClockIcon className="size-4" />
          Reschedule
        </Button>
      )}
      {total > 0 && !readOnly && (
        <Button variant="glass" size="titlebar" radius="full" onClick={toggleAll}>
          {allSelected ? "Deselect all" : "Select all"}
        </Button>
      )}
      {isNew && (
        <Button
          variant="accent"
          size="titlebar"
          radius="full"
          onClick={() => void handleCreate()}
          disabled={creating || !name.trim() || selectedStoryNames.length === 0}
        >
          {creating ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <ClockIcon className="size-4" />
          )}
          Create schedule
        </Button>
      )}
    </>
  );

  return (
    <ScrollArea toolbar={<ScheduledToolbar title={title} actions={toolbarActions} />}>
      <div className="detail-view main-panel-in px-8 py-4 pb-8">
        <div className="detail-view-main min-w-0 flex-1">
          <div className="codex-section">
            <span className="section-label">Stories</span>
            <StorySelection
              groups={groups}
              total={total}
              selected={selected}
              onToggleStory={toggleStory}
              onToggleGroup={toggleGroup}
            />
          </div>
        </div>
        <ScheduleRail
          name={name}
          onNameChange={setName}
          timing={timing}
          onTimingChange={setTiming}
          isNew={isNew}
          lastRunAt={rescheduling ? null : scheduleQuery.data?.lastRunAt}
          readOnly={readOnly}
          pickerOpen={pickerOpen}
          onPickerOpenChange={setPickerOpen}
        />
      </div>
    </ScrollArea>
  );
}
