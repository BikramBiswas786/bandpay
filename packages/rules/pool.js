/** SaucerSwap USDC quote to an 8-decimal HBAR price. USDC is 6 decimals, WHBAR is 8. */

const DISAGREE_BPS = 300;

function poolPrice8(usdcOut, hbarIn) {
  const out = BigInt(usdcOut);
  const amount = BigInt(hbarIn);
  if (out <= 0n || amount <= 0n) throw new Error("The pool returned no price.");
  return (out * 10n ** 10n) / amount;
}

function poolAgrees(poolPrice, oraclePrice) {
  const pool = BigInt(poolPrice);
  const oracle = BigInt(oraclePrice);
  if (oracle <= 0n) throw new Error("The oracle price is empty.");
  const diff = pool > oracle ? pool - oracle : oracle - pool;
  const bps = Number((diff * 10000n) / oracle);
  return { ok: bps <= DISAGREE_BPS, bps };
}

module.exports = { DISAGREE_BPS, poolPrice8, poolAgrees };
