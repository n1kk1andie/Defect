import { test } from "node:test";
import assert from "node:assert/strict";
import { record, watchlist, recurringIssues, pmasToDate, heatGrid, ALL } from "@/lib/metrics";

const data = {
  periods: ["2026-01-01", "2026-02-01", "2026-03-01"],
  units: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }],
  areas: [{ id: "x", name: "X" }],
  rows: [
    [0, 0, 0, 10, 100, 2, 2, 2, 0], [1, 0, 0, 10, 100, 4, 4, 3, 1],
    [0, 1, 0, 10, 100, 10, 10, 5, 4], [2, 1, 0, 10, 100, 8, 8, 88, 0],
  ],
  natures: [{ label: "Missing ID", category: "Process" }],
  natureRows: [[0, 1, 0, 0, 3, 1], [1, 1, 0, 0, 2, 2], [2, 1, 0, 0, 1, 1], [0, 0, 0, 0, 1, 0], [2, 0, 0, 0, 1, 0]],
  scorecard: { id: "s", name: "Op", measures: [{ key: "overall", label: "Overall" }], periods: ["2026-01-01", "2026-02-01", "2026-07-01"], rows: [[0, 0, 90], [1, 0, 96], [2, 0, 93]], auditRaw: [null, null, null], target: 90 },
};

test("rates are summed then divided, as the original app did", () => {
  const r = record(data.rows.slice(0, 2));
  assert.equal(r.defectRate, 6 / 200);
  assert.equal(r.resolutionRate, 5 / 6);
  assert.equal(r.recurringRate, 1 / 6);
});

test("a row can't claim more resolved than resolvable (the >100% bug)", () => {
  const r = record([data.rows[3]]);
  assert.equal(r.resolved, 8);
  assert.equal(r.resolutionRate, 1);
});

test("the watchlist puts the worst branch first with its reasons", () => {
  const w = watchlist(data, ALL);
  assert.equal(w[0].name, "Beta");
  assert.ok(w[0].why.includes("high defect rate"));
  assert.ok(w[0].risk > w[1].risk);
});

test("recurring issues need consecutive months at the same unit", () => {
  const r = recurringIssues(data, 3);
  assert.equal(r.length, 1);
  assert.equal(r[0].unitName, "Beta");
  assert.equal(r[0].streak, 3);
  assert.equal(recurringIssues(data, 4).length, 0);
});

test("PMAS to date divides by 6 to June and 12 after", () => {
  const mid = pmasToDate(data.scorecard, 0, "2026-02-01");
  assert.equal(mid.value, (90 + 96) / 6);
  assert.equal(mid.basis, "Mid-year");
  const end = pmasToDate(data.scorecard, 0, "2026-07-01");
  assert.equal(end.value, (90 + 96 + 93) / 12);
});

test("the heat-map has a cell per unit and active month", () => {
  const g = heatGrid(data, ALL, "defectRate");
  assert.deepEqual(g.months, [0, 1, 2]);
  assert.equal(g.units.length, 2);
  assert.equal(g.units[0].cells[2], null);
});
