// Timestamp-based Pomodoro timer engine.
//
// Rather than decrementing a counter once per tick (which drifts and breaks
// when the tab is throttled/backgrounded), the engine stores the epoch-ms
// timestamp a phase is due to end (`phaseEndAtRef`) and derives the
// remaining time from `Date.now()` on every tick. The tick interval (250ms)
// only controls display smoothness, never the countdown math itself.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings, PomodoroSession, SessionType } from "./types";
import { appendSession } from "./storage";

export type TimerPhase = "work" | "shortBreak" | "longBreak";
export type TimerStatus = "idle" | "running" | "paused";

export interface TimerEngineState {
  phase: TimerPhase;
  status: TimerStatus;
  remainingMs: number;
  totalMs: number;
  /** Completed work sessions within the current cycle (resets after a long break). */
  completedWorkSessions: number;
}

export interface TimerEngine extends TimerEngineState {
  start: () => void;
  pause: () => void;
  /** Alias of start() — resumes from the paused remaining time. */
  resume: () => void;
  /** Abandon the current phase early, log it as incomplete, and advance. */
  skip: () => void;
  /** Restart the current phase from its full duration without advancing. */
  reset: () => void;
}

export interface PhaseEndEvent {
  endedPhase: TimerPhase;
  wasCompleted: boolean;
  nextPhase: TimerPhase;
}

function phaseDurationMinutes(phase: TimerPhase, settings: Settings): number {
  switch (phase) {
    case "work":
      return settings.workMinutes;
    case "shortBreak":
      return settings.shortBreakMinutes;
    case "longBreak":
      return settings.longBreakMinutes;
  }
}

function phaseToSessionType(phase: TimerPhase): SessionType {
  return phase;
}

