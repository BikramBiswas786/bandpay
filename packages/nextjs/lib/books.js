const MIRROR = "https://testnet.mirrornode.hedera.com";
const TOPIC_ID = "0.0.10832517";

const PROOF = [
  {
    id: "0.0.10820921",
    address: "0x87aca0b7ad05e10f7ce953827d9a8b3a8231d9b2",
    note: "HBAR. Schedule 0.0.10820928 paid plan 1. Schedule 0.0.10830733 called release on plan 3 and reverted. Schedule 0.0.10832843 was created by the schedule precompile and paid plan 2.",
  },
  {
    id: "0.0.10823213",
    address: "0xa0F8f874341C54C89EE9A2178318Cfa504da7705",
    note: "HTS. Schedule 0.0.10831792 paid plan 1, 5 BAND. Plan 0 was cancelled.",
  },
  {
    id: "0.0.10832627",
    address: "0xa5128A765b8b5512a7a0761c897822787689445c",
    note: "Dollar invoice. Schedule 0.0.10832633 called release and reverted PoolOff. The public testnet pool priced HBAR near $2.25. The oracle was about $0.10. The escrow stayed.",
  },
  {
    id: "0.0.10839717",
    address: "0xfB8Be56f0c016105B8875813e400C1E0BaFd69bf",
    note: "scheduleRelease on this bytecode. Schedule 0.0.10839746 was signed by the payer and paid plan 1, 0.05 HBAR. Unsigned schedule 0.0.10839720 returned INVALID_PAYER_SIGNATURE and paid nothing.",
  },
];

const SCHEDULES = [
  {
    id: "0.0.10820928",
    transactionId: "0.0.10015230-1790921501-362680160",
  },
  {
    id: "0.0.10830733",
    transactionId: "0.0.10015230-1790970685-448974693",
  },
  {
    id: "0.0.10831792",
    transactionId: "0.0.10015230-1790976251-653175855",
  },
  {
    id: "0.0.10832633",
    transactionId: "0.0.10015230-1790979096-883320387",
  },
  {
    id: "0.0.10832843",
    transactionId: "0.0.7314364-1790980118-485142054",
  },
  {
    id: "0.0.10839746",
    transactionId: "0.0.7314364-1791018681-543656522",
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

module.exports = { PROOF, SCHEDULES, TOPIC_ID, MIRROR, addressFor, loadBooks };
