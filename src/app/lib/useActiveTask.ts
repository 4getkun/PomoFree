import { useCallback, useEffect, useState } from "react";
import { loadActiveTaskId, saveActiveTaskId } from "./storage";

/**
 * Tracks which Task the running/next timer session should be credited to.
 * Lives at the PomofreeApp root (alongside useSettings) and is threaded down
 * into TimerView (to display/select it and tag completed work sessions) and
 * TasksView (to let a task be picked as active from the task list, and to
 * show which one currently is).
 *
 * Starts at `null` (not loadActiveTaskId()) and loads the real value in an
 * effect after mount, for the same server/client hydration-mismatch reason
 * documented in useSettings.ts — this hook is also used unconditionally at
 * the PomofreeApp root, which is part of the initial server-rendered markup.
 */
export function useActiveTask() {
  const [activeTaskId, setActiveTaskIdState] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setActiveTaskIdState(loadActiveTaskId());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveActiveTaskId(activeTaskId);
  }, [activeTaskId, hydrated]);

  const setActiveTaskId = useCallback((id: string | null) => {
    setActiveTaskIdState(id);
  }, []);

  return { activeTaskId, setActiveTaskId };
}
