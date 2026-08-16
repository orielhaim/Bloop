import { column, secondaryText, snapshot, text } from "../../sdk/typescript/ui";

/** TypeScript guest for bloop:abi@1.0.0. Compile with jco/componentize-js to the same WIT world as the Rust SDK. */
export const plugin = {
  initialize() {
    return { ok: true as const };
  },
  onAction(_actionId: string, _payloadJson: string) {
    return { ok: true as const };
  },
  onTimer(timerId: string) {
    if (timerId === "tick") {
      return { ok: true as const };
    }
    return { ok: true as const };
  },
  onEvent(_topic: string, _payloadJson: string) {
    return { ok: true as const };
  },
  onSettingsChanged() {
    return { ok: true as const };
  },
  shutdown() {},
};

export function clockSnapshot(pluginId: string, nowMs: number) {
  const time = new Date(nowMs).toLocaleTimeString();
  return snapshot({
    activityId: "clock",
    pluginId,
    timestampMs: nowMs,
    compact: text(time, "numeric"),
    peek: column([text("Clock", "kicker"), text(time, "title")], 2),
    expanded: column([text("Clock", "kicker"), secondaryText(time)], 6),
  });
}
