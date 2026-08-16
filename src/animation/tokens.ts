import type { Spring, ThemeDocument } from "@/lib/engine/types";

function spring(token: Spring) {
  return {
    type: "spring" as const,
    stiffness: token.stiffness,
    damping: token.damping,
    mass: token.mass,
  };
}

export function motionFromTheme(theme: ThemeDocument, reduced: boolean) {
  if (reduced) {
    return {
      peek: { duration: 0.08 },
      expand: { duration: 0.1 },
      collapse: { duration: 0.08 },
      contentIn: { duration: 0.08 },
      contentOut: { duration: 0.06 },
      page: { duration: 0.12 },
      drag: { duration: 0.1 },
    };
  }
  return {
    peek: spring(theme.motion.peek),
    expand: spring(theme.motion.expand),
    collapse: spring(theme.motion.collapse),
    contentIn: {
      duration: theme.motion.contentEnterMs / 1000,
      ease: [0.22, 1, 0.36, 1] as const,
    },
    contentOut: {
      duration: theme.motion.contentExitMs / 1000,
      ease: [0.4, 0, 1, 1] as const,
    },
    page: spring(theme.motion.page),
    drag: spring(theme.motion.drag),
  };
}

export function applyTheme(theme: ThemeDocument) {
  const root = document.documentElement;
  root.style.setProperty("--island-shell", theme.tokens.shell);
  root.style.setProperty("--island-fg", theme.tokens.foreground);
  root.style.setProperty("--island-muted", theme.tokens.muted);
  root.style.setProperty("--island-accent", theme.tokens.accent);
  root.style.setProperty("--island-surface", theme.tokens.surface);
  root.style.setProperty("--island-shadow", theme.tokens.shadow);
  root.style.setProperty("--island-radius", `${theme.tokens.radius}px`);
}
