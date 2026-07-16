import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings, Task, Project, PomodoroSession } from "./types";
import { loadSettings, saveSettings, loadTasks, saveTasks, loadProjects, saveProjects, loadSessions, saveSessions } from "./storage";
import { supabase, isSupabaseConfigured, type UserDataRow } from "./supabase";

export type SyncStatus = "disabled" | "signed-out" | "syncing" | "synced" | "error";

const TABLE = "user_data";

/** ISO timestamp of the last known local data change (settings/tasks/
 * projects/sessions). Used to decide, on first sign-in on a device, whether
 * the local copy or the remote copy is more current. Written by this hook
 * only (see the polling effect below) — normal edits elsewhere in the app
 * go through storage.ts directly and don't touch this key, so "local has
 * never been touched" (key absent) is indistinguishable from "local was
 * edited but this device never ran the sync poll yet". See the sync
 * merge-logic caveat in useSync's top comment. */
const LOCAL_UPDATED_AT_KEY = "pomofree:localDataUpdatedAt";

const POLL_INTERVAL_MS = 5000;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function getLocalUpdatedAt(): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(LOCAL_UPDATED_AT_KEY);
  } catch {
    return null;
  }
}

function setLocalUpdatedAt(iso: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(LOCAL_UPDATED_AT_KEY, iso);
  } catch {
    // ignore — localStorage may be unavailable (private mode, quota, etc.)
  }
}

interface LocalDataSnapshot {
  settings: Settings;
  tasks: Task[];
  projects: Project[];
  sessions: PomodoroSession[];
}

function readLocalData(): LocalDataSnapshot {
  return {
    settings: loadSettings(),
    tasks: loadTasks(),
    projects: loadProjects(),
    sessions: loadSessions(),
  };
}

/**
 * Optional Supabase-backed cross-device account sync.
 *
 * Follows the hydration-safe pattern used by useSettings.ts/useTasks.ts/
 * useProjects.ts/useActiveTask.ts: no localStorage or network access happens
 * during the initial render, only inside effects that run after mount, so
 * the client's first paint always matches the server-rendered markup.
 * Unlike those hooks, the bookkeeping here (which user is signed in, what
 * was last pushed) is procedural rather than render-driving state, so it's
 * tracked in refs rather than a `hydrated` boolean gating a persist effect
 * — there's no risk of an effect seeing a stale closure the way the long
 * comment in useSettings.ts warns about, because nothing here persists a
 * piece of render state on a schedule tied to a load/hydrate pair.
 *
 * When `!isSupabaseConfigured` every method is a safe no-op and syncStatus
 * is always "disabled" — the app must work fully offline regardless of
 * whether Supabase credentials were provided at build time.
 *
 * Sync strategy (single `user_data` row per user, see supabase-schema.sql):
 *  - On sign-in, fetch the user's row once.
 *    - No row yet -> first sync for this account, push local data up.
 *    - Row exists -> compare its `updated_at` against the local
 *      "last local data change" timestamp. If local has never been synced
 *      before, or remote is newer, PULL (overwrite local via storage.ts,
 *      then reload the page once so every hook re-reads localStorage
 *      fresh). Otherwise PUSH local up (skipped entirely if the two are
 *      already identical, to avoid pointless writes).
 *  - While signed in, a 5s poll compares the current local data against
 *    the last-synced snapshot; on a difference it pushes an upsert. This
 *    avoids having to thread a "notify sync of a change" call through
 *    useSettings/useTasks/useProjects, at the cost of up to ~5s of
 *    propagation delay between an edit and it reaching other devices.
 */
