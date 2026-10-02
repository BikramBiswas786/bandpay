const { decide } = require("./decide");
const { ethCall } = require("./feeds");

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
  };
}

function amountLabel(plan) {
  if (plan.hbar) return `${(Number(plan.amount) / 1e8).toFixed(4)} HBAR`;
  return `${plan.amount} tokens`;
}

/** What release would do if Hedera sent it at `now`. */
function explain(plan, feeds, now) {
  if (!plan.funded) return { state: "empty", detail: "Nothing is escrowed." };
  if (plan.paid) return { state: "paid", detail: "Already paid." };
  if (plan.cancelled) return { state: "cancelled", detail: "Cancelled. The escrow went back to the payer." };
  if (now < plan.executeAt) return { state: "too-early", detail: "Too early. A schedule that fires before this time reverts, and the escrow stays." };
  const chainlink = feeds.chainlink?.fresh
    ? { price: feeds.chainlink.price, ageSec: feeds.chainlink.ageSec, staleAfterSec: feeds.maxAge }
    : null;
  const supra = feeds.supra?.fresh
    ? { price: feeds.supra.price, ageSec: feeds.supra.ageSec, staleAfterSec: feeds.maxAge }
    : null;
  const decision = decide({ chainlink, supra, minPrice: plan.minPrice, maxPrice: plan.maxPrice });
  if (!decision.ok) return { state: decision.reason, detail: decision.detail };
  return { state: "would-pay", detail: `Would pay from ${decision.source} at ${decision.price.toFixed(6)}.` };
}

function assertSchedulable(plan, dueUnix) {
  if (!plan || !plan.funded || plan.paid || plan.cancelled) {
    throw new Error("Plan is not an open escrow. Do not schedule it.");
  }
  if (dueUnix < plan.executeAt) {
    throw new Error("The schedule expires before executeAt. Hedera would call release too early and the payment would revert.");
  }
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

module.exports = { decodePlan, explain, assertSchedulable, readPlans, amountLabel };
