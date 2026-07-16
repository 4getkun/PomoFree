// Data export helpers. Several competing Pomodoro apps paywall exporting
// your own session history — Pomofree doesn't, so this is deliberately
// dependency-free (no CSV/zip library) and just builds strings by hand.

import { loadProjects, loadSessions, loadSettings, loadTasks } from "./storage";
import type { Project, Task } from "./types";

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function triggerDownload(filename: string, mimeType: string, content: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on a delay so the click has time to start the download in every
  // browser (revoking immediately can cancel it in some engines).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Full JSON backup of everything Pomofree stores locally — settings, tasks,
 * projects, and the complete session history. Re-importable in spirit (not
 * wired to an import UI yet), and useful as a manual backup or for moving
 * data outside the app entirely. */
export function exportAllAsJSON(): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "Pomofree",
    version: 1,
    settings: loadSettings(),
    tasks: loadTasks(),
    projects: loadProjects(),
    sessions: loadSessions(),
  };
  triggerDownload(`pomofree-backup-${todayStamp()}.json`, "application/json", JSON.stringify(payload, null, 2));
}

function csvEscape(value: string | number | boolean | null): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const SESSION_TYPE_LABEL: Record<string, string> = {
  work: "作業",
  shortBreak: "短い休憩",
  longBreak: "長い休憩",
};

/** Session history as CSV, with task/project names resolved (not just ids)
 * so the file is useful on its own in a spreadsheet. */
export function exportSessionsAsCSV(): void {
  const sessions = loadSessions();
  const tasks = loadTasks();
  const projects = loadProjects();
  const taskById = new Map<string, Task>(tasks.map((t) => [t.id, t]));
  const projectById = new Map<string, Project>(projects.map((p) => [p.id, p]));

  const header = ["開始日時", "終了日時", "種別", "完了", "長さ(分)", "タスク", "プロジェクト"];
  const rows = sessions.map((s) => {
    const task = s.taskId ? taskById.get(s.taskId) : undefined;
    const project = task?.projectId ? projectById.get(task.projectId) : undefined;
    return [
      s.startedAt,
      s.endedAt,
      SESSION_TYPE_LABEL[s.type] ?? s.type,
      s.completed ? "完了" : "スキップ",
      s.durationMinutes,
      task?.title ?? "",
      project?.name ?? "",
    ];
  });

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  // Prepend a UTF-8 BOM so Excel (including Japanese-locale Excel) opens the
  // file with correct encoding instead of mangling non-ASCII text.
  triggerDownload(`pomofree-sessions-${todayStamp()}.csv`, "text/csv;charset=utf-8", "﻿" + csv);
}
