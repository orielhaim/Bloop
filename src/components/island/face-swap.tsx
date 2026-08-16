import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

const swapEase = [0.22, 1, 0.36, 1] as const;

export function FaceSwap({
  id,
  reduced,
  enabled = true,
  duration,
  children,
}: {
  id: string;
  reduced: boolean;
  enabled?: boolean;
  /** Override the transition length; defaults to 0.5s. */
  duration?: number;
  children: ReactNode;
}) {
  if (!enabled) {
    return children;
  }
  const transition = reduced
    ? { duration: 0 }
    : { duration: duration ?? 0.5, ease: swapEase };
  return (
    <div className="face-swap-stage">
      <AnimatePresence initial={false}>
        <motion.div
          key={id}
          className="face-swap"
          initial={{ y: -22, opacity: 0, filter: "blur(8px)" }}
          animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
          exit={{ y: 26, opacity: 0, filter: "blur(8px)" }}
          transition={transition}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
