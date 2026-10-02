import { test } from "node:test";
import assert from "node:assert/strict";
import { receiptMessage } from "./receipt.js";

test("a reverted attempt fits in one HCS message", () => {
  const body = receiptMessage({ planId: 3, result: "reverted", scheduleId: "0.0.10830733" });
  assert.match(body, /reverted/);
  assert.ok(Buffer.byteLength(body) < 1024);
});

test("an unknown result is refused", () => {
  assert.throws(() => receiptMessage({ planId: 1, result: "maybe" }), /result/);
});
