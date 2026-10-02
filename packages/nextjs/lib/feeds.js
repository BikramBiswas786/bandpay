/** Read the two public testnet feeds. No key. Copy this with decide.js. */

const CHAINLINK = "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a";
const SUPRA = "0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917";
const SUPRA_PAIR = 75n;
const MAX_AGE = 3600;
const MILLISECOND_THRESHOLD = 10n ** 11n;

function word(data, index) {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  const slice = hex.slice(index * 64, index * 64 + 64);
  if (slice.length !== 64) return null;
  return BigInt("0x" + slice);
}

function scaleTo8(value, decimals) {
  if (decimals === 8) return value;
  if (decimals < 8) return value * 10n ** BigInt(8 - decimals);
  return value / 10n ** BigInt(decimals - 8);
}

function asQuote(price8, updatedAt, now, maxAge) {
  const age = now - updatedAt;
  const fresh = price8 > 0n && updatedAt > 0n && updatedAt <= now && age <= BigInt(maxAge);
  return {
    price: Number(price8) / 1e8,
    ageSec: Number(age < 0n ? 0n : age),
    updatedAt: Number(updatedAt),
    fresh,
  };
}

function decodeChainlink(data, now, maxAge = MAX_AGE) {
  const answer = word(data, 1);
  const updatedAt = word(data, 3);
  if (answer === null || updatedAt === null) return null;
  return asQuote(scaleTo8(answer, 8), updatedAt, BigInt(now), maxAge);
}

function decodeSupra(data, now, maxAge = MAX_AGE) {
  const decimals = word(data, 1);
  let updatedAt = word(data, 2);
  const price = word(data, 3);
  if (decimals === null || updatedAt === null || price === null || decimals > 18n) return null;
  if (updatedAt > MILLISECOND_THRESHOLD) updatedAt = updatedAt / 1000n;
  return asQuote(scaleTo8(price, Number(decimals)), updatedAt, BigInt(now), maxAge);
}

function encodePair(pair) {
  return pair.toString(16).padStart(64, "0");
}

async function ethCall(rpcUrl, to, data) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
  });
  if (!response.ok) throw new Error(`RPC ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || "RPC error");
  if (!body.result || body.result === "0x") throw new Error("Empty oracle response");
  return body.result;
}

async function readFeeds(rpcUrl, now = Math.floor(Date.now() / 1000)) {
  const [chainlinkRaw, supraRaw] = await Promise.all([
    ethCall(rpcUrl, CHAINLINK, "0xfeaf968c"),
    ethCall(rpcUrl, SUPRA, "0x89b94ea2" + encodePair(SUPRA_PAIR)),
  ]);
  return {
    chainlink: decodeChainlink(chainlinkRaw, now),
    supra: decodeSupra(supraRaw, now),
    maxAge: MAX_AGE,
    readAt: now,
  };
}

module.exports = {
  CHAINLINK,
  SUPRA,
  SUPRA_PAIR,
  MAX_AGE,
  decodeChainlink,
  decodeSupra,
  readFeeds,
  ethCall,
};
