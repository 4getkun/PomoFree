// Pure aggregation helpers for StatsView. Kept framework-agnostic (no React,
// no DOM) so they're trivially testable and reusable if a future phase adds
// e.g. a Supabase-backed rollup. Everything here reads from the full,
// unbounded PomodoroSession[] history — there is no cutoff on how far back
// stats go.

import type { PomodoroSession, Project, Task } from "./types";
import { toLocalISODate } from "./tasks";

export interface DailyFocus {
  date: string; // yyyy-mm-dd, local
  minutes: number;
  sessionCount: number;
}

/**
 * "Real" focus time: fully-completed work-type sessions, plus `partial`
 * chunks flushed while a work phase was paused (see useTimerEngine's
 * pause() in timer.ts). Both represent genuinely-elapsed focus time —
 * they're just recorded at different moments, so a session paused and
 * picked up again later (or never) still counts the time already spent.
 * Time left unflushed at the moment of an explicit skip is intentionally
 * still excluded (see the skip note in StatsView).
 */
export function completedWorkSessions(sessions: PomodoroSession[]): PomodoroSession[] {
  return sessions.filter((s) => s.type === "work" && (s.completed || s.partial));
}

export function toLocalDateKey(iso: string): string {
  return toLocalISODate(new Date(iso));
}

/** Buckets completed work sessions by local calendar day. */
export function groupMinutesByDay(sessions: PomodoroSession[]): Map<string, DailyFocus> {
  const map = new Map<string, DailyFocus>();
  for (const s of completedWorkSessions(sessions)) {
    const key = toLocalDateKey(s.endedAt);
    const existing = map.get(key);
    if (existing) {
      existing.minutes += s.durationMinutes;
      existing.sessionCount += 1;
    } else {
      map.set(key, { date: key, minutes: s.durationMinutes, sessionCount: 1 });
    }
  }
  return map;
}

/** Ascending array of the last `n` local dates, ending today. */
export function lastNDays(n: number, end: Date = new Date()): string[] {
  const out: string[] = [];
  const cursor = new Date(end);
  cursor.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(cursor);
    d.setDate(d.getDate() - i);
    out.push(toLocalISODate(d));
  }
  return out;
}

/** A zero-filled daily series for the last `days` days — no gaps, so a bar
 * chart always shows a continuous axis even on days with no sessions. */
export function buildDailySeries(sessions: PomodoroSession[], days: number): DailyFocus[] {
  const byDay = groupMinutesByDay(sessions);
  return lastNDays(days).map((date) => byDay.get(date) ?? { date, minutes: 0, sessionCount: 0 });
}

export interface WeeklyFocus {
  weekStart: string; // yyyy-mm-dd, Monday
  minutes: number;
  sessionCount: number;
}

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toLocalISODate(d);
}

/** Aggregates a daily series into ISO-ish weeks (Monday start). */
export function aggregateWeekly(daily: DailyFocus[]): WeeklyFocus[] {
  const map = new Map<string, WeeklyFocus>();
  for (const day of daily) {
    const weekStart = mondayOf(day.date);
    const existing = map.get(weekStart);
    if (existing) {
      existing.minutes += day.minutes;
      existing.sessionCount += day.sessionCount;
    } else {
      map.set(weekStart, { weekStart, minutes: day.minutes, sessionCount: day.sessionCount });
    }
  }
  return Array.from(map.values()).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
}

export interface MonthlyFocus {
  month: string; // yyyy-mm
  minutes: number;
  sessionCount: number;
}

/** Aggregates a daily series into calendar months. */
export function aggregateMonthly(daily: DailyFocus[]): MonthlyFocus[] {
  const map = new Map<string, MonthlyFocus>();
  for (const day of daily) {
    const month = day.date.slice(0, 7);
    const existing = map.get(month);
    if (existing) {
      existing.minutes += day.minutes;
      existing.sessionCount += day.sessionCount;
    } else {
      map.set(month, { month, minutes: day.minutes, sessionCount: day.sessionCount });
    }
  }
  return Array.from(map.values()).sort((a, b) => (a.month < b.month ? -1 : 1));
}

export interface StreakInfo {
  current: number;
  longest: number;
}

/**
 * Streak = consecutive local calendar days with at least one completed work
 * session. `current` counts backward from today; if today has no session
 * yet, it falls back to yesterday (a "grace day" so the streak doesn't look
 * broken mid-day before the user has had a chance to start a session) —
 * if yesterday is also empty, the streak is 0.
 */
