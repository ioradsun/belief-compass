import { useCallback, useEffect, useState } from "react";
import { LeftPanel } from "./LeftPanel";
import { BeliefRoom } from "./BeliefRoom";
import { RoomPanel } from "./RoomPanel";
import { SideDrawer } from "./SideDrawer";

/**
 * AppShell — one application, no page navigation.
 * Selecting anything changes the centre; the surrounding context persists.
 * Nothing scrolls at the page level; each panel scrolls independently.
 */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const close = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, close]);

  return (
    <div
      className="grid h-[100dvh] grid-cols-1 overflow-hidden bg-bg wide:grid-cols-[minmax(210px,236px)_minmax(560px,1fr)_minmax(290px,326px)]"
    >
      {/* Centre is never inside the drawer wrapper. */}
      <BeliefRoom onOpenDrawer={() => setDrawerOpen(true)} />

      <SideDrawer open={drawerOpen} onClose={close}>
        <LeftPanel />
        <RoomPanel />
      </SideDrawer>
    </div>
  );
}
