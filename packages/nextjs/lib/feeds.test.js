const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeChainlink, decodeSupra, ethCall } = require("./feeds");

function words(values) {
  return "0x" + values.map(value => BigInt(value).toString(16).padStart(64, "0")).join("");
}

test("decodes a Chainlink round into an 8-decimal quote", () => {
  const now = 1_790_921_800;
  const quote = decodeChainlink(words([1n, 10_530_923n, now - 10, now - 4, 1n]), now);
  assert.ok(Math.abs(quote.price - 0.10530923) < 1e-10);
  assert.equal(quote.ageSec, 4);
  assert.equal(quote.fresh, true);
});

test("treats a Supra millisecond timestamp as seconds", () => {
  const now = 1_790_921_800;
  const quote = decodeSupra(words([9n, 18n, BigInt(now) * 1000n, 104_445_000_000_000_000n]), now);
  assert.ok(Math.abs(quote.price - 0.104445) < 1e-10);
  assert.equal(quote.ageSec, 0);
  assert.equal(quote.fresh, true);
});

test("a quote older than the max age is not fresh", () => {
  const now = 1_790_921_800;
  const quote = decodeChainlink(words([1n, 10_000_000n, 0, now - 7200, 1n]), now, 3600);
  assert.equal(quote.fresh, false);
});

test("an eth_call is not reused from the Next.js fetch cache", async () => {
  const original = global.fetch;
  let cache;
  global.fetch = async (_url, init) => {
    cache = init.cache;
    return { ok: true, json: async () => ({ result: "0x" + "0".repeat(64) }) };
  };
  try {
    await ethCall("https://example.invalid", "0x0000000000000000000000000000000000000001", "0x61b8ce8c");
  } finally {
    global.fetch = original;
  }
  assert.equal(cache, "no-store");
});
