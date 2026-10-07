// Unit tests for the chat v3 ops module. Run: npm run test:functions
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { itineraryContext, resolveOps } from "./_ops.ts";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DAY1 = id(901);
const DAY2 = id(902);
const days = [
  {
    id: DAY1,
    label: "Day 1",
    city: "Galle",
    activities: [
      {
        id: id(2),
        position: 1,
        time: "11:00",
        title: "Fort walk",
        type: "sight",
        duration: "2h",
      },
      {
        id: id(1),
        position: 0,
        time: "09:00",
        title: "Breakfast",
        type: "food",
        confirmed: true,
      },
      { id: "c-temp", position: 2, time: "14:00", title: "Unsaved thing" },
      { id: id(3), position: 3, time: "16:00", title: "Beach", type: "sight" },
    ],
    wishlist: [{ title: "Gem A" }, { title: "Gone gem", dismissed: true }],
  },
  {
    id: DAY2,
    label: "Day 2",
    city: "Ella",
    activities: [{ id: id(4), position: 0, time: "08:00", title: "Train" }],
  },
];
const ctx = itineraryContext(days);
const act = {
  time: "12:30",
  title: "New Cafe",
  geocode: "New Cafe Galle",
  geocode_end: "x",
  type: "food",
  duration: "1h",
  note: "",
  icon: "☕",
};

Deno.test(
  "context: refs in display order, booked marked, unsaved rows not addressable",
  () => {
    assertEquals(
      ctx.text,
      [
        "D1 · Day 1 · Galle",
        "  D1.1 09:00 Breakfast (food) [booked]",
        "  D1.2 11:00 Fort walk (sight, 2h)",
        "  -- 14:00 Unsaved thing",
        "  D1.3 16:00 Beach (sight)",
        "  Local gems: Gem A",
        "D2 · Day 2 · Ella",
        "  D2.1 08:00 Train",
      ].join("\n"),
    );
    assertEquals(ctx.refs.get("D1.3")?.id, id(3));
  },
);

Deno.test(
  "resolve: ops fold into one action at the first op's position",
  () => {
    const { actions, dropped } = resolveOps(
      [
        { type: "add_todo", text: "x" },
        { type: "remove_activity", ref: "d1.2" },
        { type: "navigate", tab: "map" },
        { type: "insert_activity", day: "D1", after: "D1.1", activity: act },
      ],
      ctx,
    );
    assertEquals(dropped, []);
    assertEquals(
      actions.map((a) => a.type),
      ["add_todo", "activity_ops", "navigate"],
    );
    const ops = actions[1].ops;
    assertEquals(ops[0], { op: "remove", activity_id: id(2) });
    assertEquals(ops[1].op, "insert");
    assertEquals(ops[1].day_id, DAY1);
    assertEquals(ops[1].after_id, id(1));
    // geocode_end is only kept for transit
    assertEquals(ops[1].activity.geocode_end, "");
  },
);

Deno.test(
  "resolve: inserting after a removed item anchors on the one before it",
  () => {
    const { actions } = resolveOps(
      [
        { type: "remove_activity", ref: "D1.2" },
        { type: "insert_activity", day: "D1", after: "D1.2", activity: act },
        { type: "remove_activity", ref: "D1.1" },
        { type: "insert_activity", day: "D1", after: "D1.1", activity: act },
      ],
      ctx,
    );
    const ops = actions[0].ops;
    assertEquals(ops[1].after_id, id(1));
    assertEquals(ops[3].after_id, null); // nothing earlier left: start of day
  },
);

Deno.test(
  "resolve: invalid ops are dropped and counted, valid ones kept",
  () => {
    const { actions, dropped } = resolveOps(
      [
        { type: "remove_activity", ref: "D9.9" },
        { type: "set_time", ref: "D1.3", time: "noon" },
        { type: "insert_activity", day: "D7", after: "", activity: act },
        { type: "insert_activity", day: "D1", after: "D2.1", activity: act },
        { type: "replace_activity", ref: "D1.3", activity: { title: "" } },
        { type: "remove_activity", ref: "D1.3" },
        { type: "remove_activity", ref: "D1.3" },
        { type: "move_activity", ref: "D1.3", day: "D2", after: "" },
      ],
      ctx,
    );
    assertEquals(
      dropped.map((d) => d.reason),
      [
        "unknown_ref",
        "bad_time",
        "unknown_day",
        "bad_anchor",
        "invalid_activity",
        "unknown_ref",
        "unknown_ref",
      ],
    );
    assertEquals(actions[0].ops, [{ op: "remove", activity_id: id(3) }]);
    assertEquals(actions[0].dropped, 7);
  },
);

Deno.test(
  "resolve: a move updates which day the item is on for later anchors",
  () => {
    const { actions, dropped } = resolveOps(
      [
        { type: "move_activity", ref: "D1.3", day: "D2", after: "D2.1" },
        { type: "insert_activity", day: "D2", after: "D1.3", activity: act },
        { type: "insert_activity", day: "D1", after: "D1.3", activity: act },
      ],
      ctx,
    );
    assertEquals(actions[0].ops.length, 2);
    assertEquals(actions[0].ops[1].after_id, id(3));
    assertEquals(
      dropped.map((d) => d.reason),
      ["bad_anchor"],
    );
  },
);

Deno.test(
  "resolve: day can be named by label; no ops → actions untouched",
  () => {
    const r = resolveOps(
      [{ type: "insert_activity", day: "Day 2", after: "", activity: act }],
      ctx,
    );
    assertEquals(r.actions[0].ops[0].day_id, DAY2);
    const plain = [{ type: "suggest", suggestions: [] }];
    assertEquals(resolveOps(plain, ctx).actions, plain);
  },
);

Deno.test("resolve: remove + insert of the same place becomes a move", () => {
  const { actions } = resolveOps(
    [
      { type: "remove_activity", ref: "D1.3" },
      {
        type: "insert_activity",
        day: "D2",
        after: "D2.1",
        activity: { ...act, title: "beach!" },
      },
      { type: "insert_activity", day: "D2", after: "", activity: act },
    ],
    ctx,
  );
  assertEquals(actions[0].ops, [
    { op: "move", activity_id: id(3), day_id: DAY2, after_id: id(4) },
    { op: "set_time", activity_id: id(3), time: "12:30" },
    {
      op: "insert",
      day_id: DAY2,
      after_id: null,
      activity: { ...act, geocode_end: "" },
    },
  ]);
});
