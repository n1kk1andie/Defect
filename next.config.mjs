import { withSecurityHeaders } from "./security-headers.mjs";

// One switch drives the demo: DEMO_MODE=1 on the demo hosting project. It is
// mirrored into the browser build (the Demo chip, DemoGuard) and, at build
// time, swaps the owner's institution (institution/) for neutral stand-ins
// (demo-institution/), so no real name, person or figure can reach a demo.
const DEMO_MODE = (process.env.DEMO_MODE || "").trim().replace(/^["']+|["']+$/g, "") === "1" ? "1" : "";
const institutionAliases = DEMO_MODE
  ? { "@/institution/data": "./demo-institution/data.ts", "@/institution": "./demo-institution/index.ts" }
  : {};

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_DEMO_MODE: DEMO_MODE },
  turbopack: { resolveAlias: institutionAliases },
  // Kept out of the server bundle: native/WASM and CommonJS packages that load cleanly from node_modules.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "exceljs"],
};

export default withSecurityHeaders(nextConfig);
