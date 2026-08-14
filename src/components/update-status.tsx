import * as React from "react";
import {
  ArrowDownToLineIcon,
  CircleAlertIcon,
  Loader2Icon,
  RotateCwIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";
import { reportAppErrorFromUnknown } from "@/lib/app-error";
import type { UpdateStatus } from "@/lib/contract-types";
import {
  onUpdatesStatus,
  updatesCheck,
  updatesDownload,
  updatesGetStatus,
  updatesInstall,
  updatesOpenDownloadPage,
} from "@/lib/ipc";

function idleStatus(): UpdateStatus {
  return {
    phase: "idle",
    enabled: false,
    currentVersion: "",
  };
}

function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = React.useState<UpdateStatus>(idleStatus);

  React.useEffect(() => {
    void updatesGetStatus()
      .then(setStatus)
      .catch((err) => {
        reportAppErrorFromUnknown("Failed to read update status", err);
      });
    return onUpdatesStatus(setStatus);
  }, []);

  return status;
}

function chipTooltip(status: UpdateStatus): string {
  const version = status.availableVersion
    ? `Story Studio ${status.availableVersion}`
    : "An update";
  switch (status.phase) {
    case "available":
      return `${version} is available`;
    case "downloading":
      return `Downloading ${version}…`;
    case "ready":
      return `Restart to install ${version}`;
    case "error":
      if (status.errorKind === "install") {
        return status.error
          ? `Could not install the update. ${status.error}`
          : "Could not install the update. Download the latest release instead.";
      }
      return status.error
        ? `Update failed. ${status.error}`
        : "Could not update. Try again.";
    default:
      return "";
  }
}

export function SidebarUpdateStatus() {
  const status = useUpdateStatus();
  const [busy, setBusy] = React.useState(false);

  const visible =
    status.phase === "available" ||
    status.phase === "downloading" ||
    status.phase === "ready" ||
    status.phase === "error" ||
    Boolean(status.notice);
  if (!visible) return null;

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (err) {
      reportAppErrorFromUnknown("Update action failed", err);
    } finally {
      setBusy(false);
    }
  }

  const percent = Math.max(0, Math.min(100, Math.round(status.percent ?? 0)));
  let label = "";
  let icon: React.ReactNode = null;
  let tone: "notice" | "available" | "downloading" | "ready" | "error" =
    "notice";
  let onClick: (() => void) | undefined;
  let ariaLabel = label;

  if (status.phase === "idle" && status.notice) {
    tone = "notice";
    label = status.notice;
    ariaLabel = status.notice;
  } else if (status.phase === "available") {
    tone = "available";
    label = "Update";
    ariaLabel = status.availableVersion
      ? `Download update ${status.availableVersion}`
      : "Download update";
    icon = <ArrowDownToLineIcon className="size-3.5" />;
    onClick = () => void run(() => updatesDownload());
  } else if (status.phase === "downloading") {
    tone = "downloading";
    label = `${percent}%`;
    ariaLabel = `Downloading update, ${percent} percent`;
    icon = <Loader2Icon className="size-3.5 animate-spin" />;
  } else if (status.phase === "ready") {
    tone = "ready";
    label = "Restart";
    ariaLabel = status.availableVersion
      ? `Restart to install ${status.availableVersion}`
      : "Restart to install update";
    icon = <RotateCwIcon className="size-3.5" />;
    onClick = () => void run(() => updatesInstall());
  } else if (status.phase === "error") {
    tone = "error";
    if (status.errorKind === "install") {
      label = "Get update";
      ariaLabel = "Open download page";
      onClick = () => void run(() => updatesOpenDownloadPage());
    } else if (status.errorKind === "check") {
      label = "Retry";
      ariaLabel = "Retry checking for updates";
      onClick = () => void run(() => updatesCheck());
    } else {
      label = "Retry";
      ariaLabel = "Retry update";
      onClick = () => void run(() => updatesDownload());
    }
    icon = <CircleAlertIcon className="size-3.5" />;
  }

  const interactive = Boolean(onClick) && !busy;
  const tooltip = chipTooltip(status);
  const showTooltip = Boolean(tooltip) && tooltip !== label;

  const chip = (
    <button
      type="button"
      data-update-phase={status.phase}
      aria-label={ariaLabel}
      disabled={!interactive}
      onClick={(e) => {
        e.currentTarget.blur();
        onClick?.();
      }}
      className={cn(
        "sidebar-update-chip",
        tone === "notice" && "sidebar-update-chip--notice",
        tone === "available" && "sidebar-update-chip--available",
        tone === "downloading" && "sidebar-update-chip--downloading",
        tone === "ready" && "sidebar-update-chip--ready",
        tone === "error" && "sidebar-update-chip--error",
      )}
    >
      {status.phase === "downloading" ? (
        <span
          className="sidebar-update-chip-fill"
          style={{ width: `${percent}%` }}
        />
      ) : null}
      <span className="sidebar-update-chip-content">
        {icon}
        <span className={status.phase === "downloading" ? "tabular-nums" : undefined}>
          {label}
        </span>
      </span>
    </button>
  );

  if (!showTooltip) return chip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
