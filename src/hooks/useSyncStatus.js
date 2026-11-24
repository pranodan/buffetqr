import { useEffect, useState } from "react";
import { initSyncState, subscribeSync, syncState } from "@/lib/sync";

export function useSyncStatus() {
  const [state, setState] = useState(syncState());

  useEffect(() => {
    let alive = true;
    const unsubscribe = subscribeSync((next) => {
      if (alive) setState(next);
    });
    initSyncState();
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return state;
}