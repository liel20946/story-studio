/** Marks a portaled overlay/menu that should consume Escape before route-level handlers. */
export const ESCAPE_DISMISS_LAYER_ATTR = "data-escape-dismiss-layer";

/** True when Escape should not trigger global back/home navigation. */
export function shouldIgnoreEscapeKey(event: KeyboardEvent): boolean {
  if (event.key !== "Escape") return true;
  if (event.defaultPrevented) return true;

  const el = document.activeElement;
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  ) {
    return true;
  }

  if (document.querySelector("[data-radix-popper-content-wrapper]")) {
    return true;
  }

  if (document.querySelector(`[${ESCAPE_DISMISS_LAYER_ATTR}]`)) {
    return true;
  }

  if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
    return true;
  }

  return false;
}
