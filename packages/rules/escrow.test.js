const { test } = require("node:test");
const assert = require("node:assert/strict");
const { escrowTinybar, weiForTinybar } = require("./escrow");

test("a 5 cent invoice at a 5 cent floor escrows 1 HBAR", () => {
  const tiny = escrowTinybar(5_000_000n, 5_000_000n);
  assert.equal(tiny, 100_000_000n);
  assert.equal(weiForTinybar(tiny), 10n ** 18n);
});

test("the same invoice at a 10 cent price only needs half, so the floor is the escrow", () => {
  const escrow = escrowTinybar(5_000_000n, 5_000_000n);
  const atTenCents = (5_000_000n * 100_000_000n) / 10_000_000n;
  assert.ok(atTenCents < escrow);
});
