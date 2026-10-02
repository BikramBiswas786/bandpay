/** Price rule shared with the contract. 8-decimal math is tested in Solidity. */
const DISAGREE_BPS = 300;

function fresh(quote) {
  return quote && quote.price > 0 && quote.ageSec <= quote.staleAfterSec;
}

function decide(input) {
  const chainlink = fresh(input.chainlink) ? input.chainlink : null;
  const supra = fresh(input.supra) ? input.supra : null;
  let source;
  let price;
  if (chainlink && supra) {
    const bps = Math.floor((Math.abs(chainlink.price - supra.price) * 10000) / chainlink.price);
    if (bps > DISAGREE_BPS) {
      return { ok: false, reason: "disagree", detail: `Sources differ by ${bps} bps.` };
    }
    source = "chainlink";
    price = chainlink.price;
  } else if (chainlink) {
    source = "chainlink";
    price = chainlink.price;
  } else if (supra) {
    source = "supra";
    price = supra.price;
  } else {
    return { ok: false, reason: "no-price", detail: "No fresh price." };
  }
  if (price < input.minPrice || price > input.maxPrice) {
    return { ok: false, reason: "outside-band", detail: "Outside the band." };
  }
  return { ok: true, source, price };
}

module.exports = { DISAGREE_BPS, decide };
