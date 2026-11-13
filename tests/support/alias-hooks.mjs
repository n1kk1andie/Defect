// Module resolution hooks for the node test runner, so tests can import the
// app's TypeScript modules as they are: "@/lib/x" maps to <repo>/lib/x, and an
// extensionless relative import finds its .ts/.tsx/index.ts file (what the
// Next.js bundler does). Registered by tests/support/register.mjs.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXTS = [".ts", ".tsx", ".mjs", ".js"];

function findFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const e of EXTS) if (existsSync(base + e)) return base + e;
  for (const e of EXTS) if (existsSync(path.join(base, "index" + e))) return path.join(base, "index" + e);
  return null;
}

// Tests never load the owner institution's real configuration: like a demo
// build (next.config.mjs), its modules resolve to the neutral stand-ins.
const ALIASES = process.env.PQ_REAL_INSTITUTION === "1" ? {} : {
  "@/institution/data": "@/demo-institution/data",
  
  "@/institution": "@/demo-institution",
};

export async function resolve(specifier, context, next) {
  if (ALIASES[specifier]) specifier = ALIASES[specifier];
  if (specifier.startsWith("@/")) {
    const f = findFile(path.join(ROOT, specifier.slice(2)));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const parent = fileURLToPath(context.parentURL);
    if (!parent.includes(`${path.sep}node_modules${path.sep}`)) {
      const f = findFile(path.resolve(path.dirname(parent), specifier));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    // A deep import into a package without an exports map ("next/server") —
    // the bundler adds ".js"; do the same.
    if (err?.code === "ERR_MODULE_NOT_FOUND" && /^[a-z@][^:]*\/[^.]+$/.test(specifier)) {
      return next(specifier + ".js", context);
    }
    throw err;
  }
}

export async function load(url, context, next) {
  if (url.endsWith(".json")) {
    return next(url, { ...context, importAttributes: { ...(context.importAttributes || {}), type: "json" } });
  }
  return next(url, context);
}
