const { test } = require("node:test");
const assert = require("node:assert/strict");
const { labScenarios } = require("./lab");

const live = {
  chainlink: { price: 0.1, ageSec: 20 },
  supra: { price: 0.101, ageSec: 20 },
};

test("live feeds inside 0.05 to 0.20 would pay", () => {
  const fresh = labScenarios(live).find((item) => item.id === "fresh");
  assert.equal(fresh.kind, "live");
  assert.equal(fresh.ok, true);
  assert.match(fresh.result, /chainlink/);
});

test("a stale Chainlink round falls through to Supra", () => {
  const stale = labScenarios(live).find((item) => item.id === "stale");
  assert.equal(stale.kind, "simulation");
  assert.equal(stale.ok, true);
  assert.match(stale.result, /supra/);
});

test("a 5 percent gap is a disagreement, not a payment", () => {
  const row = labScenarios(live).find((item) => item.id === "disagree");
  assert.equal(row.ok, false);
  assert.match(row.result, /bps/);
});

test("a 1 to 2 dollar band refuses the live HBAR price", () => {
  const row = labScenarios(live).find((item) => item.id === "outside");
  assert.equal(row.ok, false);
  assert.match(row.result, /Outside/);
});

test("a stale live Chainlink is named as stale, and disagree still refuses", () => {
  const stale = {
    chainlink: { price: 0.0996, ageSec: 3819 },
    supra: { price: 0.1046, ageSec: 20 },
  };
  const fresh = labScenarios(stale).find((item) => item.id === "fresh");
  const disagree = labScenarios(stale).find((item) => item.id === "disagree");
  assert.match(fresh.title, /Chainlink stale/);
  assert.match(fresh.result, /supra/);
  assert.equal(disagree.ok, false);
  assert.match(disagree.result, /bps/);
});
test("an early schedule is named TooEarly and is not a price result", () => {
  const row = labScenarios(live).find((item) => item.id === "early");
  assert.match(row.result, /TooEarly/);
  assert.equal(row.kind, "simulation");
});

test("new payment rows are runnable and are not claimed as testnet proofs", () => {
  const rows = labScenarios(live);
  const usd = rows.find((item) => item.id === "usd");
  const series = rows.find((item) => item.id === "series");
  const attempt = rows.find((item) => item.id === "attempt");
  const receipt = rows.find((item) => item.id === "receipt");
  for (const row of [usd]) {
    assert.equal(row.proof, "local simulation");
    assert.doesNotMatch(row.command, /#/);
  }
  for (const row of [series, attempt, receipt]) {
    assert.equal(row.proof, "testnet-proven");
    assert.doesNotMatch(row.command, /#/);
  }
  assert.match(usd.command, /USD_AMOUNT=0\.05/);
  assert.match(usd.command, /fund\.js/);
  assert.match(series.command, /COUNT=2/);
  assert.match(series.command, /fund\.js/);
  assert.match(attempt.command, /records a refusal/);
  assert.match(receipt.command, /receipt\.mjs/);
  assert.match(receipt.result, /cannot write the topic/);
});