export function computeStreaks(sessions: PomodoroSession[]): StreakInfo {
  const activeDays = new Set(completedWorkSessions(sessions).map((s) => toLocalDateKey(s.endedAt)));
  if (activeDays.size === 0) return { current: 0, longest: 0 };

  const sortedDays = Array.from(activeDays).sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedDays.length; i++) {
    const prev = new Date(`${sortedDays[i - 1]}T00:00:00`);
    const cur = new Date(`${sortedDays[i]}T00:00:00`);
    const diffDays = Math.round((cur.getTime() - prev.getTime()) / 86_400_000);
    run = diffDays === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!activeDays.has(toLocalISODate(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!activeDays.has(toLocalISODate(cursor))) {
      return { current: 0, longest };
    }
  }
  let current = 0;
  while (activeDays.has(toLocalISODate(cursor))) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { current, longest };
}

export interface HeatmapCell {
  date: string;
  minutes: number;
  weekday: number; // 0 (Sun) - 6 (Sat)
}

/** Builds a GitHub-style grid: `weeks` columns of 7 rows (Sun-Sat), ending
 * on the current week. Cells outside the actual date range are omitted. */
export function buildHeatmapWeeks(sessions: PomodoroSession[], weeks = 20): HeatmapCell[][] {
  const byDay = groupMinutesByDay(sessions);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const totalDays = weeks * 7;
  // Align the grid so the last column ends on the current week's Saturday.
  const endOfWeek = new Date(today);
  endOfWeek.setDate(endOfWeek.getDate() + (6 - endOfWeek.getDay()));
  const start = new Date(endOfWeek);
  start.setDate(start.getDate() - (totalDays - 1));

  const columns: HeatmapCell[][] = [];
  let cursor = new Date(start);
  for (let w = 0; w < weeks; w++) {
    const column: HeatmapCell[] = [];
    for (let d = 0; d < 7; d++) {
      const key = toLocalISODate(cursor);
      const entry = byDay.get(key);
      column.push({ date: key, minutes: entry?.minutes ?? 0, weekday: cursor.getDay() });
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
    }
    columns.push(column);
  }
  return columns;
}

export interface ProjectBreakdownEntry {
  projectId: string | null;
  name: string;
  color: string;
  minutes: number;
  sessionCount: number;
}

const NO_PROJECT_COLOR = "var(--text-muted)";

/** Focus-time totals grouped by the project of each session's task (a
 * session with no task, or a task with no project, falls into "No project"). */
export function breakdownByProject(sessions: PomodoroSession[], tasks: Task[], projects: Project[]): ProjectBreakdownEntry[] {
  const taskToProject = new Map(tasks.map((t) => [t.id, t.projectId]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const totals = new Map<string, { minutes: number; sessionCount: number }>();
  for (const s of completedWorkSessions(sessions)) {
    const projectId = (s.taskId && taskToProject.get(s.taskId)) || null;
    const key = projectId ?? "__none__";
    const existing = totals.get(key);
    if (existing) {
      existing.minutes += s.durationMinutes;
      existing.sessionCount += 1;
    } else {
      totals.set(key, { minutes: s.durationMinutes, sessionCount: 1 });
    }
  }

  const entries: ProjectBreakdownEntry[] = [];
  for (const [key, totalsEntry] of totals.entries()) {
    if (key === "__none__") {
      entries.push({ projectId: null, name: "プロジェクトなし", color: NO_PROJECT_COLOR, ...totalsEntry });
    } else {
      const project = projectById.get(key);
      entries.push({
        projectId: key,
        name: project?.name ?? "削除済みプロジェクト",
        color: project?.color ?? NO_PROJECT_COLOR,
        ...totalsEntry,
      });
    }
  }
  return entries.sort((a, b) => b.minutes - a.minutes);
}

export interface SummaryStats {
  totalFocusMinutes: number;
  totalCompletedSessions: number;
  totalWorkSessions: number;
  skippedWorkSessions: number;
  completionRate: number; // 0-1
}

export function computeSummary(sessions: PomodoroSession[]): SummaryStats {
  // Completed-session/skip counts and the completion rate are about real
  // phase ATTEMPTS, so `partial` pause-flush chunks (see
  // completedWorkSessions() above) are deliberately excluded here — a work
  // phase paused three times before finishing is still exactly one
  // attempt, not four.
  const workSessions = sessions.filter((s) => s.type === "work" && !s.partial);
  const completed = workSessions.filter((s) => s.completed);
  // totalFocusMinutes, on the other hand, should reflect every second
  // actually spent focused — including partial chunks — so it uses the
  // broader completedWorkSessions() set.
  const totalFocusMinutes = completedWorkSessions(sessions).reduce((sum, s) => sum + s.durationMinutes, 0);
  return {
    totalFocusMinutes,
    totalCompletedSessions: completed.length,
    totalWorkSessions: workSessions.length,
    skippedWorkSessions: workSessions.length - completed.length,
    completionRate: workSessions.length > 0 ? completed.length / workSessions.length : 0,
  };
}
