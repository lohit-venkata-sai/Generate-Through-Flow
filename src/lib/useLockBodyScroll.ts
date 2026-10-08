import { useEffect } from "react";

let lockCount = 0;
let prevOverflow: string | null = null;

/**
 * Freezes background page scroll while a popup is mounted.
 * Reference-counted so stacked popups (e.g. Profile + Plans) stay locked
 * until the last one unmounts.
 */
export function useLockBodyScroll() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    lockCount += 1;
    if (lockCount === 1) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0 && typeof document !== "undefined") {
        document.body.style.overflow = prevOverflow ?? "";
        prevOverflow = null;
      }
    };
  }, []);
}
