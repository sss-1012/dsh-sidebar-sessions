// Manual-order helpers inside lib/client.js, tested by extracting and running
// the real source (no build step, no browser). Run: node test/order.test.mjs
import fs from "node:fs";

const file = new URL("../lib/client.js", import.meta.url);
const src = fs.readFileSync(file, "utf8");
const start = src.indexOf("    function applyManualOrder");
const end = src.indexOf("    function rowHalf");
if (start < 0 || end < 0) throw new Error("helper markers not found in lib/client.js");

const { applyManualOrder, moveTo, anchorAfter } = new Function(
  `${src.slice(start, end)}; return { applyManualOrder, moveTo, anchorAfter };`,
)();

let failed = 0;
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}\n  got ${a}\n  want ${e}`);
  }
};

const base = ["A", "B", "C", "D"];

// A section without a saved order keeps its base (recency) order.
eq("no manual order keeps base order", applyManualOrder(base, undefined), base);
eq("empty manual order keeps base order", applyManualOrder(base, []), base);

// The bug this guards: a drop must survive the next render.
const dropped = moveTo(base, "C", "A", "before");
eq("drop above the anchor inserts before it", dropped, ["C", "A", "B", "D"]);
eq("dropped order renders as dropped", applyManualOrder(base, dropped), ["C", "A", "B", "D"]);

// Dragging DOWN one row must land after it (the old insert-before-only model
// turned that into a silent no-op).
eq("drop below the next row moves down", moveTo(base, "A", "B", "after"), ["B", "A", "C", "D"]);
eq("drop above the next row is a no-op", moveTo(base, "A", "B", "before"), undefined);
eq("drop below the last row appends", moveTo(base, "A", "D", "after"), ["B", "C", "D", "A"]);
eq("drop below the previous row is a no-op", moveTo(base, "B", "A", "after"), undefined);

// Host anchor: insertSessionBefore takes the id that must FOLLOW the moved row.
eq("anchor after middle target", anchorAfter(base, "D", "B"), "C");
eq("anchor after last target appends", anchorAfter(base, "A", "D"), undefined);
eq("anchor ignores the moved row", anchorAfter(["A", "B", "C"], "A", "B"), "C");

// A new session still shows up first; the manual order sits below it.
eq("new session goes on top", applyManualOrder(["N", "A", "B", "C", "D"], dropped), ["N", "C", "A", "B", "D"]);

// Sessions leaving the section (最近 is a 20-item slice) drop out cleanly.
eq("churned member dropped", applyManualOrder(["C", "A", "D"], dropped), ["C", "A", "D"]);
eq("all saved ids gone", applyManualOrder(["X", "Y"], dropped), ["X", "Y"]);

// No-ops keep the list untouched instead of rewriting it.
eq("move onto itself", moveTo(base, "B", "B", "after"), undefined);
eq("move unknown id", moveTo(base, "Z", "A", "after"), undefined);
eq("unknown anchor", moveTo(base, "A", "Z", "after"), undefined);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
