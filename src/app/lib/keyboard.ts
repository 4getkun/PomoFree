// Shared guard for global keyboard-shortcut listeners: never hijack a key
// while the user is typing into a field, or while a modifier is held (so
// browser/OS shortcuts like Cmd+R still work normally).
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  return isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey;
}
