import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LeftPanel } from "./LeftPanel";
import { BeliefRoom } from "./BeliefRoom";
import { RoomPanel } from "./RoomPanel";
import { SideDrawer } from "./SideDrawer";
import { ConvictionWalletProvider, WalletBridge, useWallet } from "./WalletProvider";
import { useConvictionRealtime, useViewer } from "@/lib/conviction-data";

/**
 * AppShell — one application, no page navigation.
 * The connected address IS the identity: it personalises every surface the
 * moment it arrives, with no linking step.
 */
export function AppShell() {
  return (
    <ConvictionWalletProvider>
      <WalletBridge>
        <Shell />
      </WalletBridge>
    </ConvictionWalletProvider>
  );
}

function Shell() {
  const { address, connect } = useWallet();
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [beliefId, setBeliefId] = useState<string | null>(null);
  const close = useCallback(() => setDrawerOpen(false), []);

  const viewer = useViewer(address);
  useConvictionRealtime(beliefId, address);

  const selectBelief = useCallback((id: string) => {
    setBeliefId(id);
    setDrawerOpen(false);
  }, []);

  // First join flips the profile to qualified: refetch viewer, belief, positions
  // and the room together so rings, match numbers and the relationship read all
  // become real in the same frame.
  const onJoined = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["viewer", address] });
    void qc.invalidateQueries({ queryKey: ["belief", beliefId, address] });
    void qc.invalidateQueries({ queryKey: ["positions", address] });
    void qc.invalidateQueries({ queryKey: ["room-feed", address] });
  }, [qc, address, beliefId]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, close]);

  return (
    <div className="grid h-[100dvh] grid-cols-1 overflow-hidden bg-bg wide:grid-cols-[minmax(210px,236px)_minmax(560px,1fr)_minmax(290px,326px)]">
      {/* Centre is never inside the drawer wrapper. */}
      <BeliefRoom
        onOpenDrawer={() => setDrawerOpen(true)}
        beliefId={beliefId}
        onSelectBelief={selectBelief}
        viewer={viewer.data}
        address={address}
        onJoined={onJoined}
      />

      <SideDrawer open={drawerOpen} onClose={close}>
        <LeftPanel
          address={address}
          viewer={viewer.data}
          onConnect={connect}
          onSelectBelief={selectBelief}
        />
        <RoomPanel address={address} onSelectBelief={selectBelief} />
      </SideDrawer>
    </div>
  );
}
