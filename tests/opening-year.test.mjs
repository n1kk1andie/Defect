// Screens open on the year of the latest data (lib/metrics openingYear), and the
// upload templates' example month is last month: never a fixed year or month.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openingYear } from "@/lib/metrics";
import { exampleMonth } from "@/lib/workbook";

const row = (p) => [p, 0, 0, 10, 100, 2, 2, 2, 0];

test("data ending at a later month makes that month's year current", () => {
  const periods = ["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"];
  assert.equal(openingYear({ periods, rows: [row(0), row(1)] }), "2026");
  assert.equal(openingYear({ periods, rows: [row(0), row(1), row(3)] }), "2027");
});

test("with no data, the grid's last year, else this year", () => {
  assert.equal(openingYear({ periods: ["2025-12-01"], rows: [] }), "2025");
  assert.equal(openingYear({ periods: [], rows: [] }, new Date(Date.UTC(2031, 4, 2))), "2031");
});

test("templates show last month as their example", () => {
  assert.equal(exampleMonth(new Date(Date.UTC(2030, 0, 15))), "2029-12");
});
