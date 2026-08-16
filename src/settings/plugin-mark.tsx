import { CheckIcon } from "lucide-react";
import type { PluginRecord } from "@/lib/engine/types";

export function PluginMark({
  plugin,
  className,
}: {
  plugin: PluginRecord;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center overflow-hidden rounded-2xl bg-zinc-800 ring-1 ring-white/10 ${className ?? "size-14"}`}
    >
      {plugin.iconUrl ? (
        <img src={plugin.iconUrl} alt="" className="size-2/3 object-contain" />
      ) : (
        <CheckIcon className="size-6 text-zinc-500" />
      )}
    </div>
  );
}
