const { test } = require("node:test");
const assert = require("node:assert/strict");
const { poolPrice8, poolAgrees } = require("./pool");

test("one HBAR quoted at 0.10 USDC is a 0.10 price", () => {
  const price = poolPrice8(100_000n, 100_000_000n);
  assert.equal(price, 10_000_000n);
  assert.equal(poolAgrees(price, 10_000_000n).ok, true);
});

test("a pool at twice the oracle is refused", () => {
  const gap = poolAgrees(20_000_000n, 10_000_000n);
  assert.equal(gap.ok, false);
  assert.equal(gap.bps, 10000);
});

test("the 2 Oct 2026 mainnet quote was inside the band", () => {
  // 1 HBAR -> 100419 USDC base units, Chainlink 0.10098840. Re-read with npm run check:mainnet.
  const price = poolPrice8(100419n, 100_000_000n);
  const gap = poolAgrees(price, 10098840n);
  assert.equal(gap.bps, 56);
  assert.equal(gap.ok, true);
});
