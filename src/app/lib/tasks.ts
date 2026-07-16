// Pure helpers for Task domain logic: recurrence date-rolling and the
// completed -> next-occurrence transform. Kept framework-agnostic (no React)
// so useTasks.ts and any future caller (e.g. a Supabase-backed sync layer)
// can share the exact same rules.

import type { Task, TaskRecurrence } from "./types";
import { makeId } from "./id";

/** Format a Date as a local yyyy-mm-dd string (never UTC — avoids the
 * classic "due date shifts a day depending on timezone" bug). */
export function toLocalISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayLocalISODate(): string {
  return toLocalISODate(new Date());
}

/**
 * Recurrence date-rolling logic.
 *
 * Rolls forward from the task's current due date (or from today, if the
 * recurring task had no due date set) by one period of its frequency:
 *   - daily:   + interval days (default interval 1)
 *   - weekly:  + 7 * interval days
 *   - monthly: + interval months, via Date#setMonth — JS normalizes
 *              overflow (e.g. Jan 31 + 1 month lands on Mar 3, since
 *              February doesn't have 31 days). That's a deliberate
 *              simplification rather than "clamp to last day of month";
 *              it keeps the logic to one Date call and matches how most
 *              calendar apps behave for edge-of-month recurring dates.
 *
 * `recurrence.interval` is optional and, when present, is treated as a
 * period multiplier ("every N days/weeks/months") rather than the
 * day-of-week/day-of-month reading suggested by its doc comment in
 * types.ts — the current UI only exposes frequency, not a specific
 * weekday/monthday, so that richer meaning isn't exercised yet. Defaults
 * to 1 when absent.
 */
export function computeNextDueDate(currentDueDate: string | null, recurrence: TaskRecurrence): string {
  const base = currentDueDate ? new Date(`${currentDueDate}T00:00:00`) : new Date();
  const step = Math.max(1, recurrence.interval ?? 1);

  switch (recurrence.frequency) {
    case "daily":
      base.setDate(base.getDate() + step);
      break;
    case "weekly":
      base.setDate(base.getDate() + 7 * step);
      break;
    case "monthly":
      base.setMonth(base.getMonth() + step);
      break;
    case "none":
    default:
      break;
  }

  return toLocalISODate(base);
}

/**
 * Builds the next occurrence of a recurring task once the current one is
 * marked complete: a fresh id, the rolled-forward due date, completion and
 * subtask-completion state reset, and completedPomodoros reset to 0 (a new
 * cycle's progress starts from zero; the finished occurrence keeps its own
 * completedPomodoros for history/stats purposes).
 */
export function createNextOccurrence(task: Task): Task {
  return {
    ...task,
    id: makeId(),
    dueDate: computeNextDueDate(task.dueDate, task.recurrence),
    completed: false,
    completedAt: null,
    completedPomodoros: 0,
    subtasks: task.subtasks.map((s) => ({ ...s, completed: false })),
    createdAt: new Date().toISOString(),
  };
}

const PRIORITY_WEIGHT: Record<Task["priority"], number> = { high: 0, medium: 1, low: 2 };

/**
 * Default sort for the task list: incomplete tasks first, then by due date
 * (soonest first, tasks with no due date last), then by priority
 * (high > medium > low), then by creation order.
 */
export function compareTasks(a: Task, b: Task): number {
  if (a.completed !== b.completed) return a.completed ? 1 : -1;

  if (a.dueDate !== b.dueDate) {
    if (a.dueDate == null) return 1;
    if (b.dueDate == null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }

  const priorityDiff = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
  if (priorityDiff !== 0) return priorityDiff;

  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
