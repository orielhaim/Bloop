import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type SolveInput, solve } from "./engine.ts";
import {
  type ActivitySemantics,
  emptyMemory,
  type SpatialBudget,
} from "./types.ts";

const budget: SpatialBudget = {
  maxWidth: 360,
  baseWidth: 152,
  gap: 6,
  paddingX: 12,
  restingHeight: 36,
  peekHeight: 40,
  presentationHeight: 42,
  preference: "auto",
};

const NOW = 1_700_000_000_000;

function activity(partial: Partial<ActivitySemantics>): ActivitySemantics {
  return {
    activityId: "a",
    pluginId: "p",
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
        density: "compact",
        minWidth: 72,
        preferredWidth: 92,
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
        utility: 1.0,
        coexist: false,
        minReadableMs: null,
      },
    ],
    ...partial,
  };
}

function solveOnce(activities: ActivitySemantics[], mem = emptyMemory()) {
  const input: SolveInput = { activities, budget, now: NOW, memory: mem };
  return solve(input);
}

describe("composition engine", () => {
  it("resting with no activities", () => {
    const { composition } = solveOnce([]);
    assert.equal(composition.presence, "resting");
    assert.equal(composition.faceMode, "idle");
    assert.equal(composition.faceKey, "idle");
    assert.equal(composition.width, budget.baseWidth);
    assert.deepEqual(composition.segments, []);
    assert.equal(composition.transient, null);
  });

  it("clock-like single resident shows its compact variant", () => {
    const { composition } = solveOnce([activity({ activityId: "timer" })]);
    assert.equal(composition.presence, "peek");
    assert.equal(composition.faceMode, "resident");
    assert.equal(composition.faceKey, "resident");
    assert.equal(composition.segments.length, 1);
    assert.equal(composition.segments[0].activityId, "timer");
    assert.equal(composition.segments[0].density, "compact");
  });

  it("resident faceKey stays stable when another activity joins", () => {
    const first = solveOnce([activity({ activityId: "timer" })]);
    const second = solveOnce(
      [
        activity({ activityId: "timer", importance: 0.7, persistence: 0.9 }),
        activity({
          activityId: "now-playing",
          importance: 0.6,
          persistence: 0.85,
        }),
      ],
      first.memory,
    );
    assert.equal(first.composition.faceKey, "resident");
    assert.equal(second.composition.faceKey, "resident");
  });

  it("two residents compose as segments (no fixed slot count)", () => {
    const { composition } = solveOnce([
      activity({
        activityId: "timer",
        importance: 0.7,
        urgency: 0.5,
        persistence: 0.9,
      }),
      activity({
        activityId: "now-playing",
        importance: 0.6,
        urgency: 0.35,
        persistence: 0.85,
      }),
    ]);
    assert.equal(composition.presence, "peek");
    const ids = composition.segments
      .map((segment) => segment.activityId)
      .sort();
    assert.deepEqual(ids, ["now-playing", "timer"]);
  });

  it("volume takeover transient overlays resident composition", () => {
    const { composition } = solveOnce([
      activity({ activityId: "timer", importance: 0.7, persistence: 0.9 }),
      activity({
        activityId: "volume",
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
            utility: 1.0,
            coexist: false,
            minReadableMs: null,
          },
        ],
      }),
    ]);
    assert.equal(composition.presence, "presentation");
    assert.equal(composition.faceMode, "takeover");
    assert.equal(composition.faceKey, "takeover:volume");
    assert.ok(composition.transient);
    assert.equal(composition.transient!.activityId, "volume");
    assert.ok(
      !composition.segments.some((segment) => segment.activityId === "volume"),
      "takeover transient must not appear as a resident segment",
    );
    assert.ok(composition.segments.length >= 1);
    assert.equal(composition.width, 200 + budget.paddingX * 2);
  });

  it("takeover keeps the richest variant while freshness decays", () => {
    const volume = activity({
      activityId: "volume",
      lifecycle: "momentary",
      importance: 0.7,
      urgency: 0.9,
      freshnessMs: 2000,
      takeoverSuitable: true,
      timestampMs: NOW - 1800,
      variants: [
        {
          density: "micro",
          minWidth: 20,
          preferredWidth: 26,
          maxWidth: null,
          utility: 0.35,
          coexist: true,
          minReadableMs: null,
        },
        {
          density: "compact",
          minWidth: 64,
          preferredWidth: 110,
          maxWidth: 160,
          utility: 0.7,
          coexist: true,
          minReadableMs: null,
        },
        {
          density: "richCompact",
          minWidth: 160,
          preferredWidth: 200,
          maxWidth: 240,
          utility: 1.0,
          coexist: false,
          minReadableMs: null,
        },
      ],
    });
    const { composition } = solveOnce([
      activity({
        activityId: "now-playing",
        importance: 0.6,
        persistence: 0.85,
      }),
      volume,
    ]);
    assert.equal(composition.faceMode, "takeover");
    assert.equal(composition.transient?.density, "richCompact");
  });

  it("volume transient without takeover flag stays resident", () => {
    const { composition } = solveOnce([
      activity({
        activityId: "volume",
        lifecycle: "momentary",
        importance: 0.7,
        urgency: 0.9,
        freshnessMs: 1500,
        takeoverSuitable: false,
        variants: [
          {
            density: "richCompact",
            minWidth: 160,
            preferredWidth: 200,
            maxWidth: 240,
            utility: 1.0,
            coexist: false,
            minReadableMs: null,
          },
        ],
      }),
    ]);
    assert.equal(composition.transient, null);
    assert.equal(composition.faceMode, "resident");
    assert.ok(
      composition.segments.some((segment) => segment.activityId === "volume"),
      "non-takeover transient composes as a segment",
    );
  });

  it("takeover transient hides resident until it expires", () => {
    const volume = activity({
      activityId: "volume",
      lifecycle: "momentary",
      importance: 0.7,
      urgency: 0.9,
      freshnessMs: 1000,
      takeoverSuitable: true,
      timestampMs: NOW - 2_000, // expired
      variants: [
        {
          density: "richCompact",
          minWidth: 160,
          preferredWidth: 200,
          maxWidth: 240,
          utility: 1.0,
          coexist: false,
          minReadableMs: null,
        },
      ],
    });
    const { composition } = solveOnce([
      activity({ activityId: "timer" }),
      volume,
    ]);
    assert.equal(composition.transient, null);
    assert.equal(composition.presence, "peek");
    assert.equal(composition.segments.length, 1);
  });

  it("dynamic urgency rises as deadline approaches", () => {
    const far = activity({
      activityId: "timer",
      lifecycle: "countdown",
      urgency: 0.3,
      urgencyWindowMs: 300_000,
      deadlineMs: NOW + 90 * 60 * 1000, // 90 minutes out
    });
    const near = activity({
      ...far,
      deadlineMs: NOW + 30_000, // 30 seconds out
    });
    const farResult = solveOnce([far]);
    const nearResult = solveOnce([near]);
    // Near-deadline timer should be scored higher (urgencyNow closer to 1).
    assert.ok(
      nearResult.composition.segments[0].urgencyNow >
        farResult.composition.segments[0].urgencyNow,
    );
  });

  it("small score changes do not reorder (hysteresis)", () => {
    const timer = activity({
      activityId: "timer",
      importance: 0.7,
      persistence: 0.9,
    });
    const playing = activity({
      activityId: "now-playing",
      importance: 0.6,
      persistence: 0.85,
    });
    const mem = emptyMemory();

    const first = solveOnce([timer, playing], mem);
    const order1 = first.composition.segments.map(
      (segment) => segment.activityId,
    );

    // Slight relevance shift must not reorder.
    const second = solveOnce(
      [
        { ...timer, importance: 0.71 },
        { ...playing, importance: 0.61 },
      ],
      first.memory,
    );
    const order2 = second.composition.segments.map(
      (segment) => segment.activityId,
    );
    assert.deepEqual(order2, order1);
  });

  it("material score change does reorder", () => {
    const timer = activity({
      activityId: "timer",
      importance: 0.7,
      persistence: 0.9,
    });
    const playing = activity({
      activityId: "now-playing",
      importance: 0.6,
      persistence: 0.85,
    });
    const mem = emptyMemory();
    const first = solveOnce([timer, playing], mem);

    // Now-playing becomes far more important; it should lead.
    const second = solveOnce(
      [
        { ...timer, importance: 0.5 },
        { ...playing, importance: 1.0, urgency: 0.95 },
      ],
      first.memory,
    );
    assert.equal(second.composition.segments[0].activityId, "now-playing");
  });

  it("excessive width is discouraged: many wide activities compress", () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      activity({
        activityId: `a${index}`,
        importance: 0.6,
        persistence: 0.7,
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
            density: "richCompact",
            minWidth: 180,
            preferredWidth: 220,
            maxWidth: 240,
            utility: 1.0,
            coexist: false,
            minReadableMs: null,
          },
        ],
      }),
    );
    const { composition } = solveOnce(many);
    const total = composition.segments.reduce(
      (sum, segment) => sum + segment.width,
      0,
    );
    assert.ok(
      total <= budget.maxWidth,
      `composition width ${total} exceeds budget`,
    );
  });

  it("overflow affordance appears when micros cannot all fit", () => {
    const activities = Array.from({ length: 6 }, (_, index) =>
      activity({
        activityId: `a${index}`,
        importance: 0.5,
        persistence: 0.6,
        variants: [
          {
            density: "micro",
            minWidth: 60,
            preferredWidth: 60,
            maxWidth: null,
            utility: 0.25,
            coexist: true,
            minReadableMs: null,
          },
          {
            density: "compact",
            minWidth: 100,
            preferredWidth: 120,
            maxWidth: 140,
            utility: 0.8,
            coexist: true,
            minReadableMs: null,
          },
        ],
      }),
    );
    const { composition } = solveOnce(activities);
    const overflow = composition.segments.find((segment) => segment.overflow);
    assert.ok(overflow, "expected an overflow segment");
  });

  it("interaction recency boosts the involved activity generically", () => {
    const timer = activity({
      activityId: "timer",
      importance: 0.5,
      persistence: 0.5,
    });
    const playing = activity({
      activityId: "now-playing",
      importance: 0.5,
      persistence: 0.5,
    });
    const mem = emptyMemory();
    mem.interacted["timer"] = NOW - 1_000;

    const { composition } = solveOnce([timer, playing], mem);
    // The recently-interacted timer should lead.
    assert.equal(composition.segments[0].activityId, "timer");
  });

  it("minimal preference compresses harder than rich", () => {
    const activities = [
      activity({ activityId: "a0", importance: 0.7, persistence: 0.8 }),
      activity({ activityId: "a1", importance: 0.6, persistence: 0.8 }),
      activity({ activityId: "a2", importance: 0.5, persistence: 0.8 }),
    ];
    const minimal = solveOnce(
      activities.map((a) => ({ ...a, importance: a.importance })),
      emptyMemory(),
    );
    const minimalInput: SolveInput = {
      activities,
      now: NOW,
      memory: emptyMemory(),
      budget: { ...budget, preference: "minimal" },
    };
    const minimalResult = solve(minimalInput);
    const richInput: SolveInput = {
      activities,
      now: NOW,
      memory: emptyMemory(),
      budget: { ...budget, preference: "rich" },
    };
    const richResult = solve(richInput);
    const minimalWidth = minimalResult.composition.width;
    const richWidth = richResult.composition.width;
    void minimal;
    assert.ok(
      richWidth >= minimalWidth,
      `rich (${richWidth}) should show at least as much as minimal (${minimalWidth})`,
    );
  });
});