function determineNextPhase(
  phase: TimerPhase,
  completedWorkSessions: number,
  sessionsBeforeLongBreak: number,
  wasCompleted: boolean,
): { phase: TimerPhase; completedWorkSessions: number } {
  const cycleLength = Math.max(1, sessionsBeforeLongBreak);

  if (phase === "work") {
    if (!wasCompleted) {
      // A skipped work session doesn't count toward the long-break cycle.
      return { phase: "shortBreak", completedWorkSessions };
    }
    const count = completedWorkSessions + 1;
    if (count % cycleLength === 0) {
      return { phase: "longBreak", completedWorkSessions: count };
    }
    return { phase: "shortBreak", completedWorkSessions: count };
  }

  // Both break types return to work. A long break (completed or skipped)
  // starts a fresh cycle.
  return {
    phase: "work",
    completedWorkSessions: phase === "longBreak" ? 0 : completedWorkSessions,
  };
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface TimerEngineCallbacks {
  onPhaseEnd?: (event: PhaseEndEvent) => void;
  /** Task the running work phase should be credited to, or null for none. */
  activeTaskId?: string | null;
  /** Fired when a work-type phase ends *naturally* (not skipped) with a task selected. */
  onWorkSessionComplete?: (taskId: string) => void;
}

export function useTimerEngine(settings: Settings, callbacks?: TimerEngineCallbacks): TimerEngine {
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const onPhaseEndRef = useRef(callbacks?.onPhaseEnd);
  onPhaseEndRef.current = callbacks?.onPhaseEnd;

  const activeTaskIdRef = useRef(callbacks?.activeTaskId ?? null);
  activeTaskIdRef.current = callbacks?.activeTaskId ?? null;

  const onWorkSessionCompleteRef = useRef(callbacks?.onWorkSessionComplete);
  onWorkSessionCompleteRef.current = callbacks?.onWorkSessionComplete;

  const [state, setState] = useState<TimerEngineState>(() => {
    const totalMs = phaseDurationMinutes("work", settings) * 60_000;
    return { phase: "work", status: "idle", remainingMs: totalMs, totalMs, completedWorkSessions: 0 };
  });

  const phaseEndAtRef = useRef<number | null>(null);
  const phaseStartedAtRef = useRef<string | null>(null);

  // Keep the displayed duration in sync with Settings edits made while the
  // timer is idle (e.g. user changes work length before starting).
  useEffect(() => {
    setState((prev) => {
      if (prev.status !== "idle") return prev;
      const totalMs = phaseDurationMinutes(prev.phase, settings) * 60_000;
      if (totalMs === prev.totalMs) return prev;
      return { ...prev, totalMs, remainingMs: totalMs };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.workMinutes, settings.shortBreakMinutes, settings.longBreakMinutes]);

  const finishPhase = useCallback((wasCompleted: boolean) => {
    setState((prev) => {
      const now = Date.now();
      const startedAt = phaseStartedAtRef.current ?? new Date(now - (prev.totalMs - prev.remainingMs)).toISOString();

      // Only work sessions get tagged with the active task — breaks aren't
      // "work done on" anything.
      const taskId = prev.phase === "work" ? activeTaskIdRef.current : null;

      const session: PomodoroSession = {
        id: makeId(),
        taskId,
        type: phaseToSessionType(prev.phase),
        startedAt,
        endedAt: new Date(now).toISOString(),
        durationMinutes: phaseDurationMinutes(prev.phase, settingsRef.current),
        completed: wasCompleted,
      };
      appendSession(session);

      // A pomodoro only "counts" toward a task's progress if the work phase
      // ran to completion (skipped sessions don't increment it).
      if (prev.phase === "work" && wasCompleted && taskId) {
        onWorkSessionCompleteRef.current?.(taskId);
      }

      const { phase: newPhase, completedWorkSessions } = determineNextPhase(
        prev.phase,
        prev.completedWorkSessions,
        settingsRef.current.sessionsBeforeLongBreak,
        wasCompleted,
      );

      const totalMs = phaseDurationMinutes(newPhase, settingsRef.current) * 60_000;
      const shouldAutoStart =
        newPhase === "work" ? settingsRef.current.autoStartWork : settingsRef.current.autoStartBreaks;

      phaseStartedAtRef.current = shouldAutoStart ? new Date().toISOString() : null;
      phaseEndAtRef.current = shouldAutoStart ? Date.now() + totalMs : null;

      onPhaseEndRef.current?.({ endedPhase: prev.phase, wasCompleted, nextPhase: newPhase });

      return {
        phase: newPhase,
        status: shouldAutoStart ? "running" : "idle",
        remainingMs: totalMs,
        totalMs,
        completedWorkSessions,
      };
    });
  }, []);

  // Tick loop: only runs while a phase is actively counting down.
  useEffect(() => {
    if (state.status !== "running") return;
    const interval = setInterval(() => {
      const endAt = phaseEndAtRef.current;
      if (endAt == null) return;
      const remaining = endAt - Date.now();
      if (remaining <= 0) {
        finishPhase(true);
      } else {
        setState((prev) => (prev.status === "running" ? { ...prev, remainingMs: remaining } : prev));
      }
    }, 250);
    return () => clearInterval(interval);
  }, [state.status, finishPhase]);

  const start = useCallback(() => {
    setState((prev) => {
      if (prev.status === "running") return prev;
      const remaining = prev.status === "paused" ? prev.remainingMs : prev.totalMs;
      phaseEndAtRef.current = Date.now() + remaining;
      if (prev.status !== "paused") {
        phaseStartedAtRef.current = new Date().toISOString();
      }
      return { ...prev, status: "running", remainingMs: remaining };
    });
  }, []);

  const pause = useCallback(() => {
    setState((prev) => {
      if (prev.status !== "running") return prev;
      const endAt = phaseEndAtRef.current;
      const remaining = endAt != null ? Math.max(0, endAt - Date.now()) : prev.remainingMs;
      phaseEndAtRef.current = null;
      return { ...prev, status: "paused", remainingMs: remaining };
    });
  }, []);

  const skip = useCallback(() => {
    finishPhase(false);
  }, [finishPhase]);

  const reset = useCallback(() => {
    setState((prev) => {
      phaseEndAtRef.current = null;
      phaseStartedAtRef.current = null;
      const totalMs = phaseDurationMinutes(prev.phase, settingsRef.current) * 60_000;
      return { ...prev, status: "idle", remainingMs: totalMs, totalMs };
    });
  }, []);

  return { ...state, start, pause, resume: start, skip, reset };
}
