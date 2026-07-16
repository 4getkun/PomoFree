// Tiny shared id generator. Mirrors the fallback logic in timer.ts's local
// makeId() but lives here so the new tasks/projects hooks don't duplicate it.
export function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
