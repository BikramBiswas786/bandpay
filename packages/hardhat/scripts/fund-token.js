/**
 * Associate an HTS token, approve it with a Hedera allowance, and escrow it.
 * The key stays in the shell. HBAR plans use fund.js instead.
 *
 *   export HEDERA_OPERATOR_ID=0.0.YOUR_ACCOUNT
 *   export HEDERA_OPERATOR_KEY=0x...
 *   export BANDPAY_CONTRACT_ID=0.0.YOUR_CONTRACT
 *   export TOKEN_ID=0.0.YOUR_TOKEN
 *   export DUE_IN_SECONDS=60
 *   node packages/hardhat/scripts/fund-token.js
 *
 * An ERC-20 approve against the token facade reverts here. The allowance is
 * AccountAllowanceApproveTransaction. associate is skipped when the mirror
 * already shows the contract holding that token.
 */
const { ethers } = require("ethers");
const {
  AccountAllowanceApproveTransaction,
  AccountId,
  Client,
  PrivateKey,
  TokenId,
} = require("@hashgraph/sdk");
const { currentNetwork } = require("../../nextjs/lib/network");
const artifact = require("../artifacts/contracts/BandPay.sol/BandPay.json");

function usd8(raw) {
  if (!/^\d+(\.\d{1,8})?$/.test(raw)) {
    throw new Error("MIN_USD and MAX_USD must be a USD amount with at most 8 decimals.");
  }
  const [whole, frac = ""] = raw.split(".");
  return BigInt(whole) * 100_000_000n + BigInt((frac + "00000000").slice(0, 8));
}

function solidityAddress(tokenId) {
  const parts = tokenId.split(".");
  if (parts.length !== 3 || parts[0] !== "0" || parts[1] !== "0") {
    throw new Error("TOKEN_ID must look like 0.0.x.");
  }
  return ethers.toBeHex(BigInt(parts[2]), 20);
}

async function contractAddress(net, id) {
  const response = await fetch(`${net.mirror}/api/v1/contracts/${id}`);
  if (!response.ok) throw new Error(`Mirror has no contract ${id}.`);
  const body = await response.json();
  const raw = body.evm_address || "";
  if (!raw) throw new Error(`Mirror has no EVM address for ${id}.`);
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

async function alreadyAssociated(net, contractId, tokenId) {
  const response = await fetch(
    `${net.mirror}/api/v1/accounts/${contractId}/tokens?token.id=${tokenId}`,
  );
  if (!response.ok) return false;
  const body = await response.json();
  return Array.isArray(body.tokens) && body.tokens.length > 0;
}

async function ethereumNonce(net, operatorId) {
  const response = await fetch(`${net.mirror}/api/v1/accounts/${operatorId}`);
  if (!response.ok) throw new Error(`Mirror has no account ${operatorId}.`);
  const body = await response.json();
  return body.ethereum_nonce;
}

async function main() {
  const key = process.env.DEPLOYER_PRIVATE_KEY || process.env.HEDERA_OPERATOR_KEY;
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const id = process.env.BANDPAY_CONTRACT_ID;
  const tokenId = process.env.TOKEN_ID;
  if (!key || !operatorId || !id || !tokenId) {
    throw new Error(
      "Set HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, BANDPAY_CONTRACT_ID, and TOKEN_ID. Never commit the key.",
    );
  }
  const due = Number(process.env.DUE_IN_SECONDS || "60");
  if (!Number.isFinite(due) || due < 0)
    throw new Error("DUE_IN_SECONDS must be a non-negative number.");
  const amount = BigInt(process.env.TOKEN_AMOUNT || "5");
  if (amount <= 0n) throw new Error("TOKEN_AMOUNT must be greater than 0.");
  const minPrice = process.env.MIN_USD ? usd8(process.env.MIN_USD) : 1n;
  const maxPrice = process.env.MAX_USD ? usd8(process.env.MAX_USD) : 1000n * 10n ** 8n;
  if (minPrice <= 0n || maxPrice < minPrice) throw new Error("The band is empty.");

  const net = currentNetwork();
  const provider = new ethers.JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true });
  const wallet = new ethers.Wallet(key, provider);
  const gasPrice = BigInt(await provider.send("eth_gasPrice", [])) * 2n;
  const token = process.env.TOKEN_SOLIDITY || solidityAddress(tokenId);
  const address = await contractAddress(net, id);
  const band = new ethers.Contract(address, artifact.abi, wallet);
  const executeAt = Math.floor(Date.now() / 1000) + due;
  const privateKey = PrivateKey.fromStringECDSA(key);
  const client = (net.name === "mainnet" ? Client.forMainnet() : Client.forTestnet()).setOperator(
    AccountId.fromString(operatorId),
    privateKey,
  );

  let associateTx = null;
  if (await alreadyAssociated(net, id, tokenId)) {
    associateTx = "already-associated";
  } else {
    const nonce = await ethereumNonce(net, operatorId);
    const tx = await band.associate(token, { type: 0, gasPrice, gasLimit: 1_000_000n, nonce });
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error("associate failed.");
    associateTx = tx.hash;
  }

  const allowance = await (
    await new AccountAllowanceApproveTransaction()
      .approveTokenAllowance(
        TokenId.fromString(tokenId),
        AccountId.fromString(operatorId),
        AccountId.fromString(id),
        Number(amount),
      )
      .execute(client)
  ).getReceipt(client);
  if (allowance.status.toString() !== "SUCCESS") {
    throw new Error(`allowance ${allowance.status.toString()}`);
  }

  const nonce = await ethereumNonce(net, operatorId);
  const planId = await band.nextId();
  const fund = await band.fundToken(wallet.address, token, amount, minPrice, maxPrice, executeAt, {
    type: 0,
    gasPrice,
    gasLimit: 1_500_000n,
    nonce,
  });
  const fundReceipt = await fund.wait();
  client.close();
  console.log(
    JSON.stringify({
      planId: planId.toString(),
      tokenId,
      token,
      amount: amount.toString(),
      executeAt,
      minPrice: minPrice.toString(),
      maxPrice: maxPrice.toString(),
      associateTx,
      allowance: allowance.status.toString(),
      fundTx: fund.hash,
      status: fundReceipt.status,
      scheduleAfterSeconds: due + 30,
    }),
  );
}

main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exit(1);
});
