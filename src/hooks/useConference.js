import { useCallback, useEffect, useState } from "react";
import { DEFAULT_CONFERENCE, DEFAULT_PREFS, getConference, getPrefs, savePrefs } from "@/lib/settings";

export function useConference() {
  const [conference, setConference] = useState(DEFAULT_CONFERENCE);
  const [prefs, setPrefsState] = useState(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);

  const reload = async () => {
    const [config, local] = await Promise.all([getConference(), getPrefs()]);
    setConference(config);
    setPrefsState(local);
    setReady(true);
  };

  useEffect(() => {
    reload();
  }, []);

  const updatePrefs = async (patch) => {
    const next = await savePrefs(patch);
    setPrefsState(next);
    return next;
  };

  return { conference, prefs, ready, reload, updatePrefs, setConference };
}