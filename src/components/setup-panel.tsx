import { useCallback, useEffect, useState } from "react";
import {
  Button,
  toast,
} from "@/components/ui";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SetupItem, SetupItemId, SetupStatus } from "../lib/contract-types";
import { setupCheck, setupInstall, setupOpenUrl } from "../lib/ipc";
import { reportAppErrorFromUnknown } from "@/lib/app-error";
import {
  getCachedSetupStatus,
  setCachedSetupStatus,
} from "../lib/setup-status-cache";

function SetupStatusIcon({ ready }: { ready: boolean }) {
  if (ready) {
    return <CheckCircle2Icon className="size-4 shrink-0 text-success" aria-hidden />;
  }
  return <CircleAlertIcon className="size-4 shrink-0 text-warning" aria-hidden />;
}

function SetupItemRow({
  item,
  installing,
  onInstall,
  onOpenUrl,
}: {
  item: SetupItem;
  installing: boolean;
  onInstall: (id: SetupItemId) => void;
  onOpenUrl: (url: string) => void;
}) {
  const showInstall = !item.ready && item.installable;
  const showDownload = !item.ready && Boolean(item.downloadUrl);

  return (
    <div className="setup-item">
      <div className="setup-item-main">
        <SetupStatusIcon ready={item.ready} />
        <div className="setup-item-copy">
          <div className="setup-item-label">{item.label}</div>
          <p className="setup-item-desc">{item.description}</p>
          {item.detail ? (
            <p className="setup-item-detail" title={item.detail}>
              {item.detail}
            </p>
          ) : null}
        </div>
      </div>
      <div className="setup-item-actions">
        {showInstall ? (
          <Button
            variant="filled"
            size="small"
            radius="full"
            disabled={installing}
            onClick={() => onInstall(item.id)}
          >
            {installing ? (
              <Loader2Icon className="size-3.5 animate-spin text-accent" />
            ) : (
              <DownloadIcon className="size-3.5" />
            )}
            {installing ? "Installing…" : "Install"}
          </Button>
        ) : null}
        {showDownload ? (
          <Button
            variant="filled"
            size="small"
            radius="full"
            disabled={installing}
            onClick={() => onOpenUrl(item.downloadUrl!)}
          >
            <ExternalLinkIcon className="size-3.5" />
            Get
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function SetupPanel() {
  const [status, setStatus] = useState<SetupStatus | null>(() =>
    getCachedSetupStatus(),
  );
  const [loading, setLoading] = useState(false);
  const [installingId, setInstallingId] = useState<SetupItemId | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await setupCheck();
      setStatus(next);
      setCachedSetupStatus(next);
    } catch (err) {
      reportAppErrorFromUnknown("Setup check failed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (getCachedSetupStatus()) return;
    void refresh();
  }, [refresh]);

  const handleInstall = async (itemId: SetupItemId) => {
    setInstallingId(itemId);
    try {
      const res = await setupInstall(itemId);
      if (res.ok) {
        toast.success(res.message);
        await refresh();
      } else {
        toast.error(res.error ? `${res.message} ${res.error}` : res.message);
      }
    } catch (err) {
      reportAppErrorFromUnknown("Install failed", err);
    } finally {
      setInstallingId(null);
    }
  };

  const handleOpenUrl = async (url: string) => {
    try {
      await setupOpenUrl(url);
    } catch (err) {
      reportAppErrorFromUnknown("Could not open link", err);
    }
  };

  const readyCount = status?.items.filter((item) => item.ready).length ?? 0;
  const totalCount = status?.items.length ?? 0;
  const hasResults = Boolean(status?.items.length);

  return (
    <div className="settings-panel">
      <div className="setup-summary">
        <div className="setup-summary-copy">
          <p className="setup-summary-title">
            {loading && !hasResults
              ? "Checking your setup…"
              : status?.ready
                ? "Ready to record and run stories"
                : hasResults
                  ? "Some dependencies are missing"
                  : "Click Refresh to check your setup"}
          </p>
          {hasResults ? (
            <p className="setup-summary-desc">
              {loading
                ? "Refreshing…"
                : `${readyCount} of ${totalCount} checks passed. Install missing items below, then click Refresh.`}
            </p>
          ) : null}
        </div>
        <Button
          variant="filled"
          size="small"
          radius="full"
          disabled={loading || installingId !== null}
          onClick={() => void refresh()}
        >
          {loading ? (
            <Loader2Icon className="size-3.5 animate-spin text-accent" />
          ) : (
            <RefreshCwIcon className="size-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {hasResults ? (
        <div className={cn("setup-list", loading && "setup-list--loading")}>
          {status!.items.map((item) => (
            <SetupItemRow
              key={item.id}
              item={item}
              installing={installingId === item.id}
              onInstall={handleInstall}
              onOpenUrl={handleOpenUrl}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
