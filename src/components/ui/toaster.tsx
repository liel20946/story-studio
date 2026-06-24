import { XIcon } from "lucide-react";
import { Toaster as Sonner, toast as sonnerToast } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      className="story-studio-toaster"
      closeButton
      richColors={false}
      duration={2500}
      gap={10}
      visibleToasts={3}
      icons={{
        close: (
          <XIcon
            className="size-3.5 shrink-0 text-primary"
            strokeWidth={2}
          />
        ),
      }}
      toastOptions={{
        classNames: {
          toast: "story-studio-toast",
          closeButton: "story-studio-toast-close",
        },
      }}
    />
  );
}

export const toast = {
  success: (message: string) => sonnerToast.success(message),
  error: (message: string) => sonnerToast.error(message),
};
