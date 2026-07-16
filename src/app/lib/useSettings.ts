import { useCallback, useEffect, useState } from "react";
import type { Settings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { loadSettings, saveSettings } from "./storage";

/**
 * React hook wrapping storage.ts so any view can read/write Settings
 * reactively. Persists to localStorage on every update and applies the
 * light/dark theme class to <html> whenever the theme (or OS preference,
 * while 'system' is selected) changes.
 */
export function useSettings() {
  // Start from DEFAULT_SETTINGS (not loadSettings()) so the first client
  // render matches the server-rendered markup exactly — PomofreeApp is a
  // client:load island, so its initial render is server-rendered into the
  // static HTML with no access to localStorage. Reading the real stored
  // settings inside the useState initializer would make the client's first
  // render differ from that server output and trigger a React hydration
  // mismatch. Instead we render defaults first (matching the server), then
  // load the real settings in an effect that only runs after hydration.
  //
  // `hydrated` is deliberately useState (not a ref): the persist-effect
  // below needs to see its OLD (false) value during the very same commit
  // that the load-effect fires in — a ref mutation would be visible
  // immediately to every effect in that commit and cause the persist-effect
  // to fire once with the stale `settings` closure (still DEFAULT_SETTINGS)
  // while hydrated already reads true, clobbering real stored settings with
  // defaults. useState defers the new value to the next render, so the
  // persist-effect only ever sees hydrated=true in the same render pass
  // where `settings` has also already been updated to the loaded value.
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    setHydrated(true);
  }, []);

  // Persist whenever settings change, but not before the real settings have
  // been loaded — otherwise this would fire once on mount with the
  // DEFAULT_SETTINGS placeholder and clobber whatever was actually stored.
  useEffect(() => {
    if (!hydrated) return;
    saveSettings(settings);
  }, [settings, hydrated]);

  // Apply the theme to <html class="dark">, tracking OS changes live
  // while 'system' is selected.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const applyTheme = () => {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const isDark = settings.theme === "dark" || (settings.theme === "system" && prefersDark);
      document.documentElement.classList.toggle("dark", isDark);
    };

    applyTheme();

    if (settings.theme !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [settings.theme]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return { settings, updateSettings, setSettings };
}
