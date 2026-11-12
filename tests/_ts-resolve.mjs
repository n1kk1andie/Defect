// Test-only module hooks: resolve the "@/..." path alias and extensionless .ts
// imports the way the Next build does, and stand in for next/headers (there is
// no request in a unit test, so it reports no cookies and no headers).
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NEXT_HEADERS_STUB = "data:text/javascript," + encodeURIComponent(
  "const empty = { get: () => undefined, has: () => false, getAll: () => [] };" +
  "export function cookies() { return empty; } export function headers() { return empty; }",
);

function tsFile(base) {
  for (const c of [base, base + ".ts", base + ".tsx", base + ".js", path.join(base, "index.ts")]) {
    if (existsSync(c) && !c.endsWith(path.sep) && path.extname(c)) return c;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier === "next/headers") return { url: NEXT_HEADERS_STUB, shortCircuit: true };
  let base = null;
  if (specifier.startsWith("@/")) base = path.join(root, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:") && !path.extname(specifier)) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (base) {
    const f = tsFile(base);
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  return next(specifier, context);
}

// JSON imports (seed data) without `with { type: "json" }`, as the bundler allows.
export async function load(url, context, next) {
  if (url.startsWith("file:") && url.endsWith(".json")) {
    return next(url, { ...context, importAttributes: { ...context.importAttributes, type: "json" } });
  }
  return next(url, context);
}
