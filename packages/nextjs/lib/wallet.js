/** Browser wallet calls against the public HBAR BandPay on Hedera testnet. No key is read. */

const HBAR_CONTRACT = "0x87aca0b7ad05e10f7ce953827d9a8b3a8231d9b2";
const CHAIN_ID = "0x128";

const ERRORS = {
  "5fc7b305": "OutsideBand",
  "085de625": "TooEarly",
  "1435e357": "NotPayer",
  "8523b62a": "BadState",
  c149905d: "NoPrice",
  e9158198: "Disagree",
  "1f2a2005": "ZeroAmount",
};

function pad(hex) {
  return hex.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function wordUint(value) {
  const parsed = BigInt(value);
  if (parsed < 0n) throw new Error("Unsigned value was negative.");
  return pad(parsed.toString(16));
}

function wordInt(value) {
  let parsed = BigInt(value);
  if (parsed < 0n) parsed = (1n << 256n) + parsed;
  return pad(parsed.toString(16));
}

function wordAddress(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("Recipient is not an EVM address.");
  return pad(address);
}

/** USD with at most 8 decimals, as the contract stores a feed. */
function usd8(raw) {
  if (!/^\d+(\.\d{1,8})?$/.test(String(raw))) {
    throw new Error("A USD amount needs at most 8 decimals.");
  }
  const [whole, frac = ""] = String(raw).split(".");
  return BigInt(whole) * 100_000_000n + BigInt((frac + "00000000").slice(0, 8));
}

/** HBAR as 18-decimal JSON-RPC value. The relay stores msg.value in tinybar. */
function parseHbar(raw) {
  if (!/^\d+(\.\d{1,8})?$/.test(String(raw))) {
    throw new Error("An HBAR amount needs at most 8 decimals.");
  }
  const [whole, frac = ""] = String(raw).split(".");
  const value = BigInt(whole) * 10n ** 18n + BigInt((frac + "000000000000000000").slice(0, 18));
  if (value <= 0n) throw new Error("Amount must be greater than 0.");
  return value;
}

function encodeFund(recipient, minPrice, maxPrice, executeAt) {
  return (
    "0x8790fbc9" +
    wordAddress(recipient) +
    wordInt(minPrice) +
    wordInt(maxPrice) +
    wordUint(executeAt)
  );
}

function encodeRelease(id) {
  return "0x37bdc99b" + wordUint(id);
}

function encodeCancel(id) {
  return "0x40e58ee5" + wordUint(id);
}

function decodeRevert(error) {
  const blob = JSON.stringify(error || "").toLowerCase();
  for (const [selector, name] of Object.entries(ERRORS)) {
    if (blob.includes(selector)) return name;
  }
  const message = error?.message || error?.reason || "";
  if (error?.code === 4001 || /user rejected|user denied/i.test(message)) {
    return "rejected";
  }
  return message ? String(message).slice(0, 180) : "The call reverted.";
}

function shortAccount(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatHbar(wei) {
  const value = BigInt(wei);
  const whole = value / 10n ** 18n;
  const frac = (value % 10n ** 18n) / 10n ** 14n;
  return `${whole}.${String(frac).padStart(4, "0")}`;
}

const HEDERA_TESTNET = {
  chainId: CHAIN_ID,
  chainName: "Hedera Testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
  rpcUrls: ["https://testnet.hashio.io/api"],
  blockExplorerUrls: ["https://hashscan.io/testnet"],
};

async function connect(provider) {
  if (!provider) throw new Error("No wallet is injected. Use MetaMask or HashPack.");
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) throw new Error("The wallet returned no account.");
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID }],
    });
  } catch (error) {
    const missing = error?.code === 4902 || /unrecognized|not added/i.test(error?.message || "");
    if (!missing) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [HEDERA_TESTNET] });
  }
  const chainId = await provider.request({ method: "eth_chainId" });
  if (BigInt(chainId) !== 296n) throw new Error("Switch the wallet to Hedera testnet.");
  return accounts[0];
}

async function balanceOf(provider, account) {
  const wei = await provider.request({ method: "eth_getBalance", params: [account, "latest"] });
  return BigInt(wei);
}

async function nextPlanId(provider) {
  const data = await provider.request({
    method: "eth_call",
    params: [{ to: HBAR_CONTRACT, data: "0x61b8ce8c" }, "latest"],
  });
  return BigInt(data);
}

async function legacyFee(provider) {
  const price = BigInt(await provider.request({ method: "eth_gasPrice", params: [] }));
  return "0x" + (price * 2n).toString(16);
}

async function send(provider, tx) {
  const gasPrice = await legacyFee(provider);
  return provider.request({
    method: "eth_sendTransaction",
    params: [{ gas: "0x493e0", ...tx, gasPrice }],
  });
}

async function waitReceipt(provider, hash) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`No receipt yet for ${hash}.`);
}

function succeeded(receipt) {
  return receipt && (receipt.status === "0x1" || receipt.status === 1 || receipt.status === "0x01");
}

async function fund(provider, { from, amount, minUsd, maxUsd, dueSeconds }) {
  const planId = await nextPlanId(provider);
  const executeAt = BigInt(Math.floor(Date.now() / 1000) + Number(dueSeconds || 0));
  const hash = await send(provider, {
    from,
    to: HBAR_CONTRACT,
    value: "0x" + parseHbar(amount).toString(16),
    data: encodeFund(from, usd8(minUsd), usd8(maxUsd), executeAt),
  });
  const receipt = await waitReceipt(provider, hash);
  if (!succeeded(receipt)) throw new Error(`Fund reverted. ${hash}`);
  return { planId: planId.toString(), hash };
}

async function simulate(provider, from, data) {
  try {
    await provider.request({
      method: "eth_call",
      params: [{ from, to: HBAR_CONTRACT, data }, "latest"],
    });
    return { ok: true, reason: "ok" };
  } catch (error) {
    return { ok: false, reason: decodeRevert(error) };
  }
}

async function openPlans(provider, account) {
  const next = await nextPlanId(provider);
  const target = account.toLowerCase();
  const mine = [];
  const stop = next < 40n ? next : 40n;
  for (let id = 0n; id < stop; id += 1n) {
    const data = await provider.request({
      method: "eth_call",
      params: [{ to: HBAR_CONTRACT, data: "0xb1620616" + wordUint(id) }, "latest"],
    });
    const hex = String(data).slice(2);
    if (hex.length < 64 * 10) continue;
    const payer = "0x" + hex.slice(24, 64);
    const funded = BigInt("0x" + hex.slice(7 * 64, 8 * 64)) === 1n;
    const paid = BigInt("0x" + hex.slice(8 * 64, 9 * 64)) === 1n;
    const cancelled = BigInt("0x" + hex.slice(9 * 64, 10 * 64)) === 1n;
    if (payer.toLowerCase() === target && funded && !paid && !cancelled) mine.push(id.toString());
  }
  return mine;
}

async function callAction(provider, from, data) {
  try {
    const hash = await send(provider, { from, to: HBAR_CONTRACT, data, gas: "0x27100" });
    const receipt = await waitReceipt(provider, hash);
    return { ok: succeeded(receipt), hash, reason: succeeded(receipt) ? "ok" : "reverted" };
  } catch (error) {
    return { ok: false, hash: null, reason: decodeRevert(error) };
  }
}

module.exports = {
  HBAR_CONTRACT,
  CHAIN_ID,
  usd8,
  parseHbar,
  encodeFund,
  encodeRelease,
  encodeCancel,
  decodeRevert,
  shortAccount,
  formatHbar,
  connect,
  balanceOf,
  fund,
  callAction,
  simulate,
  openPlans,
};
