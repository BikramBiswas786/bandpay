/**
 * No key. Reads the public feeds and the escrows, and prints what release would do now.
 * Set BANDPAY_CONTRACT_ID=0.0.x to check your deployment instead of the proof contracts.
 */
const { readFeeds } = require("./feeds");
const { explain, readPlans, readPoolPrice } = require("./plans");
const { loadBooks } = require("./books");
const { mainnetPool } = require("./check-mainnet");

async function main() {
  const rpc = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";
  const feeds = await readFeeds(rpc);
  const books = await loadBooks();
  console.log(
    `Chainlink ${feeds.chainlink?.price ?? "missing"} fresh=${Boolean(feeds.chainlink?.fresh)}`,
  );
  console.log(`Supra     ${feeds.supra?.price ?? "missing"} fresh=${Boolean(feeds.supra?.fresh)}`);
  for (const book of books) {
    console.log(`${book.id}  ${book.note}`);
    const plans = await readPlans(rpc, book.address);
    const poolPrice = await readPoolPrice(rpc, book.address);
    if (plans.length === 0) console.log("  no plans");
    for (const plan of plans) {
      const release = explain(plan, feeds, feeds.readAt, poolPrice);
      console.log(`  plan ${plan.id}  ${plan.amountLabel}  ${release.state}  ${release.detail}`);
    }
  }
  const mainnet = await mainnetPool();
  console.log(
    `Mainnet SaucerSwap ${mainnet.poolUsd}  Chainlink ${mainnet.oracleUsd}  ${mainnet.bps} bps  ${mainnet.ok ? "would pay" : "PoolOff"}`,
  );
  if (!mainnet.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
