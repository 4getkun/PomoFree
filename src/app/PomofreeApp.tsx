import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSettings } from "./lib/useSettings";
import { useActiveTask } from "./lib/useActiveTask";
import { useSync } from "./lib/useSync";
import { useTasks } from "./lib/useTasks";
import { useTimerEngine, type PhaseEndEvent } from "./lib/timer";
import { isAmbientSoundId } from "./lib/types";
import { createAmbientSoundEngine, type AmbientSoundEngine } from "./lib/ambientSound";
import { playChime } from "./lib/sound";
import { formatMMSS, PHASE_LABEL, notificationCopy } from "./lib/timerDisplay";
import { BASE_URL } from "./lib/base";
import { shouldIgnoreShortcut } from "./lib/keyboard";
import TimerView from "./views/TimerView";
import TasksView from "./views/TasksView";
import StatsView from "./views/StatsView";
import SettingsView from "./views/SettingsView";

type ViewId = "timer" | "tasks" | "stats" | "settings";

const NAV_ITEMS: { id: ViewId; label: string; icon: ReactNode }[] = [
  {
    id: "timer",
    label: "タイマー",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 2h6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "tasks",
    label: "タスク",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
        <path d="M9 11l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="3" y="4" width="18" height="16" rx="2" />
      </svg>
    ),
  },
  {
    id: "stats",
    label: "統計",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
        <path d="M4 20V10M12 20V4M20 20v-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "設定",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.04 1.56V21a2 2 0 11-4 0v-.09A1.7 1.7 0 008.96 19.4a1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.7 1.7 0 004.6 15a1.7 1.7 0 00-1.56-1.04H3a2 2 0 110-4h.09A1.7 1.7 0 004.6 8.96a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06A1.7 1.7 0 008.96 4.6a1.7 1.7 0 001.04-1.56V3a2 2 0 114 0v.09a1.7 1.7 0 001.04 1.56 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06A1.7 1.7 0 0019.4 8.96a1.7 1.7 0 001.56 1.04H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.56 1.04z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

const VIEW_TITLE: Record<ViewId, string> = {
  timer: "タイマー",
  tasks: "タスク",
  stats: "統計",
  settings: "設定",
};

/** Number-key shortcuts for switching tabs, in the same order as NAV_ITEMS. */
const KEY_TO_VIEW: Record<string, ViewId> = {
  "1": "timer",
  "2": "tasks",
  "3": "stats",
  "4": "settings",
};

/**
 * Root of the client-side app. Owns the tab-switcher via plain React state
 * (no router) so the in-memory timer countdown in TimerView survives
 * switching tabs without a page reload.
 */
export default function PomofreeApp() {
  const [activeView, setActiveView] = useState<ViewId>("timer");
  const { settings, updateSettings } = useSettings();
  const { activeTaskId, setActiveTaskId } = useActiveTask();
  // Called unconditionally at the root (not inside SettingsView) so the
  // background sync poll and auth listener keep running while the user is
  // on any tab, not just Settings — mirrors how useSettings/useActiveTask
  // are hoisted here rather than into the views that display them.
  const sync = useSync();

  // Task data lives here (not inside TasksView) for the same reason the
  // timer engine below does: TimerView's active-task dropdown/progress
  // display needs it too, and a single shared instance avoids two
  // independently-diverging in-memory copies of the same localStorage-backed
  // array.
  const tasks = useTasks();

  // --- Timer engine: hoisted from TimerView -------------------------------
  // Originally `useTimerEngine` (plus the ambient sound engine, the chime/
  // notification handler, and the document-title effect) lived inside
  // TimerView. Since PomofreeApp only *conditionally renders* TimerView
  // (`{activeView === "timer" && <TimerView .../>}`), switching to another
  // tab unmounted TimerView entirely — destroying the timer's state (and,
  // if paused mid-session, silently dropping it without ever recording it
  // to stats). Hoisting everything here, to the always-mounted root,
  // mirrors the pattern already used by useSettings/useActiveTask/useSync
  // above: state that must survive a tab switch is owned by the component
  // that never unmounts.
  const handlePhaseEnd = useCallback(
    (event: PhaseEndEvent) => {
      // Always play the synthesized chime as immediate feedback.
      playChime(settings.soundVolume);

      // Only fire a browser notification if the user opted in AND the page
      // currently lacks focus (otherwise the audible chime is enough).
      if (
        settings.notificationsEnabled &&
        typeof window !== "undefined" &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        !document.hasFocus()
      ) {
        const { title, body } = notificationCopy(event);
        try {
          new Notification(title, { body, icon: `${BASE_URL}favicon.svg` });
        } catch {
          // Notification construction can throw in some environments — ignore.
        }
      }
    },
    [settings.soundVolume, settings.notificationsEnabled],
  );

  const timer = useTimerEngine(settings, {
    onPhaseEnd: handlePhaseEnd,
    activeTaskId,
    onWorkSessionComplete: tasks.incrementCompletedPomodoros,
  });
  const { phase, status, remainingMs } = timer;

  const originalTitleRef = useRef<string | null>(null);

  // One ambient-sound engine for the whole app lifetime (was previously
  // created/disposed on every TimerView mount/unmount).
  const soundEngineRef = useRef<AmbientSoundEngine | null>(null);
  useEffect(() => {
    soundEngineRef.current = createAmbientSoundEngine();
    return () => {
      soundEngineRef.current?.dispose();
      soundEngineRef.current = null;
    };
  }, []);

  // Ambient sound only plays during an actively-running work phase — paused,
  // on break, or soundId === null all stop it (with a short fade, handled
  // inside the engine).
  useEffect(() => {
    const engine = soundEngineRef.current;
    if (!engine) return;
    const shouldPlay = phase === "work" && status === "running" && isAmbientSoundId(settings.soundId);
    if (shouldPlay && isAmbientSoundId(settings.soundId)) {
      engine.play(settings.soundId, settings.soundVolume);
    } else {
      engine.stop();
    }
    // settings.soundVolume intentionally excluded — live volume changes are
    // handled by the effect below instead of restarting the sound.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, status, settings.soundId]);

  // Live volume updates while a sound is already playing (e.g. the user
  // adjusts the slider in Settings mid-session) without restarting it.
  useEffect(() => {
    soundEngineRef.current?.setVolume(settings.soundVolume);
  }, [settings.soundVolume]);

  // Reflect the running countdown in the document title so it's visible
  // from a background tab, regardless of which in-app tab is active.
  useEffect(() => {
    if (originalTitleRef.current == null) {
      originalTitleRef.current = document.title;
    }
    if (status === "running" || status === "paused") {
      const suffix = status === "paused" ? "一時停止" : PHASE_LABEL[phase];
      document.title = `${formatMMSS(remainingMs)} - ${suffix} | Pomofree`;
    } else {
      document.title = originalTitleRef.current ?? "Pomofree";
    }
  }, [remainingMs, status, phase]);
  // -------------------------------------------------------------------------

  // Global tab-switch shortcuts (1-4). Timer-control shortcuts (Space/S/R)
  // live inside TimerView itself since they only make sense while that tab
  // is showing; see the guard in lib/keyboard.ts for why typing in a field
  // or holding a modifier key never triggers these.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (shouldIgnoreShortcut(e)) return;
      const view = KEY_TO_VIEW[e.key];
      if (view) setActiveView(view);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex min-h-screen flex-col md:flex-row" style={{ backgroundColor: "var(--bg)", color: "var(--text)" }}>
      <nav
        className="order-2 flex shrink-0 justify-around border-t px-2 py-2 md:order-1 md:w-56 md:flex-col md:justify-start md:gap-1 md:border-t-0 md:border-r md:px-3 md:py-6"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        aria-label="メインナビゲーション"
      >
        <a
          href={BASE_URL}
          className="mb-4 hidden px-2 text-lg font-bold md:block"
          style={{ color: "var(--text)" }}
        >
          <span style={{ color: "var(--accent)" }}>Pomo</span>free
        </a>
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
              aria-current={isActive ? "page" : undefined}
              className="flex flex-1 flex-col items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium transition md:flex-row md:justify-start md:gap-3 md:text-sm"
              style={{
                color: isActive ? "var(--accent)" : "var(--text-muted)",
                backgroundColor: isActive ? "var(--ring)" : "transparent",
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <main className="order-1 flex-1 px-4 py-6 md:order-2 md:px-10 md:py-10">
        <div className="mx-auto w-full max-w-3xl">
          <h1 className="mb-6 text-xl font-semibold md:hidden" style={{ color: "var(--text)" }}>
            {VIEW_TITLE[activeView]}
          </h1>
          {activeView === "timer" && (
            <TimerView
              settings={settings}
              activeTaskId={activeTaskId}
              setActiveTaskId={setActiveTaskId}
              tasks={tasks.tasks}
              timer={timer}
            />
          )}
          {activeView === "tasks" && (
            <TasksView
              activeTaskId={activeTaskId}
              setActiveTaskId={setActiveTaskId}
              tasks={tasks.tasks}
              addTask={tasks.addTask}
              updateTask={tasks.updateTask}
              deleteTask={tasks.deleteTask}
              toggleComplete={tasks.toggleComplete}
              addSubtask={tasks.addSubtask}
              removeSubtask={tasks.removeSubtask}
              toggleSubtask={tasks.toggleSubtask}
              clearProjectReferences={tasks.clearProjectReferences}
            />
          )}
          {activeView === "stats" && <StatsView />}
          {activeView === "settings" && (
            <SettingsView
              settings={settings}
              updateSettings={updateSettings}
              email={sync.email}
              syncStatus={sync.syncStatus}
              sendMagicLink={sync.sendMagicLink}
              signOut={sync.signOut}
            />
          )}
        </div>
      </main>
    </div>
  );
}
