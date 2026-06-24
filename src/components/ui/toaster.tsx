import { Toaster as Sonner, toast as sonnerToast } from "sonner";

export function Toaster() {
  return <Sonner position="bottom-right" richColors closeButton />;
}

export const toast = {
  success: (message: string) => sonnerToast.success(message),
  error: (message: string) => sonnerToast.error(message),
};
