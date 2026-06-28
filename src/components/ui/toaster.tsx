import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import { Toaster as Sonner, toast as sonnerToast } from "sonner";
import { clipboardWriteText } from "@/lib/ipc";

const GENERIC_ERROR_MESSAGE = "Oops, something went wrong";

export function Toaster() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <Sonner
      position="bottom-center"
      className="story-studio-toaster"
      closeButton
      richColors={false}
      duration={2500}
      gap={10}
      visibleToasts={1}
      offset={{ bottom: "1.5rem" }}
      icons={{
        close: (
          <XIcon className="size-3.5 shrink-0 text-primary lucide-icon-strong" />
        ),
      }}
      toastOptions={{
        classNames: {
          toast: "story-studio-toast",
          closeButton: "story-studio-toast-close",
          actionButton: "story-studio-toast-action",
        },
      }}
    />,
    document.body,
  );
}

export const toast = {
  success: (message: string) => sonnerToast.success(message),
  error: (message: string) => {
    const errorDetail = message.trim() || GENERIC_ERROR_MESSAGE;

    return sonnerToast.error(GENERIC_ERROR_MESSAGE, {
      id: "story-studio-error",
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
      action: {
        label: "Copy error",
        onClick: (event) => {
          event.preventDefault();
          void clipboardWriteText(errorDetail).catch((err) => {
            console.error("[toast] clipboard:writeText failed", err);
          });
        },
      },
    });
  },
};
