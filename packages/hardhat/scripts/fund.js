/**
 * Escrow 0.1 HBAR into a deployed BandPay. The key stays in the shell.
 *
 *   export DEPLOYER_PRIVATE_KEY=0x...
 *   export BANDPAY_CONTRACT_ID=0.0.YOUR_CONTRACT
 *   export DUE_IN_SECONDS=120
 *   node packages/hardhat/scripts/fund.js
 *
 * Optional MIN_USD and MAX_USD narrow the band. Unset, the band is wide enough
 * that a fresh HBAR/USD feed can pay. JSON-RPC value is 18-decimal weibar;
 * Hedera stores msg.value as tinybar, so 0.1 HBAR is ethers.parseEther("0.1").
 */
const { ethers } = require("ethers");
const { currentNetwork } = require("../../nextjs/lib/network");
function usd8(raw) {
  if (!/^\d+(\.\d{1,8})?$/.test(raw))
    throw new Error("MIN_USD and MAX_USD must be a USD amount with at most 8 decimals.");
  const [whole, frac = ""] = raw.split(".");
  return BigInt(whole) * 100_000_000n + BigInt((frac + "00000000").slice(0, 8));
}
const artifact = require("../artifacts/contracts/BandPay.sol/BandPay.json");

async function contractAddress(id) {
  const net = currentNetwork();
  const response = await fetch(`${net.mirror}/api/v1/contracts/${id}`);
  if (!response.ok) throw new Error(`Mirror has no contract ${id}.`);
  const body = await response.json();
  const raw = body.evm_address || "";
  if (!raw) throw new Error(`Mirror has no EVM address for ${id}.`);
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

async function main() {
  const key = process.env.DEPLOYER_PRIVATE_KEY || process.env.HEDERA_OPERATOR_KEY;
  const id = process.env.BANDPAY_CONTRACT_ID;
  if (!key || !id)
    throw new Error("Set DEPLOYER_PRIVATE_KEY and BANDPAY_CONTRACT_ID. Never commit the key.");
  const due = Number(process.env.DUE_IN_SECONDS || "120");
  if (!Number.isFinite(due) || due < 0)
    throw new Error("DUE_IN_SECONDS must be a non-negative number.");
  const minPrice = process.env.MIN_USD ? usd8(process.env.MIN_USD) : 1n;
  const maxPrice = process.env.MAX_USD ? usd8(process.env.MAX_USD) : 1000n * 10n ** 8n;
  if (minPrice <= 0n || maxPrice < minPrice) throw new Error("The band is empty.");
  const net = currentNetwork();
  const provider = new ethers.JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true });
  const wallet = new ethers.Wallet(key, provider);
  const gasPrice = BigInt(await provider.send("eth_gasPrice", [])) * 2n;
  const band = new ethers.Contract(await contractAddress(id), artifact.abi, wallet);
  const planId = await band.nextId();
  const executeAt = Math.floor(Date.now() / 1000) + due;
  const amountHbar = process.env.AMOUNT_HBAR || "0.1";
  if (!/^\d+(\.\d{1,8})?$/.test(amountHbar)) {
    throw new Error("AMOUNT_HBAR must be an HBAR amount with at most 8 decimals.");
  }
  const value = ethers.parseEther(amountHbar);
  if (value <= 0n) throw new Error("AMOUNT_HBAR must be greater than 0.");
  const recipient =
    process.env.RECIPIENT && process.env.RECIPIENT.startsWith("0x")
      ? process.env.RECIPIENT
      : wallet.address;
  const tx = await band.fundHbar(recipient, minPrice, maxPrice, executeAt, {
    type: 0,
    gasPrice,
    gasLimit: 1_000_000n,
    value,
  });
  const receipt = await tx.wait();
  console.log(
    JSON.stringify({
      planId: planId.toString(),
      executeAt,
      minPrice: minPrice.toString(),
      maxPrice: maxPrice.toString(),
      amountHbar,
      fundTx: tx.hash,
      status: receipt.status,
      scheduleAfterSeconds: due + 30,
    }),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
