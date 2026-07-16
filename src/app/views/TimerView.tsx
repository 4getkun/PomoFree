import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Settings } from "../lib/types";
import { isAmbientSoundId } from "../lib/types";
import { useTimerEngine, type PhaseEndEvent, type TimerPhase } from "../lib/timer";
import { playChime } from "../lib/sound";
import { createAmbientSoundEngine, type AmbientSoundEngine } from "../lib/ambientSound";
import { useTasks } from "../lib/useTasks";
import { BASE_URL } from "../lib/base";
import { shouldIgnoreShortcut } from "../lib/keyboard";

interface TimerViewProps {
  settings: Settings;
  activeTaskId: string | null;
  setActiveTaskId: (id: string | null) => void;
}

const PHASE_LABEL: Record<TimerPhase, string> = {
  work: "作業中",
  shortBreak: "短い休憩",
  longBreak: "長い休憩",
};

const PHASE_LABEL_SHORT: Record<TimerPhase, string> = {
  work: "作業",
  shortBreak: "小休憩",
  longBreak: "長休憩",
};

function formatMMSS(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function notificationCopy(event: PhaseEndEvent): { title: string; body: string } {
  if (event.endedPhase === "work") {
    return {
      title: "作業セッション終了",
      body: event.nextPhase === "longBreak" ? "お疲れさまでした。長い休憩を取りましょう。" : "お疲れさまでした。少し休憩しましょう。",
    };
  }
  return {
    title: event.endedPhase === "longBreak" ? "長い休憩終了" : "休憩終了",
    body: "次の作業セッションを始めましょう。",
  };
}

export default function TimerView({ settings, activeTaskId, setActiveTaskId }: TimerViewProps) {
  const { tasks, incrementCompletedPomodoros } = useTasks();
  const selectableTasks = useMemo(() => tasks.filter((t) => !t.completed), [tasks]);
  const activeTask = useMemo(() => tasks.find((t) => t.id === activeTaskId) ?? null, [tasks, activeTaskId]);

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
    onWorkSessionComplete: incrementCompletedPomodoros,
  });
  const { phase, status, remainingMs, totalMs, completedWorkSessions, start, pause, skip, reset } = timer;

  const originalTitleRef = useRef<string | null>(null);

  // One ambient-sound engine per mount, torn down on unmount so its
  // AudioContext (and any scheduled noise-transient timers) don't leak.
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
  // from a background tab.
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
    return () => {
      if (originalTitleRef.current) document.title = originalTitleRef.current;
    };
  }, [remainingMs, status, phase]);

  // Keyboard shortcuts, active only while the Timer tab is mounted: Space
  // starts/pauses, S skips, R resets. Disabled while typing in any field
  // (including the active-task <select> above) or while a modifier key is
  // held, so browser shortcuts and normal form interaction are unaffected.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (shouldIgnoreShortcut(e)) return;
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        if (status === "running") pause();
        else start();
      } else if (e.key === "s" || e.key === "S") {
        skip();
      } else if (e.key === "r" || e.key === "R") {
        reset();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [status, start, pause, skip, reset]);

  const progress = totalMs > 0 ? 1 - remainingMs / totalMs : 0;
  const clampedProgress = Math.min(1, Math.max(0, progress));

  const cyclePosition = useMemo(() => {
    const n = Math.max(1, settings.sessionsBeforeLongBreak);
    const positionInCycle = completedWorkSessions % n;
    // While actively working, show the *current* session's ordinal (1-indexed).
    const current = phase === "work" ? positionInCycle + 1 : positionInCycle === 0 ? n : positionInCycle;
    return { current, total: n };
  }, [completedWorkSessions, settings.sessionsBeforeLongBreak, phase]);

  const radius = 120;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clampedProgress);

  const phaseColor =
    phase === "work" ? "var(--accent)" : phase === "shortBreak" ? "var(--success)" : "var(--accent-hover)";

  return (
    <div className="flex flex-col items-center gap-8 py-4">
      <div className="flex w-full max-w-xs flex-col items-center gap-1">
        <label className="w-full text-center text-xs font-medium" style={{ color: "var(--text-muted)" }}>
          作業対象のタスク
        </label>
        <select
          value={activeTaskId ?? ""}
          onChange={(e) => setActiveTaskId(e.target.value || null)}
          className="w-full rounded-lg border px-3 py-1.5 text-center text-sm"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
        >
          <option value="">選択なし</option>
          {activeTask && activeTask.completed && (
            <option value={activeTask.id}>{activeTask.title}</option>
          )}
          {selectableTasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        {activeTask && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            🍅 {activeTask.completedPomodoros}/{activeTask.estimatedPomodoros} 完了
          </p>
        )}
      </div>

      <div className="text-center">
        <p className="text-sm font-medium tracking-wide" style={{ color: "var(--text-muted)" }}>
          サイクル {cyclePosition.current} / {cyclePosition.total}
        </p>
        <h2 className="mt-1 text-2xl font-semibold" style={{ color: phaseColor }}>
          {PHASE_LABEL[phase]}
          {status === "paused" && (
            <span className="ml-2 text-base font-normal" style={{ color: "var(--text-muted)" }}>
              (一時停止中)
            </span>
          )}
        </h2>
      </div>

      <div className="relative flex items-center justify-center" style={{ width: 280, height: 280 }}>
        <svg width={280} height={280} viewBox="0 0 280 280" className="-rotate-90">
          <circle cx={140} cy={140} r={radius} fill="none" stroke="var(--border)" strokeWidth={14} />
          <circle
            cx={140}
            cy={140}
            r={radius}
            fill="none"
            stroke={phaseColor}
            strokeWidth={14}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 0.2s linear" }}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="tabular-nums text-6xl font-bold" style={{ color: "var(--text)" }}>
            {formatMMSS(remainingMs)}
          </span>
          <span className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            {PHASE_LABEL_SHORT[phase]} {Math.round(totalMs / 60000)} 分
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {status === "running" ? (
          <button
            type="button"
            onClick={pause}
            className="rounded-full px-8 py-3 text-base font-semibold shadow-sm transition hover:opacity-90"
            style={{ backgroundColor: "var(--accent)", color: "var(--accent-contrast)" }}
          >
            一時停止
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            className="rounded-full px-8 py-3 text-base font-semibold shadow-sm transition hover:opacity-90"
            style={{ backgroundColor: "var(--accent)", color: "var(--accent-contrast)" }}
          >
            {status === "paused" ? "再開" : "スタート"}
          </button>
        )}
        <button
          type="button"
          onClick={skip}
          className="rounded-full border px-5 py-3 text-sm font-medium transition hover:bg-[var(--surface-raised)]"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          スキップ
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-full border px-5 py-3 text-sm font-medium transition hover:bg-[var(--surface-raised)]"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          リセット
        </button>
      </div>

      <p className="max-w-sm text-center text-xs" style={{ color: "var(--text-muted)" }}>
        タイマーはタブがバックグラウンドでも正確に動作します。時間はいつでも設定画面から自由に変更できます。
        <br />
        キーボード操作: <kbd>Space</kbd> 開始/一時停止・<kbd>S</kbd> スキップ・<kbd>R</kbd> リセット
      </p>
    </div>
  );
}
