import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * SideDrawer — ONE wrapper holding both side panels.
 *
 * Desktop (>900px): `display:contents`, so the two panels become direct grid
 * items of `.app` and keep their column pins.
 * Mobile (<=900px): a fixed sheet that slides in over a scrim.
 *
 * The centre must never live inside this wrapper — the whole app would slide
 * off-screen and the page would look blank.
 */
export function SideDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div
        role="presentation"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-bg/70 transition-opacity duration-200 wide:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[86%] flex-col overflow-hidden",
          "border-r border-border bg-panel",
          "transition-transform duration-200 ease-[var(--ease)]",
          open ? "translate-x-0" : "-translate-x-[101%]",
          "wide:contents",
        )}
      >
        {children}
      </div>
    </>
  );
}
