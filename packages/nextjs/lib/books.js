const MIRROR = "https://testnet.mirrornode.hedera.com";

const PROOF = [
  {
    id: "0.0.10820921",
    address: "0x87aca0b7ad05e10f7ce953827d9a8b3a8231d9b2",
    note: "HBAR. The wait-for-expiry schedule called release here.",
  },
  {
    id: "0.0.10823213",
    address: "0xa0F8f874341C54C89EE9A2178318Cfa504da7705",
    note: "HTS. associate, then fundToken, then cancel.",
  },
];

function withPrefix(raw) {
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

async function addressFor(contractId) {
  const response = await fetch(`${MIRROR}/api/v1/contracts/${contractId}`);
  if (!response.ok) throw new Error(`Mirror has no contract ${contractId}.`);
  const body = await response.json();
  const address = withPrefix(body.evm_address);
  if (!address) throw new Error(`Mirror has no EVM address for ${contractId}.`);
  return address;
}

/** Proof contracts, unless BANDPAY_CONTRACT_ID points the desk at yours. */
async function loadBooks() {
  const id = process.env.BANDPAY_CONTRACT_ID;
  if (!id) return PROOF;
  return [{ id, address: await addressFor(id), note: "BANDPAY_CONTRACT_ID from the shell." }];
}

module.exports = { PROOF, MIRROR, addressFor, loadBooks };
