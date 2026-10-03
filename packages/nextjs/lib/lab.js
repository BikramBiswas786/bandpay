/** Five outcomes a developer can read before they have an account. No network, no key. */

const { decide } = require("./decide");

const HOUR = 3600;

function quote(price, ageSec) {
  return { price, ageSec, staleAfterSec: HOUR };
}

function line(decision, fallback) {
  if (!decision) return fallback;
  if (decision.ok) return `Would pay from ${decision.source} at ${decision.price.toFixed(4)} USD.`;
  return decision.detail;
}

function labScenarios(live) {
  const chainlinkPrice =
    live && live.chainlink && live.chainlink.price > 0 ? live.chainlink.price : 0.1;
  const supraPrice = live && live.supra && live.supra.price > 0 ? live.supra.price : chainlinkPrice;
  const chainAge =
    live && live.chainlink && Number.isFinite(live.chainlink.ageSec) ? live.chainlink.ageSec : 30;
  const supraAge =
    live && live.supra && Number.isFinite(live.supra.ageSec) ? live.supra.ageSec : 30;
  const haveLive = Boolean(live && live.chainlink && live.supra);
  const chainFresh = chainlinkPrice > 0 && chainAge <= HOUR;
  const supraFresh = supraPrice > 0 && supraAge <= HOUR;
  const chain = quote(chainlinkPrice, chainAge);
  const supra = quote(supraPrice, supraAge);
  const freshChain = quote(chainlinkPrice, 30);
  const freshSupra = quote(supraPrice, 30);

  const both = decide({ chainlink: chain, supra, minPrice: 0.05, maxPrice: 0.2 });
  const oneStale = decide({
    chainlink: quote(chainlinkPrice, 7200),
    supra: freshSupra,
    minPrice: 0.05,
    maxPrice: 0.2,
  });
  const disagree = decide({
    chainlink: freshChain,
    supra: quote(chainlinkPrice * 1.05, 30),
    minPrice: 0.05,
    maxPrice: 1,
  });
  const outside = decide({ chainlink: freshChain, supra: freshSupra, minPrice: 1, maxPrice: 2 });
  const liveTitle = !haveLive
    ? "Both feeds fresh"
    : !chainFresh && supraFresh
      ? "Live: Chainlink stale, Supra used"
      : chainFresh && !supraFresh
        ? "Live: Supra stale, Chainlink used"
        : !chainFresh && !supraFresh
          ? "Live: no fresh feed"
          : "Both feeds fresh";

  return [
    {
      id: "fresh",
      title: liveTitle,
      kind: haveLive ? "live" : "example",
      result: line(both, "Waiting for the feeds."),
      ok: Boolean(both.ok),
      test: "pays HBAR when both feeds agree inside the band",
      where: "packages/hardhat/contracts/BandPay.sol release and _price",
      command:
        "export MIN_USD=0.05\nexport MAX_USD=0.20\nexport DUE_IN_SECONDS=90\nnode packages/hardhat/scripts/fund.js",
      proof: "testnet-proven",
    },
    {
      id: "stale",
      title: "Chainlink is stale",
      kind: "simulation",
      result: line(oneStale, "No price."),
      ok: Boolean(oneStale.ok),
      test: "uses Supra when Chainlink is stale",
      where: "packages/hardhat/contracts/BandPay.sol _chainlink and _price",
      command: "export MIN_USD=0.05\nexport MAX_USD=0.20\nnode packages/hardhat/scripts/fund.js",
      proof: "local simulation",
    },
    {
      id: "disagree",
      title: "Feeds disagree",
      kind: "simulation",
      result: line(disagree, "Disagree."),
      ok: false,
      test: "reverts when the feeds disagree by more than 3%",
      where: "packages/hardhat/contracts/BandPay.sol _price",
      command:
        "export MIN_USD=0.05\nexport MAX_USD=1\nexport ALLOW_REVERT=1\nnpm run schedule --workspace=@bandpay/schedule",
      proof: "local simulation",
    },
    {
      id: "outside",
      title: "Price outside the band",
      kind: haveLive ? "live prices, chosen band" : "simulation",
      result: line(outside, "Outside the band."),
      ok: false,
      test: "reverts outside the band and then lets the payer cancel",
      where: "packages/hardhat/contracts/BandPay.sol release",
      command:
        "export MIN_USD=1\nexport MAX_USD=2\nexport ALLOW_REVERT=1\nnpm run schedule --workspace=@bandpay/schedule",
      proof: "testnet-proven",
    },
    {
      id: "early",
      title: "Schedule fires too early",
      kind: "simulation",
      result:
        "TooEarly. The call reverts. The escrow stays until cancel, or until a new schedule expires after executeAt.",
      ok: false,
      test: "rejects a stranger and an early call",
      where: "packages/hardhat/contracts/BandPay.sol release, and packages/schedule/schedule.mjs",
      command: "export DUE_IN_SECONDS=3600\nnode packages/hardhat/scripts/fund.js",
      proof: "local simulation",
    },
    {
      id: "usd",
      title: "Oracle sets the HBAR",
      kind: "simulation",
      result: `A $0.05 invoice at ${chainlinkPrice.toFixed(4)} USD pays ${(0.05 / chainlinkPrice).toFixed(4)} HBAR and refunds the rest of the escrow. Local test only. No testnet schedule proves fundHbarUsd yet.`,
      ok: true,
      test: "pays a USD amount of HBAR and refunds the rest of the escrow",
      where: "packages/hardhat/contracts/BandPay.sol fundHbarUsd",
      command:
        "export USD_AMOUNT=0.05\nexport MIN_USD=0.05\nexport MAX_USD=0.20\nexport DUE_IN_SECONDS=90\nnode packages/hardhat/scripts/fund.js",
      proof: "local simulation",
    },
    {
      id: "series",
      title: "One escrow, two schedules",
      kind: "simulation",
      result:
        "0.2 HBAR splits into two plans of 0.1. The two amounts add up to the escrow. A thirteenth instalment is refused. Local test only.",
      ok: true,
      test: "splits one escrow into instalments",
      where:
        "packages/hardhat/contracts/BandPay.sol fundHbarInstallments, packages/schedule/series.js",
      command:
        "export COUNT=2\nexport EVERY_SECONDS=2592000\nexport AMOUNT_HBAR=0.2\nexport MIN_USD=0.05\nexport MAX_USD=0.20\nexport DUE_IN_SECONDS=90\nnode packages/hardhat/scripts/fund.js",
      proof: "local simulation",
    },
    {
      id: "pool",
      title: "SaucerSwap is off the oracle",
      kind: "simulation",
      result:
        "A pool at twice the oracle is 10000 bps off. The limit is 300. The dollar invoice does not pay. Schedule 0.0.10832633 is the testnet revert. An HBAR band with no dollar amount does not ask the pool.",
      ok: false,
      test: "refuses a dollar invoice when SaucerSwap is more than 3% off the oracle",
      where: "packages/hardhat/contracts/BandPay.sol _requirePool",
      command: "npm run demo --workspace=@bandpay/hardhat",
      proof: "testnet-proven",
    },
    {
      id: "attempt",
      title: "The call succeeds and the payment does not",
      kind: "simulation",
      result:
        "attempt catches OutsideBand, Disagree, NoPrice, TooEarly, and Underfunded. The transaction status is success. The Attempted event says paid is false and carries the revert bytes. The escrow stays. Local test only.",
      ok: false,
      test: "records a refusal without undoing the escrow",
      where: "packages/hardhat/contracts/BandPay.sol attempt",
      command:
        'npm test --workspace=@bandpay/hardhat -- --grep "records a refusal without undoing the escrow"',
      proof: "local simulation",
    },
    {
      id: "receipt",
      title: "The HCS note is written after the mirror",
      kind: "simulation",
      result:
        "The contract cannot write the topic. Read the schedule on the mirror first. Then this script submits {template, planId, result, scheduleId}. Topic 0.0.10832517 already has the five earlier results. A new message is not the same as those five.",
      ok: true,
      test: "a reverted attempt fits in one HCS message",
      where: "packages/schedule/receipt.mjs",
      command:
        "export BANDPAY_TOPIC_ID=0.0.YOUR_TOPIC\nexport HEDERA_OPERATOR_ID=0.0.YOUR_ACCOUNT\nexport HEDERA_OPERATOR_KEY=0xYOUR_KEY\nexport PLAN_ID=0\nexport RESULT=reverted\nexport SCHEDULE_ID=0.0.YOUR_SCHEDULE\nnode packages/schedule/receipt.mjs",
      proof: "local simulation",
    },
  ];
}

module.exports = { labScenarios };
