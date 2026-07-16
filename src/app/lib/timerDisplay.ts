// Small presentation helpers shared between PomofreeApp.tsx (which owns the
// timer engine so it survives tab switches — see the hoisting note in
// PomofreeApp.tsx) and TimerView.tsx (which only renders it). Kept in one
// place so the document-title effect (root) and the on-screen phase label
// (TimerView) never drift out of sync with each other.

import type { PhaseEndEvent, TimerPhase } from "./timer";

export const PHASE_LABEL: Record<TimerPhase, string> = {
  work: "作業中",
  shortBreak: "短い休憩",
  longBreak: "長い休憩",
};

export function formatMMSS(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function notificationCopy(event: PhaseEndEvent): { title: string; body: string } {
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