export function useSync() {
  const [email, setEmail] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(isSupabaseConfigured ? "signed-out" : "disabled");

  const userIdRef = useRef<string | null>(null);
  const hasRunInitialSyncRef = useRef(false);
  const lastSyncedSnapshotRef = useRef<string | null>(null);
  const isSyncingRef = useRef(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reloadingRef = useRef(false);

  const pushLocalData = useCallback(async (userId: string) => {
    if (!supabase) return;
    const local = readLocalData();
    const nowIso = new Date().toISOString();
    const { error } = await supabase.from(TABLE).upsert({
      user_id: userId,
      settings: local.settings,
      tasks: local.tasks,
      projects: local.projects,
      sessions: local.sessions,
      updated_at: nowIso,
    });
    if (error) throw error;
    setLocalUpdatedAt(nowIso);
    lastSyncedSnapshotRef.current = JSON.stringify(local);
  }, []);

  const runInitialSync = useCallback(
    async (userId: string) => {
      if (!supabase || isSyncingRef.current) return;
      isSyncingRef.current = true;
      setSyncStatus("syncing");
      try {
        const { data, error } = await supabase.from(TABLE).select("*").eq("user_id", userId).maybeSingle();
        if (error) throw error;

        if (!data) {
          // First time this account has synced from any device — seed the
          // remote row from whatever's on this device right now.
          await pushLocalData(userId);
          setSyncStatus("synced");
          return;
        }

        const row = data as UserDataRow;
        const localTsStr = getLocalUpdatedAt();
        const localTs = localTsStr ? new Date(localTsStr).getTime() : null;
        const remoteTs = new Date(row.updated_at).getTime();

        if (localTs === null || remoteTs > localTs) {
          // Remote is newer, or this device has never synced before —
          // remote wins. See the LOCAL_UPDATED_AT_KEY comment above for the
          // caveat this implies when a second device has unsynced local
          // edits at first-ever sign-in.
          saveSettings((row.settings as Settings) ?? loadSettings());
          saveTasks((row.tasks as Task[]) ?? []);
          saveProjects((row.projects as Project[]) ?? []);
          saveSessions((row.sessions as PomodoroSession[]) ?? []);
          setLocalUpdatedAt(row.updated_at);
          setSyncStatus("synced");
          if (!reloadingRef.current && typeof window !== "undefined") {
            reloadingRef.current = true;
            window.location.reload();
          }
          return;
        }

        // Local is at least as fresh as remote — push, unless the two are
        // already identical (nothing to do, and no point writing).
        const local = readLocalData();
        const localSnapshot = JSON.stringify(local);
        const remoteSnapshot = JSON.stringify({
          settings: row.settings,
          tasks: row.tasks,
          projects: row.projects,
          sessions: row.sessions,
        });
        if (localSnapshot !== remoteSnapshot) {
          await pushLocalData(userId);
        } else {
          lastSyncedSnapshotRef.current = localSnapshot;
        }
        setSyncStatus("synced");
      } catch (err) {
        console.warn("[pomofree] initial sync failed:", err);
        setSyncStatus("error");
      } finally {
        isSyncingRef.current = false;
      }
    },
    [pushLocalData],
  );

  // Auth state: subscribe once. onAuthStateChange fires immediately with
  // the current session (including null) on subscribe, so this also
  // covers the "already signed in" case on load (e.g. after following a
  // magic-link redirect) without a separate getSession() call.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    lastSyncedSnapshotRef.current = JSON.stringify(readLocalData());

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        userIdRef.current = session.user.id;
        setEmail(session.user.email ?? null);
        if (!hasRunInitialSyncRef.current) {
          hasRunInitialSyncRef.current = true;
          void runInitialSync(session.user.id);
        }
      } else {
        userIdRef.current = null;
        hasRunInitialSyncRef.current = false;
        setEmail(null);
        setSyncStatus("signed-out");
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [runInitialSync]);

  // Ongoing debounced push: while signed in, poll local data every ~5s and
  // upsert on any change. Deliberately doesn't hook into
  // useSettings/useTasks/useProjects to avoid touching those files.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    if (!email) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    pollIntervalRef.current = setInterval(() => {
      const userId = userIdRef.current;
      if (!userId || isSyncingRef.current) return;

      const snapshotJson = JSON.stringify(readLocalData());
      if (snapshotJson === lastSyncedSnapshotRef.current) return;

      isSyncingRef.current = true;
      setSyncStatus("syncing");
      void (async () => {
        try {
          await pushLocalData(userId);
          setSyncStatus("synced");
        } catch (err) {
          console.warn("[pomofree] background sync failed:", err);
          setSyncStatus("error");
        } finally {
          isSyncingRef.current = false;
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [email, pushLocalData]);

  const sendMagicLink = useCallback(async (emailInput: string): Promise<{ ok: boolean; error?: string }> => {
    if (!isSupabaseConfigured || !supabase) {
      return { ok: false, error: "Sync is not configured for this deployment." };
    }
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: emailInput,
        options: {
          emailRedirectTo: typeof window !== "undefined" ? window.location.href : undefined,
        },
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn("[pomofree] sign-out failed:", err);
    }
  }, []);

  return { email, syncStatus, sendMagicLink, signOut };
}
