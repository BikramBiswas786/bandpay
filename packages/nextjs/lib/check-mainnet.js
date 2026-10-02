/**
 * No key. Quotes the public mainnet WHBAR/USDC pool against mainnet Chainlink.
 * A dollar invoice pays only when these two are within 3%. Testnet USDC is not a dollar, so this is the path that can agree.
 */
const { ethers } = require("ethers");
const { poolPrice8, poolAgrees } = require("../../rules/pool");

const RPC = "https://mainnet.hashio.io/api";
const ROUTER = "0x00000000000000000000000000000000002e7a5d";
const WHBAR = "0x0000000000000000000000000000000000163b5a";
const USDC = "0x000000000000000000000000000000000006f89a";
const CHAINLINK = "0xAF685FB45C12b92b5054ccb9313e135525F9b5d5";
const ONE_HBAR = 100_000_000n;

async function mainnetPool() {
  const provider = new ethers.JsonRpcProvider(RPC, 295, { staticNetwork: true });
  const router = new ethers.Contract(
    ROUTER,
    ["function getAmountsOut(uint256,address[]) view returns (uint256[])"],
    provider,
  );
  const feed = new ethers.Contract(
    CHAINLINK,
    ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"],
    provider,
  );
  const amounts = await router.getAmountsOut(ONE_HBAR, [WHBAR, USDC]);
  const usdcOut = amounts[amounts.length - 1];
  const pool = poolPrice8(usdcOut, ONE_HBAR);
  const round = await feed.latestRoundData();
  const oracle = round[1];
  const verdict = poolAgrees(pool, oracle);
  return {
    usdcOut: usdcOut.toString(),
    poolUsd: Number(pool) / 1e8,
    oracleUsd: Number(oracle) / 1e8,
    bps: verdict.bps,
    ok: verdict.ok,
    updatedAt: Number(round[3]),
  };
}

async function main() {
  const quote = await mainnetPool();
  console.log(
    `Mainnet SaucerSwap ${quote.poolUsd}  Chainlink ${quote.oracleUsd}  ${quote.bps} bps  ${quote.ok ? "would pay" : "PoolOff"}`,
  );
  if (!quote.ok) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { mainnetPool };
