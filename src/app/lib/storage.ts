// Framework-agnostic localStorage persistence layer.
//
// Every read/write for app data goes through this module so that phase 2
// can swap in an optional Supabase-backed sync layer behind the same
// function signatures (e.g. making save* async and pushing to a server)
// without touching call sites in components.

import type { Settings, PomodoroSession, Task, Project } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const KEYS = {
  settings: "pomofree:settings",
  sessions: "pomofree:sessions",
  tasks: "pomofree:tasks",
  projects: "pomofree:projects",
  activeTaskId: "pomofree:activeTaskId",
} as const;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readJSON<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
}

function readJSONArray<T>(key: string): T[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeJSON(key: string, value: unknown): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable (private mode, quota, etc.) — fail silently.
  }
}

export function loadSettings(): Settings {
  return readJSON<Settings>(KEYS.settings, DEFAULT_SETTINGS);
}

export function saveSettings(settings: Settings): void {
  writeJSON(KEYS.settings, settings);
}

export function loadSessions(): PomodoroSession[] {
  return readJSONArray<PomodoroSession>(KEYS.sessions);
}

export function saveSessions(sessions: PomodoroSession[]): void {
  writeJSON(KEYS.sessions, sessions);
}

export function appendSession(session: PomodoroSession): void {
  const sessions = loadSessions();
  sessions.push(session);
  saveSessions(sessions);
}

export function loadTasks(): Task[] {
  return readJSONArray<Task>(KEYS.tasks);
}

export function saveTasks(tasks: Task[]): void {
  writeJSON(KEYS.tasks, tasks);
}

export function loadProjects(): Project[] {
  return readJSONArray<Project>(KEYS.projects);
}

export function saveProjects(projects: Project[]): void {
  writeJSON(KEYS.projects, projects);
}

/** The task the running/next timer session should be credited to, or null. */
export function loadActiveTaskId(): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(KEYS.activeTaskId);
  } catch {
    return null;
  }
}

export function saveActiveTaskId(taskId: string | null): void {
  if (!isBrowser()) return;
  try {
    if (taskId == null) {
      window.localStorage.removeItem(KEYS.activeTaskId);
    } else {
      window.localStorage.setItem(KEYS.activeTaskId, taskId);
    }
  } catch {
    // ignore
  }
}

export const STORAGE_KEYS = KEYS;
