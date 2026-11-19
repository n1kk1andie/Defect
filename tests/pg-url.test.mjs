// The Postgres connection string's TLS policy (lib/db/pg-url.ts): any remote
// host gets sslmode=verify-full, whatever the string said; a local one is
// left alone. Checked against node-postgres's own parser, so the result is
// what the pool really does: verify the certificate, and no deprecation warning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { strictPgUrl, isLocalPgHost } from "../lib/db/pg-url.ts";

const require = createRequire(import.meta.url);
const { parse } = createRequire(require.resolve("pg"))("pg-connection-string");
const params = (u) => Object.fromEntries(new URL(u).searchParams);
const REMOTE = "postgresql://app:pw@ep-example-123456.eu-central-1.aws.example.net/appdb";

test("a remote host gets sslmode=verify-full, replacing whatever mode it had", () => {
  for (const q of ["", "?sslmode=require", "?sslmode=prefer", "?sslmode=verify-ca", "?sslmode=disable", "?sslmode=no-verify",
    "?sslmode=require&uselibpqcompat=true", "?ssl=true", "?ssl=0&sslmode=allow", "?sslmode=verify-full"]) {
    const out = strictPgUrl(REMOTE + q);
    assert.equal(params(out).sslmode, "verify-full", q);
    assert.equal(new URL(out).searchParams.getAll("sslmode").length, 1, q);
    assert.ok(!("uselibpqcompat" in params(out)) && !("ssl" in params(out)), q);
  }
});

test("everything else in the string is kept: credentials, host, port, database and other parameters", () => {
  const out = strictPgUrl("postgres://us%40er:p%2Fw%3Fd@db.example.net:6543/my_db?sslmode=require&channel_binding=require&application_name=app");
  const u = new URL(out);
  assert.equal(u.protocol, "postgres:");
  assert.equal(decodeURIComponent(u.username), "us@er");
  assert.equal(decodeURIComponent(u.password), "p/w?d");
  assert.equal(u.host, "db.example.net:6543");
  assert.equal(u.pathname, "/my_db");
  assert.deepEqual(params(out), { channel_binding: "require", application_name: "app", sslmode: "verify-full" });
});

test("a local database is left exactly as written", () => {
  for (const u of ["postgres://me@localhost/dev", "postgres://me@localhost:5433/dev?sslmode=disable", "postgresql://me@127.0.0.1/dev",
    "postgres://me@[::1]:5432/dev", "postgres://me@db.localhost/dev", "postgres:///dev?host=/var/run/postgresql"]) {
    assert.equal(strictPgUrl(u), u);
  }
  assert.ok(isLocalPgHost("LOCALHOST") && isLocalPgHost("127.0.0.2") && isLocalPgHost("/tmp"));
  assert.ok(!isLocalPgHost("localhost.example.com") && !isLocalPgHost("127.0.0.1.example.com") && !isLocalPgHost("10.0.0.5"));
  // A remote socket-style host parameter is still remote.
  assert.equal(params(strictPgUrl("postgres://me@localhost/dev?host=db.example.net")).sslmode, "verify-full");
});

test("something that is not a postgres URL is passed through untouched", () => {
  for (const u of ["", "not a url", "mysql://x@db.example.net/y"]) assert.equal(strictPgUrl(u), u);
});

test("node-postgres reads the result as a verified TLS connection, without the sslmode warning", () => {
  const warnings = [];
  const onWarn = (w) => warnings.push(String(w?.message ?? w));
  process.on("warning", onWarn);
  const orig = process.emitWarning;
  process.emitWarning = (w) => warnings.push(String(w?.message ?? w));
  try {
    for (const q of ["?sslmode=require", "?sslmode=no-verify", "?sslmode=require&uselibpqcompat=true", "?sslmode=disable"]) {
      const cfg = parse(strictPgUrl(REMOTE + q));
      assert.equal(typeof cfg.ssl, "object", q);
      assert.notEqual(cfg.ssl.rejectUnauthorized, false, q);
      assert.equal(cfg.ssl.checkServerIdentity, undefined, q);
    }
  } finally {
    process.emitWarning = orig;
    process.off("warning", onWarn);
  }
  assert.deepEqual(warnings.filter((w) => /sslmode|SSL modes/i.test(w)), []);
});
