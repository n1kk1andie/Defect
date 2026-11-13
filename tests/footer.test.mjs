// The app footer: the same two lines across the Pulsus Intelligence Suite, in
// the shell and on the sign-in and sign-up frame.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("the footer reads the suite's two lines", () => {
  const brand = read("components/Brand.tsx");
  assert.ok(brand.includes("Pulsus Quality · {FOOTER_SUITE}"));
  assert.ok(brand.includes('"Part of the Pulsus Intelligence Suite"'));
  assert.ok(brand.includes('"A product of Tumblehill Labs, a product studio of Tumblehill Holdings LLC."'));
  for (const f of ["components/Shell.tsx", "components/account/AccountFrame.tsx"]) assert.ok(read(f).includes("<FooterLines"), f);
});

test("the old footer variants are gone", () => {
  const shell = read("components/Shell.tsx");
  assert.doesNotMatch(shell, /fictional sample data\)|© 2026 Tumblehill|Live\. Signal\. Clarity\.<\/span> ·/);
  assert.doesNotMatch(read("components/account/AccountFrame.tsx"), /© 2026 Tumblehill/);
});

test("the demo keeps its fictional-sample-data notice", () => {
  const shell = read("components/Shell.tsx");
  assert.ok(shell.includes("Demo · fictional sample data"));
  assert.ok(shell.includes("Demo · sample data"));
});
