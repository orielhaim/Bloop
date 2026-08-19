"use client";

import { useMemo, useState } from "react";
import { computeBudget } from "@/composition/budget";
import { type SolveOutput, solve } from "@/composition/engine";
import {
  type ActivitySemantics,
  type CompositionMemory,
  emptyMemory,
} from "@/composition/types";
import { cn } from "@/lib/utils";

/**
 * Internal development tool: inject arbitrary semantic Activities and inspect
 * how the composition engine reacts. Faster than launching real apps.
 */

type Scenario = {
  name: string;
  activities: () => ActivitySemantics[];
};

const NOW = Date.now();

const base = (
  id: string,
  pluginId: string,
  over: Partial<ActivitySemantics> = {},
): ActivitySemantics => ({
  activityId: id,
  pluginId,
  lifecycle: "ongoing",
  importance: 0.5,
  urgency: 0.3,
  freshnessMs: null,
  urgencyWindowMs: null,
  persistence: 0.5,
  interruptible: true,
  takeoverSuitable: false,
  deadlineMs: null,
  lifetimeMs: null,
  timestampMs: NOW,
  variants: [
    {
      density: "micro",
      minWidth: 22,
      preferredWidth: 22,
      maxWidth: null,
      utility: 0.25,
      coexist: true,
      minReadableMs: null,
    },
    {
      density: "small",
      minWidth: 40,
      preferredWidth: 48,
      maxWidth: null,
      utility: 0.45,
      coexist: true,
      minReadableMs: null,
    },
    {
      density: "compact",
      minWidth: 80,
      preferredWidth: 96,
      maxWidth: 120,
      utility: 0.8,
      coexist: true,
      minReadableMs: null,
    },
    {
      density: "richCompact",
      minWidth: 160,
      preferredWidth: 200,
      maxWidth: 240,
      utility: 1,
      coexist: false,
      minReadableMs: null,
    },
  ],
  ...over,
});

const timer = (remainingMin: number, urgency = 0.35) =>
  base("timer", "bloop.activity.timer", {
    lifecycle: "countdown",
    importance: 0.7,
    urgency,
    urgencyWindowMs: 5 * 60 * 1000,
    persistence: 0.9,
    interruptible: false,
    deadlineMs: NOW + remainingMin * 60 * 1000,
  });

const playing = base("now-playing", "bloop.activity.now-playing", {
  importance: 0.6,
  urgency: 0.35,
  persistence: 0.85,
});

const volumeTransient = base("volume", "bloop.activity.volume", {
  lifecycle: "momentary",
  importance: 0.7,
  urgency: 0.9,
  freshnessMs: 1500,
  takeoverSuitable: true,
  variants: [
    {
      density: "richCompact",
      minWidth: 160,
      preferredWidth: 200,
      maxWidth: 240,
      utility: 1,
      coexist: false,
      minReadableMs: null,
    },
  ],
});

const volumeExpired = {
  ...volumeTransient,
  timestampMs: NOW - 4000,
  freshnessMs: 1000,
} as ActivitySemantics;

const bluetoothTransient = base("bluetooth", "bloop.activity.bluetooth", {
  lifecycle: "momentary",
  importance: 0.55,
  urgency: 0.7,
  freshnessMs: 1800,
  takeoverSuitable: true,
  variants: [
    {
      density: "compact",
      minWidth: 120,
      preferredWidth: 160,
      maxWidth: 180,
      utility: 0.85,
      coexist: false,
      minReadableMs: null,
    },
  ],
});

const focus = base("focus", "bloop.activity.focus", {
  importance: 0.5,
  urgency: 0.4,
  persistence: 0.7,
});

const lowValue = (index: number) =>
  base(`low-${index}`, `bloop.activity.misc${index}`, {
    importance: 0.35,
    urgency: 0.25,
    persistence: 0.4,
  });

const scenarios: Scenario[] = [
  { name: "Clock only", activities: () => [] },
  { name: "Now Playing only", activities: () => [playing] },
  { name: "Timer only (90m)", activities: () => [timer(90)] },
  { name: "Timer + Now Playing", activities: () => [timer(18), playing] },
  {
    name: "Timer + Now Playing + Focus",
    activities: () => [timer(18), playing, focus],
  },
  {
    name: "Timer + Now Playing + low values",
    activities: () => [
      timer(18),
      playing,
      lowValue(0),
      lowValue(1),
      lowValue(2),
    ],
  },
  {
    name: "Volume transient over Timer",
    activities: () => [timer(18), volumeTransient],
  },
  {
    name: "Volume transient over Timer + Now Playing",
    activities: () => [timer(18), playing, volumeTransient],
  },
  {
    name: "Bluetooth event during Volume",
    activities: () => [timer(18), volumeTransient, bluetoothTransient],
  },
  { name: "Timer urgent (30s)", activities: () => [timer(0.5, 0.35)] },
  { name: "Timer completed", activities: () => [timer(0, 1)] },
  {
    name: "Volume expired, resident intact",
    activities: () => [timer(18), playing, volumeExpired],
  },
  {
    name: "Five residents, overflow",
    activities: () => [timer(18), playing, focus, lowValue(0), lowValue(1)],
  },
];

