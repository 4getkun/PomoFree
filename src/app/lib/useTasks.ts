import { useCallback, useEffect, useState } from "react";
import type { Subtask, Task, TaskPriority, TaskRecurrence } from "./types";
import { loadTasks, saveTasks } from "./storage";
import { makeId } from "./id";
import { createNextOccurrence } from "./tasks";

export interface NewTaskInput {
  title: string;
  projectId: string | null;
  priority: TaskPriority;
  dueDate: string | null;
  notes: string;
  estimatedPomodoros: number;
  recurrence: TaskRecurrence;
}

/**
 * React hook wrapping storage.ts for Task CRUD, following the same
 * load-once / persist-on-change pattern as useSettings.ts, including the
 * same deferred-load-after-mount approach to avoid ever clobbering stored
 * data with a placeholder before the real value has loaded (see the
 * comment in useSettings.ts for why `hydrated` must be useState, not a ref).
 * TasksView (the only place this hook is used) is only ever mounted after
 * hydration already completed, so this isn't fixing an observed bug here —
 * it's defensive consistency with the other storage-backed hooks.
 */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setTasks(loadTasks());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveTasks(tasks);
  }, [tasks, hydrated]);

  const addTask = useCallback((input: NewTaskInput): string => {
    const id = makeId();
    const task: Task = {
      id,
      projectId: input.projectId,
      title: input.title.trim(),
      notes: input.notes.trim(),
      priority: input.priority,
      dueDate: input.dueDate,
      completed: false,
      estimatedPomodoros: Math.max(0, input.estimatedPomodoros),
      completedPomodoros: 0,
      recurrence: input.recurrence,
      subtasks: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    setTasks((prev) => [...prev, task]);
    return id;
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * Toggles completion. When a task with a recurrence other than "none" is
   * being marked *complete*, a new occurrence is appended automatically
   * (see tasks.ts#createNextOccurrence) — the finished task stays in the
   * list (now completed, for history/stats), and a fresh copy with the
   * rolled-forward due date takes over as the live task.
   */
  const toggleComplete = useCallback((id: string) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const task = prev[idx];
      const nowCompleted = !task.completed;
      const updated: Task = { ...task, completed: nowCompleted, completedAt: nowCompleted ? new Date().toISOString() : null };
      const next = [...prev];
      next[idx] = updated;
      if (nowCompleted && task.recurrence.frequency !== "none") {
        next.push(createNextOccurrence(task));
      }
      return next;
    });
  }, []);

  const addSubtask = useCallback((taskId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const subtask: Subtask = { id: makeId(), title: trimmed, completed: false };
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, subtasks: [...t.subtasks, subtask] } : t)));
  }, []);

  const removeSubtask = useCallback((taskId: string, subtaskId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, subtasks: t.subtasks.filter((s) => s.id !== subtaskId) } : t)),
    );
  }, []);

  const toggleSubtask = useCallback((taskId: string, subtaskId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, subtasks: t.subtasks.map((s) => (s.id === subtaskId ? { ...s, completed: !s.completed } : s)) }
          : t,
      ),
    );
  }, []);

  /** Increments completedPomodoros for a task — called when a work-type
   * PomodoroSession finishes naturally with this task selected as active. */
  const incrementCompletedPomodoros = useCallback((taskId: string) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, completedPomodoros: t.completedPomodoros + 1 } : t)));
  }, []);

  /** Clears projectId on any tasks pointing at a deleted project. */
  const clearProjectReferences = useCallback((projectId: string) => {
    setTasks((prev) => prev.map((t) => (t.projectId === projectId ? { ...t, projectId: null } : t)));
  }, []);

  return {
    tasks,
    addTask,
    updateTask,
    deleteTask,
    toggleComplete,
    addSubtask,
    removeSubtask,
    toggleSubtask,
    incrementCompletedPomodoros,
    clearProjectReferences,
  };
}
