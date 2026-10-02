/**
 * Deploy BandPay against the public testnet feeds.
 * Set DEPLOYER_PRIVATE_KEY in the shell. Do not write it into a file you commit.
 *
 *   DEPLOYER_PRIVATE_KEY=0x... node packages/hardhat/scripts/deploy.js
 */
const { ethers } = require("ethers");
const { currentNetwork } = require("../../nextjs/lib/network");
const artifact = require("../artifacts/contracts/BandPay.sol/BandPay.json");

async function main() {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("Set DEPLOYER_PRIVATE_KEY in the shell. Never commit it.");
  const net = currentNetwork();
  const provider = new ethers.JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true });
  const wallet = new ethers.Wallet(key, provider);
  const gasPrice = BigInt(await provider.send("eth_gasPrice", [])) * 2n;
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployed = await factory.deploy(
    net.chainlink,
    net.supra,
    net.supraPair,
    net.maxAge,
    net.router || ethers.ZeroAddress,
    net.whbar || ethers.ZeroAddress,
    net.usdc || ethers.ZeroAddress,
    {
      type: 0,
      gasPrice,
      gasLimit: 5_000_000n,
    },
  );
  await deployed.waitForDeployment();
  const contract = await deployed.getAddress();
  let contractId = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    const response = await fetch(`${net.mirror}/api/v1/contracts/${contract}`);
    if (response.ok) {
      const body = await response.json();
      if (body.contract_id) {
        contractId = body.contract_id;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.log(JSON.stringify({ contract, contractId, deployer: wallet.address }));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
