/** Feed and endpoint map. Mainnet addresses are not guessed. Set them in the shell. */

const NETWORKS = {
  testnet: {
    name: "testnet",
    chainId: 296,
    rpc: "https://testnet.hashio.io/api",
    mirror: "https://testnet.mirrornode.hedera.com",
    chainlink: "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a",
    supra: "0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917",
    supraPair: 75,
    maxAge: 3600,
  },
  mainnet: {
    name: "mainnet",
    chainId: 295,
    rpc: "https://mainnet.hashio.io/api",
    mirror: "https://mainnet.mirrornode.hedera.com",
    chainlink: "",
    supra: "",
    supraPair: 0,
    maxAge: 3600,
  },
};

function currentNetwork() {
  const name = process.env.HEDERA_NETWORK || "testnet";
  const base = NETWORKS[name];
  if (!base) throw new Error("HEDERA_NETWORK must be testnet or mainnet.");
  const chainlink = process.env.CHAINLINK_FEED || base.chainlink;
  const supra = process.env.SUPRA_FEED || base.supra;
  if (!chainlink || !supra) {
    throw new Error(
      "Set CHAINLINK_FEED and SUPRA_FEED for mainnet. This template does not guess them.",
    );
  }
  const supraPair = Number(process.env.SUPRA_PAIR || base.supraPair);
  return {
    ...base,
    chainlink,
    supra,
    supraPair,
    rpc: process.env.HEDERA_RPC_URL || base.rpc,
  };
}

module.exports = { NETWORKS, currentNetwork };
