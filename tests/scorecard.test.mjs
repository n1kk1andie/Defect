import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, OPERATIONAL_STANDARD, validateDefinition } from "@/lib/scorecard";

test("the Operational Standard reproduces the Metric Computation worksheet", () => {
  const inputs = { screening: 90, wires: 91, sourceOfFunds: 92, csl: 93, fees: 94, declaration: 95, salesService: 96, acknowledgement: 97, complaints: 80, procurement: 70, queueSla: 99, onboardingSla: 88, auditResolution: 75 };
  const v = evaluate(OPERATIONAL_STANDARD, inputs, 80);
  const mp = Math.round((90 + 91 + 92 + 93 + 94 + 95 + 96 + 97) / 8);
  assert.equal(v.majorProcedure, mp);
  const risk = (88 + 80 + 75) / 3;
  assert.equal(v.riskMetrics, risk);
  assert.equal(v.overall, (80 + 70 + risk + 99 + mp) / 5);
  assert.equal(v.avgCustomerSla, (99 + 88) / 2);
});

test("missing measures are left out of the average, not counted as zero", () => {
  const v = evaluate(OPERATIONAL_STANDARD, { complaints: 90, queueSla: 80 }, null);
  assert.equal(v.overall, 85);
});

test("a definition is validated: computed measures only use earlier ones", () => {
  assert.equal(validateDefinition(OPERATIONAL_STANDARD).ok, true);
  const bad = { ...OPERATIONAL_STANDARD, measures: [{ key: "a", label: "A", kind: "computed", of: ["b"] }, { key: "b", label: "B", kind: "input" }], overall: "a" };
  assert.equal(validateDefinition(bad).ok, false);
});
