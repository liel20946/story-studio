import * as React from "react";
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LabeledSegment } from "./labeled-segment";
import { Text } from "@/components/ui";
import { CollapseSection } from "@/components/collapse-section";
import {
  type ScheduleTiming,
  REPEAT_OPTIONS,
  calendarDays,
  monthLabel,
  isSameDay,
  isToday,
  formatScheduleSummary,
  weekdayLabel,
} from "@/lib/schedule-timing";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

function TimeSelects({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
  disabled,
}: {
  hour: number;
  minute: number;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="schedule-picker-time-row">
      <label className="schedule-picker-time-field">
        <span className="schedule-picker-time-label">Hour</span>
        <select
          className="schedule-picker-select"
          value={hour}
          disabled={disabled}
          onChange={(e) => onHourChange(Number(e.target.value))}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, "0")}
            </option>
          ))}
        </select>
      </label>
      <label className="schedule-picker-time-field">
        <span className="schedule-picker-time-label">Min</span>
        <select
          className="schedule-picker-select"
          value={minute}
          disabled={disabled}
          onChange={(e) => onMinuteChange(Number(e.target.value))}
        >
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, "0")}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function SchedulePickerPanel({
  value,
  onChange,
  disabled,
}: {
  value: ScheduleTiming;
  onChange: (next: ScheduleTiming) => void;
  disabled?: boolean;
}) {
  const [viewMonth, setViewMonth] = React.useState(value.month);
  const [viewYear, setViewYear] = React.useState(value.year);

  React.useEffect(() => {
    setViewMonth(value.month);
    setViewYear(value.year);
  }, [value.month, value.year]);

  function patch(partial: Partial<ScheduleTiming>) {
    onChange({ ...value, ...partial });
  }

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  const days = calendarDays(viewYear, viewMonth);
  const selected = { year: value.year, month: value.month, day: value.day };

  return (
    <div className="schedule-picker-panel">
      <LabeledSegment
        value={value.repeat}
        options={REPEAT_OPTIONS}
        onChange={(repeat) => patch({ repeat })}
        ariaLabel="Schedule frequency"
        segmentClass="segment-control--labeled segment-control--three w-full"
        className="w-full"
      />

      <CollapseSection open={value.repeat !== "daily"} className="schedule-picker-repeat-section">
        {value.repeat === "weekly" ? (
          <div className="schedule-picker-weekdays">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <button
                key={d}
                type="button"
                disabled={disabled}
                className={cn(
                  "schedule-picker-weekday",
                  value.dayOfWeek === d && "schedule-picker-weekday--active",
                )}
                onClick={() => patch({ dayOfWeek: d })}
              >
                {weekdayLabel(d)}
              </button>
            ))}
          </div>
        ) : null}

        {value.repeat === "once" ? (
          <div className="schedule-picker-calendar">
            <div className="schedule-picker-calendar-header">
              <button
                type="button"
                className="schedule-picker-nav"
                onClick={prevMonth}
                aria-label="Previous month"
              >
                <ChevronLeftIcon className="size-3.5" />
              </button>
              <Text variant="small-strong" color="secondary">
                {monthLabel(viewYear, viewMonth)}
              </Text>
              <button
                type="button"
                className="schedule-picker-nav"
                onClick={nextMonth}
                aria-label="Next month"
              >
                <ChevronRightIcon className="size-3.5" />
              </button>
            </div>
            <div className="schedule-picker-weekday-row">
              {["S", "M", "T", "W", "T", "F", "S"].map((label, i) => (
                <span key={i} className="schedule-picker-weekday-label">
                  {label}
                </span>
              ))}
            </div>
            <div className="schedule-picker-day-grid">
              {days.map((date, i) => {
                if (!date) {
                  return <span key={`empty-${i}`} className="schedule-picker-day-empty" />;
                }
                const active = isSameDay(date, selected);
                const today = isToday(date);
                return (
                  <button
                    key={date.toISOString()}
                    type="button"
                    disabled={disabled}
                    className={cn(
                      "schedule-picker-day",
                      active && "schedule-picker-day--active",
                      today && !active && "schedule-picker-day--today",
                    )}
                    onClick={() =>
                      patch({
                        year: date.getFullYear(),
                        month: date.getMonth(),
                        day: date.getDate(),
                      })
                    }
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </CollapseSection>

      <TimeSelects
        hour={value.hour}
        minute={value.minute}
        onHourChange={(hour) => patch({ hour })}
        onMinuteChange={(minute) => patch({ minute })}
        disabled={disabled}
      />
    </div>
  );
}

export function SchedulePicker({
  value,
  onChange,
  disabled,
  defaultOpen,
  open: openProp,
  onOpenChange,
}: {
  value: ScheduleTiming;
  onChange: (next: ScheduleTiming) => void;
  disabled?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false);
  const open = openProp ?? uncontrolledOpen;

  function setOpen(next: boolean) {
    if (openProp === undefined) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
  }

  return (
    <div className="schedule-picker">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "schedule-picker-trigger",
          open && "schedule-picker-trigger--open",
          disabled && "opacity-50",
        )}
      >
        <span className="schedule-picker-trigger-icon" aria-hidden>
          <CalendarIcon className="size-3.5" />
        </span>
        <span className="schedule-picker-trigger-text truncate">
          {formatScheduleSummary(value)}
        </span>
        <ChevronDownIcon
          className={cn(
            "schedule-picker-trigger-chevron size-3.5 shrink-0",
            open && "schedule-picker-trigger-chevron--open",
          )}
        />
      </button>
      <CollapseSection open={open && !disabled}>
        <SchedulePickerPanel value={value} onChange={onChange} disabled={disabled} />
      </CollapseSection>
    </div>
  );
}
