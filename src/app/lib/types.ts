// Shared types for the Pomofree app. Phase 2 (tasks, stats, sync) extends
// this file rather than redefining these shapes elsewhere, so keep them
// complete even where this phase only ships a stub UI.

export type Theme = "light" | "dark" | "system";

export interface Settings {
  /** Focus session length, minutes. Default 25. */
  workMinutes: number;
  /** Short break length, minutes. Default 5. */
  shortBreakMinutes: number;
  /** Long break length, minutes. Default 15. */
  longBreakMinutes: number;
  /** Number of work sessions completed before a long break is taken. Default 4. */
  sessionsBeforeLongBreak: number;
  /** Automatically start the break timer when a work session ends. Default true. */
  autoStartBreaks: boolean;
  /** Automatically start the next work timer when a break ends. Default false. */
  autoStartWork: boolean;
  /** UI theme preference. Default 'system'. */
  theme: Theme;
  /** Accent color (hex) used for the UI. */
  accentColor: string;
  /** Whether browser Notifications should fire on phase completion. Default false. */
  notificationsEnabled: boolean;
  /** Ambient sound to play during focus sessions. null = silent. Wired up in phase 2. */
  soundId: string | null;
  /** Ambient sound volume, 0-1. Default 0.5. */
  soundVolume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 4,
  autoStartBreaks: true,
  autoStartWork: false,
  theme: "system",
  accentColor: "#0f8b7f",
  notificationsEnabled: false,
  soundId: null,
  soundVolume: 0.5,
};

/** Ambient sound catalog. Playback is synthesized procedurally via the Web
 * Audio API in lib/ambientSound.ts — no bundled/external audio files. */
export type AmbientSoundId = "rain" | "forest" | "cafe" | "white-noise" | "waves";

export const AMBIENT_SOUND_OPTIONS: { id: AmbientSoundId; label: string }[] = [
  { id: "rain", label: "雨音 (Rain)" },
  { id: "forest", label: "森 (Forest)" },
  { id: "cafe", label: "カフェ (Cafe)" },
  { id: "white-noise", label: "ホワイトノイズ (White noise)" },
  { id: "waves", label: "波音 (Waves)" },
];

const AMBIENT_SOUND_ID_SET = new Set<string>(AMBIENT_SOUND_OPTIONS.map((o) => o.id));

/** Narrows Settings.soundId (stored as a plain string for forward-compat)
 * to the known AmbientSoundId union. */
export function isAmbientSoundId(id: string | null): id is AmbientSoundId {
  return id != null && AMBIENT_SOUND_ID_SET.has(id);
}

export type TaskPriority = "low" | "medium" | "high";

export type RecurrenceFrequency = "none" | "daily" | "weekly" | "monthly";

export interface TaskRecurrence {
  frequency: RecurrenceFrequency;
  /** Day-of-week (0-6) list for weekly recurrence, or day-of-month for monthly. */
  interval?: number;
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  id: string;
  projectId: string | null;
  title: string;
  notes: string;
  priority: TaskPriority;
  /** ISO date string (yyyy-mm-dd) or null if no due date. */
  dueDate: string | null;
  completed: boolean;
  estimatedPomodoros: number;
  completedPomodoros: number;
  recurrence: TaskRecurrence;
  subtasks: Subtask[];
  /** ISO datetime string. */
  createdAt: string;
  /** ISO datetime string, set when the task is marked complete. */
  completedAt: string | null;
}

export interface Project {
  id: string;
  name: string;
  /** Hex color used for task/project chips. */
  color: string;
  /** ISO datetime string. */
  createdAt: string;
  archived: boolean;
}

export type SessionType = "work" | "shortBreak" | "longBreak";

export interface PomodoroSession {
  id: string;
  taskId: string | null;
  type: SessionType;
  /** ISO datetime string. */
  startedAt: string;
  /** ISO datetime string. */
  endedAt: string;
  durationMinutes: number;
  /** false if the session was skipped/cancelled before its natural end. */
  completed: boolean;
}
