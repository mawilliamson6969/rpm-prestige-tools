/**
 * Validators for the /mb/* routes.
 *
 * The validators are the only synchronous unit of CRUD input handling
 * that doesn't require a database. We test them directly. End-to-end
 * route tests live in a Phase 2 integration suite once we wire up a
 * test database.
 *
 * Run:  cd backend && node --test __tests__/mb-validators.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  vIntId,
  vStringReq,
  vStringOpt,
  vSlug,
  vBoardView,
  vColumnType,
  vSubitemStatus,
  vUpdateType,
  vBool,
  vIntOpt,
  vJson,
  vTimestampOpt,
} from "../lib/mb/validators.js";

test("vIntId accepts positive integers", () => {
  assert.equal(vIntId(7), 7);
  assert.equal(vIntId("42"), 42);
});

test("vIntId rejects garbage", () => {
  for (const bad of ["abc", 0, -1, 1.5, null, undefined, ""]) {
    assert.throws(() => vIntId(bad, "id"), /invalid/i);
  }
});

test("vStringReq trims and enforces max length", () => {
  assert.equal(vStringReq("  hello  ", "name"), "hello");
  assert.throws(() => vStringReq("", "name"), /required/);
  assert.throws(() => vStringReq("x".repeat(1001), "name"), /too long/);
});

test("vStringOpt returns null for blanks", () => {
  assert.equal(vStringOpt(null), null);
  assert.equal(vStringOpt(""), null);
  assert.equal(vStringOpt("  "), null);
  assert.equal(vStringOpt("ok"), "ok");
});

test("vSlug enforces lowercase alphanumeric + hyphens", () => {
  assert.equal(vSlug("Maintenance"), "maintenance");
  assert.equal(vSlug("agent-hub"), "agent-hub");
  for (const bad of ["", "_under", "-leading", "trailing-", "has space", "UPPER?"]) {
    assert.throws(() => vSlug(bad), /slug|required/);
  }
});

test("vBoardView only accepts known views", () => {
  for (const v of ["table", "dashboard", "calendar", "kanban", "workload", "map"]) {
    assert.equal(vBoardView(v, { allowNull: false }), v);
  }
  assert.throws(() => vBoardView("pivot", { allowNull: false }), /invalid/);
  assert.equal(vBoardView(null), null);
});

test("vColumnType matches the enum exactly", () => {
  for (const t of [
    "text",
    "status",
    "priority",
    "date",
    "money",
    "person",
    "tags",
    "number",
    "score",
    "longtext",
    "url",
    "file",
  ]) {
    assert.equal(vColumnType(t), t);
  }
  assert.throws(() => vColumnType("unknown"), /invalid/);
});

test("vSubitemStatus / vUpdateType enforce enums", () => {
  assert.equal(vSubitemStatus("done", { allowNull: false }), "done");
  assert.throws(() => vSubitemStatus("nope", { allowNull: false }), /invalid/);
  assert.equal(vUpdateType("comment", { allowNull: false }), "comment");
  assert.throws(() => vUpdateType("rant", { allowNull: false }), /invalid/);
});

test("vBool coerces strings", () => {
  assert.equal(vBool(true), true);
  assert.equal(vBool("false"), false);
  assert.equal(vBool("true"), true);
  assert.throws(() => vBool("maybe"), /boolean/);
});

test("vIntOpt enforces min/max", () => {
  assert.equal(vIntOpt(5, "n", { min: 0, max: 10 }), 5);
  assert.equal(vIntOpt(null, "n"), null);
  assert.throws(() => vIntOpt(-1, "n", { min: 0 }), />=/);
  assert.throws(() => vIntOpt(11, "n", { max: 10 }), /<=/);
  assert.throws(() => vIntOpt(1.5, "n"), /integer/);
});

test("vJson rejects scalars, accepts objects/arrays", () => {
  assert.deepEqual(vJson({ a: 1 }, "x"), { a: 1 });
  assert.deepEqual(vJson([1, 2], "x"), [1, 2]);
  assert.throws(() => vJson("string", "x"), /JSON/);
  assert.throws(() => vJson(5, "x"), /JSON/);
});

test("vJson with requireObject blocks arrays", () => {
  assert.throws(() => vJson([], "x", { requireObject: true }), /object/);
  assert.deepEqual(vJson({}, "x", { requireObject: true }), {});
});

test("vTimestampOpt normalizes to ISO", () => {
  assert.equal(vTimestampOpt(null), null);
  assert.equal(vTimestampOpt(""), null);
  const out = vTimestampOpt("2026-03-15T10:00:00Z", "due_date");
  assert.ok(/^2026-03-15T10:00:00/.test(out));
  assert.throws(() => vTimestampOpt("not-a-date", "due_date"), /valid timestamp/);
});
