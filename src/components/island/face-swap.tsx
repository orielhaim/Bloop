import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

const swapEase = [0.22, 1, 0.36, 1] as const;

export function FaceSwap({
  id,
  reduced,
  duration,
  children,
}: {
  id: string;
  reduced: boolean;
  duration?: number;
  children: ReactNode;
}) {
  const transition = reduced
    ? { duration: 0 }
    : { duration: duration ?? 0.32, ease: swapEase };
  return (
    <div className="face-swap-stage">
      <AnimatePresence initial={false} mode="sync">
        <motion.div
          key={id}
          data-island-face={id}
          className="face-swap"
          initial={{ y: -10, opacity: 0, filter: "blur(8px)" }}
          animate={{ y: 0, opacity: 1, filter: "none" }}
          exit={{ y: 10, opacity: 0, filter: "blur(8px)" }}
          transition={transition}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
