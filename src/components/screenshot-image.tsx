import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOffIcon } from "lucide-react";
import { runsScreenshot } from "../lib/ipc";

export function ScreenshotImage({ path, alt = "Screenshot" }: { path?: string; alt?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["runs:screenshot", path],
    queryFn: () => runsScreenshot(path as string),
    enabled: !!path,
    staleTime: Infinity,
  });

  if (path && isLoading) {
    return (
      <div
        className="w-full animate-pulse rounded-card border border-separator bg-well"
        style={{ aspectRatio: "16 / 10" }}
      />
    );
  }

  if (!path || !data?.dataUrl) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 rounded-card border border-separator bg-well py-6 text-center">
        <ImageOffIcon className="size-5 text-quaternary" />
        <span className="text-[11px] text-tertiary">No screenshot</span>
      </div>
    );
  }

  return (
    <div
      className="w-full overflow-hidden rounded-card border border-separator bg-well"
      style={{ aspectRatio: "16 / 10" }}
    >
      <img src={data.dataUrl} alt={alt} className="size-full object-cover object-top" />
    </div>
  );
}
