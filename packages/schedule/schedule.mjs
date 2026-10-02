import { createRequire } from "node:module";
import {
  AccountId,
  Client,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  PrivateKey,
  ScheduleCreateTransaction,
  Timestamp,
} from "@hashgraph/sdk";

const require = createRequire(import.meta.url);
const { readFeeds } = require("../nextjs/lib/feeds.js");
const { assertSchedulable, assertWorthScheduling, explain, readPlans } = require("../nextjs/lib/plans.js");

const operatorId = process.env.HEDERA_OPERATOR_ID;
const operatorKey = process.env.HEDERA_OPERATOR_KEY;
const contractId = process.env.BANDPAY_CONTRACT_ID;
const planId = process.env.PLAN_ID;
const dueInSeconds = Number(process.env.DUE_IN_SECONDS || "3600");
const rpc = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";

if (!operatorId || !operatorKey || !contractId || planId === undefined) {
  throw new Error("Set HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, BANDPAY_CONTRACT_ID, and PLAN_ID. Never commit the key.");
}

const account = await (await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${contractId}`)).json();
const raw = account.evm_address || "";
const evm = raw.startsWith("0x") ? raw : raw ? `0x${raw}` : null;
if (!evm) throw new Error(`No EVM address for ${contractId}.`);

const plans = await readPlans(rpc, evm);
const plan = plans.find(item => item.id === Number(planId));
const due = new Date(Date.now() + dueInSeconds * 1000);
assertSchedulable(plan, Math.floor(due.getTime() / 1000));

const feeds = await readFeeds(rpc);
const now = explain(plan, feeds, feeds.readAt);
const allowRevert = process.env.ALLOW_REVERT === "1";
assertWorthScheduling(now, allowRevert);
console.log(JSON.stringify({ planId: Number(planId), ifReleasedNow: now, due: due.toISOString(), allowRevert }));

const key = PrivateKey.fromStringECDSA(operatorKey);
const client = Client.forTestnet().setOperator(AccountId.fromString(operatorId), key);

const release = new ContractExecuteTransaction()
  .setContractId(ContractId.fromString(contractId))
  .setGas(1_000_000)
  .setFunction("release", new ContractFunctionParameters().addUint256(Number(planId)));

const schedule = new ScheduleCreateTransaction()
  .setScheduledTransaction(release)
  .setPayerAccountId(AccountId.fromString(operatorId))
  .setAdminKey(key.publicKey)
  .setWaitForExpiry(true)
  .setExpirationTime(Timestamp.fromDate(due))
  .setScheduleMemo("bandpay release");

const response = await schedule.execute(client);
const receipt = await response.getReceipt(client);
console.log(JSON.stringify({
  status: receipt.status.toString(),
  scheduleId: receipt.scheduleId?.toString() ?? null,
  transactionId: response.transactionId.toString(),
  due: due.toISOString(),
}));
client.close();