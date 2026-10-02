/**
 * Deploy BandPay against the public testnet feeds.
 * Set DEPLOYER_PRIVATE_KEY in the shell. Do not write it into a file you commit.
 *
 *   DEPLOYER_PRIVATE_KEY=0x... node packages/hardhat/scripts/deploy.js
 */
const { ethers } = require("ethers");
const artifact = require("../artifacts/contracts/BandPay.sol/BandPay.json");

const CHAINLINK = "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a";
const SUPRA = "0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917";

async function main() {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("Set DEPLOYER_PRIVATE_KEY in the shell. Never commit it.");
  const provider = new ethers.JsonRpcProvider(process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api", 296, {
    staticNetwork: true,
  });
  const wallet = new ethers.Wallet(key, provider);
  const gasPrice = BigInt(await provider.send("eth_gasPrice", [])) * 2n;
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployed = await factory.deploy(CHAINLINK, SUPRA, 75, 3600, { type: 0, gasPrice, gasLimit: 5_000_000n });
  await deployed.waitForDeployment();
  const contract = await deployed.getAddress();
  let contractId = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    const response = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/${contract}`);
    if (response.ok) {
      const body = await response.json();
      if (body.contract_id) {
        contractId = body.contract_id;
        break;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  console.log(JSON.stringify({ contract, contractId, deployer: wallet.address }));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
