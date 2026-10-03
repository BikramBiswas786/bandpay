const { decide } = require("./decide");
const { ethCall } = require("./feeds");
const { poolPrice8, poolAgrees } = require("../../rules/pool");

const ZERO = "0x0000000000000000000000000000000000000000";

function word(data, index) {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  const slice = hex.slice(index * 64, index * 64 + 64);
  if (slice.length !== 64) return null;
  return BigInt("0x" + slice);
}

function addressOf(data, index) {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  const slice = hex.slice(index * 64, index * 64 + 64);
  if (slice.length !== 64) return null;
  return "0x" + slice.slice(24);
}

function decodePlan(data) {
  const amount = word(data, 3);
  const minPrice = word(data, 4);
  const maxPrice = word(data, 5);
  const executeAt = word(data, 6);
  const funded = word(data, 7);
  const paid = word(data, 8);
  const cancelled = word(data, 9);
  const usdWord = word(data, 10);
  if (amount === null || executeAt === null || funded === null) return null;
  const token = addressOf(data, 2);
  return {
    payer: addressOf(data, 0),
    recipient: addressOf(data, 1),
    token,
    hbar: token === ZERO,
    amount: amount.toString(),
    minPrice: Number(minPrice) / 1e8,
    maxPrice: Number(maxPrice) / 1e8,
    executeAt: Number(executeAt),
    funded: funded === 1n,
    paid: paid === 1n,
    cancelled: cancelled === 1n,
    usdAmount: usdWord === null ? 0 : Number(usdWord) / 1e8,
  };
}

function amountLabel(plan) {
  if (plan.hbar) return `${(Number(plan.amount) / 1e8).toFixed(4)} HBAR`;
  return `${plan.amount} tokens`;
}

/** What release would do if Hedera sent it at `now`. `poolPrice` is the 8-decimal SaucerSwap quote, or null when the contract has no router. */
function explain(plan, feeds, now, poolPrice) {
  if (!plan.funded) return { state: "empty", detail: "Nothing is escrowed." };
  if (plan.paid) return { state: "paid", detail: "Already paid." };
  if (plan.cancelled)
    return { state: "cancelled", detail: "Cancelled. The escrow went back to the payer." };
  if (now < plan.executeAt)
    return {
      state: "too-early",
      detail: "Too early. A schedule that fires before this time reverts, and the escrow stays.",
    };
  const chainlink = feeds.chainlink?.fresh
    ? { price: feeds.chainlink.price, ageSec: feeds.chainlink.ageSec, staleAfterSec: feeds.maxAge }
    : null;
  const supra = feeds.supra?.fresh
    ? { price: feeds.supra.price, ageSec: feeds.supra.ageSec, staleAfterSec: feeds.maxAge }
    : null;
  const decision = decide({ chainlink, supra, minPrice: plan.minPrice, maxPrice: plan.maxPrice });
  if (!decision.ok) return { state: decision.reason, detail: decision.detail };
  if (plan.usdAmount > 0) {
    if (poolPrice == null) {
      return {
        state: "band-only",
        detail: `The band passes from ${decision.source} at ${decision.price.toFixed(6)}. A dollar invoice still asks SaucerSwap.`,
      };
    }
    const oracle8 = BigInt(Math.round(decision.price * 1e8));
    const verdict = poolAgrees(poolPrice, oracle8);
    if (!verdict.ok) {
      return {
        state: "pool-off",
        detail: `PoolOff at ${verdict.bps} bps. The band passed from ${decision.source}. The escrow would stay.`,
      };
    }
    return {
      state: "would-pay",
      detail: `Would pay from ${decision.source} at ${decision.price.toFixed(6)}. SaucerSwap is ${verdict.bps} bps away.`,
    };
  }
  return {
    state: "would-pay",
    detail: `Would pay from ${decision.source} at ${decision.price.toFixed(6)}.`,
  };
}

function addressWord(addr) {
  return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/** 8-decimal HBAR price from this contract's SaucerSwap router. Null when it has no router or the call fails. */
async function readPoolPrice(rpc, band) {
  try {
    const router = addressOf(await ethCall(rpc, band, "0xf887ea40"), 0);
    if (!router || router.toLowerCase() === ZERO) return null;
    const whbar = addressOf(await ethCall(rpc, band, "0xa74d5086"), 0);
    const usdc = addressOf(await ethCall(rpc, band, "0x3e413bee"), 0);
    const data =
      "0xd06ca61f" +
      (100_000_000).toString(16).padStart(64, "0") +
      (64).toString(16).padStart(64, "0") +
      (2).toString(16).padStart(64, "0") +
      addressWord(whbar) +
      addressWord(usdc);
    const out = await ethCall(rpc, router, data);
    const usdcOut = word(out, 3);
    if (usdcOut === null || usdcOut === 0n) return null;
    return poolPrice8(usdcOut, 100_000_000n);
  } catch {
    return null;
  }
}

function assertSchedulable(plan, dueUnix) {
  if (!plan || !plan.funded || plan.paid || plan.cancelled) {
    throw new Error("Plan is not an open escrow. Do not schedule it.");
  }
  if (dueUnix < plan.executeAt) {
    throw new Error(
      "The schedule expires before executeAt. Hedera would call release too early and the payment would revert.",
    );
  }
}

/** Price failures Hedera will hit if it calls release while the feeds still look like this. */
const REVERT_IF_SCHEDULED = new Set(["disagree", "no-price", "outside-band", "pool-off"]);

function assertWorthScheduling(explained, allowRevert) {
  if (!explained || !REVERT_IF_SCHEDULED.has(explained.state)) return;
  if (allowRevert) return;
  throw new Error(
    `release would revert right now (${explained.state}: ${explained.detail}). Refusing to sign. Set ALLOW_REVERT=1 to schedule that revert on purpose.`,
  );
}

async function readPlans(rpcUrl, address) {
  const nextHex = await ethCall(rpcUrl, address, "0x61b8ce8c");
  const count = Number(word(nextHex, 0));
  const plans = [];
  for (let id = 0; id < Math.min(count, 8); id++) {
    const data = await ethCall(rpcUrl, address, "0xb1620616" + id.toString(16).padStart(64, "0"));
    const plan = decodePlan(data);
    if (plan) plans.push({ id, ...plan, amountLabel: amountLabel(plan) });
  }
  return plans;
}

module.exports = {
  decodePlan,
  explain,
  readPoolPrice,
  assertSchedulable,
  assertWorthScheduling,
  readPlans,
  amountLabel,
};
