/** HBAR to escrow so a USD invoice cannot be underfunded inside the band. */

function escrowTinybar(usdAmount, minPrice) {
  const usd = BigInt(usdAmount);
  const min = BigInt(minPrice);
  if (usd <= 0n || min <= 0n) throw new Error("USD amount and minimum price must be positive.");
  const tiny = (usd * 100_000_000n) / min;
  if (tiny === 0n) throw new Error("That invoice rounds to zero HBAR at the minimum price.");
  return tiny;
}

function weiForTinybar(tiny) {
  return BigInt(tiny) * 10n ** 10n;
}

module.exports = { escrowTinybar, weiForTinybar };