function scenarioResult(
  scenario: Scenario,
  preference: "auto" | "minimal" | "rich",
  budgetMax: number,
  memory: CompositionMemory,
): SolveOutput {
  const budget = computeBudget({ windowWidth: 560, dpr: 1, preference });
  budget.maxWidth = budgetMax;
  return solve({
    activities: scenario.activities(),
    budget,
    now: Date.now(),
    memory,
  });
}

export function CompositionLab() {
  const [active, setActive] = useState(0);
  const [preference, setPreference] = useState<"auto" | "minimal" | "rich">(
    "auto",
  );
  const [budgetMax, setBudgetMax] = useState(360);
  const [memory, setMemory] = useState<CompositionMemory>(() => emptyMemory());
  const [replay, setReplay] = useState(0);

  const result = useMemo(
    () =>
      scenarioResult(
        scenarios[active] ?? scenarios[0],
        preference,
        budgetMax,
        memory,
      ),
    [active, budgetMax, memory, preference, replay],
  );

  const scenario = scenarios[active] ?? scenarios[0];
  const { composition, diagnostics } = result;

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 bg-[#0b0b0d] p-8 text-zinc-100">
      <header>
        <h1 className="font-heading text-2xl tracking-tight">
          Composition Lab
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Inject arbitrary semantic Activities and inspect the solver&apos;s
          decisions. Development diagnostics only.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {scenarios.map((item, index) => (
          <button
            key={item.name}
            type="button"
            onClick={() => setActive(index)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs ring-1 transition-colors",
              active === index
                ? "bg-white/10 ring-white/30"
                : "bg-white/3 ring-white/8 hover:bg-white/6",
            )}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400">
        <label className="flex items-center gap-2">
          Preference
          <select
            value={preference}
            onChange={(event) =>
              setPreference(event.target.value as typeof preference)
            }
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1"
          >
            <option value="auto">auto</option>
            <option value="minimal">minimal</option>
            <option value="rich">rich</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Max width {budgetMax}px
          <input
            type="range"
            min={160}
            max={560}
            value={budgetMax}
            onChange={(event) => setBudgetMax(Number(event.target.value))}
            className="accent-foreground"
          />
        </label>
        <button
          type="button"
          className="rounded-lg bg-white/8 px-3 py-1 ring-1 ring-white/10"
          onClick={() => setReplay((value) => value + 1)}
        >
          Re-run
        </button>
        <button
          type="button"
          className="rounded-lg bg-white/8 px-3 py-1 ring-1 ring-white/10"
          onClick={() => setMemory(emptyMemory())}
        >
          Reset memory
        </button>
      </div>

      <div
        className="flex h-24 items-center justify-center rounded-3xl"
        style={{ background: "#0a0a0a", width: `${composition.width}px` }}
      >
        {composition.transient ? (
          <span className="rounded bg-white/10 px-3 py-2 text-sm">
            {scenario.name} (transient)
          </span>
        ) : composition.segments.length ? (
          <div className="flex items-center gap-2">
            {composition.segments.map((segment) => (
              <span
                key={segment.key}
                className="rounded bg-white/10 px-3 py-2 text-sm"
              >
                {segment.activityId}
                {segment.overflow ? ` (+${composition.hidden})` : ""}
                <span className="ml-2 text-xs text-zinc-400">
                  {segment.density}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-sm text-zinc-400">Clock</span>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        Presence: {composition.presence} · Width {composition.width}px · Hidden{" "}
        {composition.hidden}
      </p>

      <div className="overflow-hidden rounded-2xl bg-white/3 ring-1 ring-white/8">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-white/8 text-zinc-500">
            <tr>
              <th className="px-4 py-2">Activity</th>
              <th className="px-2 py-2">Chosen</th>
              <th className="px-2 py-2">Relevance</th>
              <th className="px-2 py-2">Urgency</th>
              <th className="px-2 py-2">Score</th>
              <th className="px-2 py-2">Width cost</th>
              <th className="px-2 py-2">Continuity</th>
              <th className="px-4 py-2">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {diagnostics.map((item) => (
              <tr key={item.activityId}>
                <td className="px-4 py-1.5 font-medium">{item.activityId}</td>
                <td className="px-2 py-1.5">{item.chosen ?? "—"}</td>
                <td className="px-2 py-1.5 tabular-nums">{item.relevance}</td>
                <td className="px-2 py-1.5 tabular-nums">{item.urgencyNow}</td>
                <td className="px-2 py-1.5 tabular-nums">{item.score}</td>
                <td className="px-2 py-1.5 tabular-nums">{item.widthCost}</td>
                <td className="px-2 py-1.5 tabular-nums">{item.continuity}</td>
                <td className="px-4 py-1.5 text-zinc-400">{item.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
