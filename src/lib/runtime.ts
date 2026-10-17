export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Celulares e navegadores antigos não têm `getDisplayMedia`: dá para assistir, não para transmitir. */
export function canCaptureScreen(): boolean {
  if (isTauriRuntime()) return true;
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}
