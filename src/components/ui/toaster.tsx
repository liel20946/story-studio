import { Toaster as Sonner, toast as sonnerToast } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      className="story-studio-toaster"
      richColors={false}
      gap={10}
      visibleToasts={3}
      toastOptions={{
        classNames: {
          toast: "story-studio-toast",
        },
      }}
    />
  );
}

export const toast = {
  success: (message: string) => sonnerToast.success(message),
  error: (message: string) => sonnerToast.error(message),
};
