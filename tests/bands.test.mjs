import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, validateCutoffs, auditGrade, legend, FAMILIES, opStdRating } from "@/lib/bands";

test("defect rate: lower is better, the original 2/5/10% lines are band edges", () => {
  assert.equal(classify("defectRate", 0.005), "worldClass");
  assert.equal(classify("defectRate", 0.02), "strong");
  assert.equal(classify("defectRate", 0.043), "watch");
  assert.equal(classify("defectRate", 0.09), "attention");
  assert.equal(classify("defectRate", 0.12), "escalate");
  assert.equal(classify("defectRate", null), null);
});

test("resolution rate and the Operational Standard: higher is better", () => {
  assert.equal(classify("resolutionRate", 0.99), "worldClass");
  assert.equal(classify("resolutionRate", 0.768), "attention");
  assert.equal(classify("resolutionRate", 0.5), "escalate");
  assert.equal(classify("opStandard", 95), "worldClass");
  assert.equal(classify("opStandard", 92.4), "healthy");
  assert.equal(classify("opStandard", 79), "escalate");
});

test("a company's own cut-offs apply, and must stay in order", () => {
  const own = { defectRate: { worldClass: 0.005, strong: 0.01, healthy: 0.02, watch: 0.03, attention: 0.04 } };
  assert.equal(classify("defectRate", 0.043, own), "escalate");
  assert.equal(validateCutoffs("defectRate", { worldClass: 0.02, strong: 0.01, healthy: 0.03, watch: 0.04, attention: 0.05 }).ok, false);
  assert.equal(validateCutoffs("resolutionRate", { worldClass: 0.9, strong: 0.95, healthy: 0.8, watch: 0.7, attention: 0.6 }).ok, false);
  assert.equal(validateCutoffs("opStandard", { worldClass: 96, strong: 93, healthy: 90, watch: 85, attention: 80 }).ok, true);
  assert.equal(validateCutoffs("defectRate", { worldClass: 2, strong: 3, healthy: 4, watch: 5, attention: 6 }).ok, false);
});

test("every family has six bands in its legend", () => {
  for (const f of FAMILIES) assert.equal(legend(f.key).length, 6);
});

test("audit grades keep their mixed scales: 1–5 in 2024, points from 2025", () => {
  assert.deepEqual([5, 4, 3, 2, 1].map(auditGrade), ["A", "B", "C", "D", "F"]);
  assert.deepEqual([100, 80, 60, 40, 20, 10].map(auditGrade), ["A", "B+", "B", "C", "D", "F"]);
  assert.equal(auditGrade(null), null);
  assert.deepEqual([95, 80, 70, 60, 10].map(opStdRating), [5, 4, 3, 2, 1]);
});
test("plurals", async () => { const { plural } = await import("@/lib/settings"); const a = (await import("node:assert/strict")).default; a.equal(plural("Branch"), "Branches"); a.equal(plural("Agency"), "Agencies"); a.equal(plural("Store"), "Stores"); });
