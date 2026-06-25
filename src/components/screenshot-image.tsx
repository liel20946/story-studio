import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon, ImageOffIcon, XIcon } from "lucide-react";
import { runsScreenshot } from "../lib/ipc";
import { cn } from "@/lib/utils";

type ScreenshotQueryData = { dataUrl: string | null };

function screenshotQueryKey(path: string) {
  return ["runs:screenshot", path] as const;
}

function useScreenshotDataUrl(path?: string) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: path ? screenshotQueryKey(path) : ["runs:screenshot", "none"],
    queryFn: () => runsScreenshot(path as string),
    enabled: !!path,
    staleTime: Infinity,
    gcTime: Infinity,
    initialData: () =>
      path ? queryClient.getQueryData<ScreenshotQueryData>(screenshotQueryKey(path)) : undefined,
  });
}

export function ScreenshotImage({
  path,
  alt = "Screenshot",
  onClick,
  className,
  fit = "cover",
}: {
  path?: string;
  alt?: string;
  onClick?: () => void;
  className?: string;
  fit?: "cover" | "contain";
}) {
  const { data, isPending } = useScreenshotDataUrl(path);
  const dataUrl = data?.dataUrl ?? null;
  const canOpen = !!onClick && !!dataUrl;

  if (path && isPending && !dataUrl) {
    return (
      <div
        className={cn(
          "w-full animate-pulse rounded-card border border-separator bg-well",
          className,
        )}
        style={{ aspectRatio: "16 / 10" }}
      />
    );
  }

  if (!path || !dataUrl) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 rounded-card border border-separator bg-well py-6 text-center">
        <ImageOffIcon className="size-5 text-quaternary" />
        <span className="text-[11px] text-tertiary">No screenshot</span>
      </div>
    );
  }

  const image = (
    <img
      src={dataUrl}
      alt={alt}
      className={cn(
        "size-full",
        fit === "contain" ? "object-contain" : "object-cover object-top",
      )}
    />
  );

  const frameClass = cn(
    "w-full overflow-hidden rounded-card border border-separator bg-well",
    canOpen && "cursor-pointer transition-opacity hover:opacity-90",
    className,
  );

  if (canOpen) {
    return (
      <button
        type="button"
        className={cn(frameClass, "block p-0 text-left")}
        style={{ aspectRatio: "16 / 10" }}
        onClick={onClick}
        aria-label="Open screenshot full view"
      >
        {image}
      </button>
    );
  }

  return (
    <div className={frameClass} style={{ aspectRatio: "16 / 10" }}>
      {image}
    </div>
  );
}

function LightboxNavButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === "prev" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={direction === "prev" ? "Previous screenshot" : "Next screenshot"}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full border border-separator bg-popover/90 text-primary shadow-lg backdrop-blur-sm transition-opacity",
        disabled ? "cursor-not-allowed opacity-30" : "hover:bg-surface-hover",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

export function ScreenshotLightbox({
  paths,
  index,
  open,
  onOpenChange,
  onIndexChange,
}: {
  paths: string[];
  index: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIndexChange: (index: number) => void;
}) {
  const path = paths[index];
  const { data, isPending } = useScreenshotDataUrl(path);
  const dataUrl = data?.dataUrl ?? null;
  const hasMultiple = paths.length > 1;
  const openedAtRef = React.useRef(0);

  React.useEffect(() => {
    if (open) openedAtRef.current = Date.now();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (e.key === "ArrowRight" && index < paths.length - 1) onIndexChange(index + 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, index, paths.length, onOpenChange, onIndexChange]);

  function handleBackdropClose() {
    // Ignore the same click that opened the lightbox (mouseup lands on the backdrop).
    if (Date.now() - openedAtRef.current < 400) return;
    onOpenChange(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/80"
        onClick={handleBackdropClose}
        aria-label="Close screenshot view"
      />
      <button
        type="button"
        className="absolute right-4 top-4 z-10 flex size-8 items-center justify-center rounded-full border border-separator bg-popover/90 text-primary shadow-lg backdrop-blur-sm hover:bg-surface-hover"
        onClick={() => onOpenChange(false)}
        aria-label="Close"
      >
        <XIcon className="size-4" />
      </button>

      {hasMultiple && (
        <div className="absolute left-4 top-1/2 z-10 -translate-y-1/2">
          <LightboxNavButton
            direction="prev"
            disabled={index === 0}
            onClick={() => onIndexChange(index - 1)}
          />
        </div>
      )}

      <div
        className="relative z-[1] flex max-h-[90vh] max-w-[90vw] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {isPending && !dataUrl ? (
          <div
            className="size-[min(90vw,960px)] animate-pulse rounded-card bg-well"
            style={{ aspectRatio: "16 / 10" }}
          />
        ) : !dataUrl ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-separator bg-well px-8 py-12">
            <ImageOffIcon className="size-8 text-quaternary" />
            <span className="text-[12px] text-tertiary">No screenshot</span>
          </div>
        ) : (
          <img
            src={dataUrl}
            alt={`Screenshot ${index + 1}`}
            className="max-h-[90vh] max-w-[90vw] rounded-card object-contain shadow-2xl"
          />
        )}
      </div>

      {hasMultiple && (
        <div className="absolute right-4 top-1/2 z-10 -translate-y-1/2">
          <LightboxNavButton
            direction="next"
            disabled={index === paths.length - 1}
            onClick={() => onIndexChange(index + 1)}
          />
        </div>
      )}
    </div>
  );
}
