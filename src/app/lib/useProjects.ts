import { useCallback, useEffect, useState } from "react";
import type { Project } from "./types";
import { loadProjects, saveProjects } from "./storage";
import { makeId } from "./id";

/**
 * React hook wrapping storage.ts for Project CRUD. No limit is ever placed
 * on how many projects can be created — several competing Pomodoro apps
 * paywall "unlimited projects", Pomofree deliberately doesn't.
 *
 * Uses the same deferred-load-after-mount pattern as useSettings.ts/
 * useTasks.ts (see useSettings.ts for the full rationale) for defensive
 * consistency, even though TasksView (the only consumer) only ever mounts
 * post-hydration.
 */
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setProjects(loadProjects());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveProjects(projects);
  }, [projects, hydrated]);

  const addProject = useCallback((name: string, color: string): string => {
    const id = makeId();
    const project: Project = { id, name: name.trim(), color, createdAt: new Date().toISOString(), archived: false };
    setProjects((prev) => [...prev, project]);
    return id;
  }, []);

  const updateProject = useCallback((id: string, patch: Partial<Project>) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const setArchived = useCallback((id: string, archived: boolean) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, archived } : p)));
  }, []);

  const deleteProject = useCallback((id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { projects, addProject, updateProject, setArchived, deleteProject };
}
