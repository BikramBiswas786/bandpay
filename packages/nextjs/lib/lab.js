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
  const chain = quote(chainlinkPrice, chainAge);
  const supra = quote(supraPrice, supraAge);

  const both = decide({ chainlink: chain, supra, minPrice: 0.05, maxPrice: 0.2 });
  const oneStale = decide({
    chainlink: quote(chainlinkPrice, 7200),
    supra,
    minPrice: 0.05,
    maxPrice: 0.2,
  });
  const disagree = decide({
    chainlink: chain,
    supra: quote(chainlinkPrice * 1.05, 30),
    minPrice: 0.05,
    maxPrice: 1,
  });
  const outside = decide({ chainlink: chain, supra, minPrice: 1, maxPrice: 2 });

  return [
    {
      id: "fresh",
      title: "Both feeds fresh",
      kind: haveLive ? "live" : "example",
      result: line(both, "Waiting for the feeds."),
      ok: Boolean(both.ok),
      test: "pays HBAR when both feeds agree inside the band",
      where: "packages/hardhat/contracts/BandPay.sol release and _price",
      command:
        "export MIN_USD=0.05\nexport MAX_USD=0.20\nexport DUE_IN_SECONDS=90\nnode packages/hardhat/scripts/fund.js",
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
    },
  ];
}

module.exports = { labScenarios };
