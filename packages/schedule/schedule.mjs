import { assertSeriesFits, seriesStep } from "./series.js";
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
const { currentNetwork } = require("../nextjs/lib/network.js");

const operatorId = process.env.HEDERA_OPERATOR_ID;
const operatorKey = process.env.HEDERA_OPERATOR_KEY;
const contractId = process.env.BANDPAY_CONTRACT_ID;
const planId = process.env.PLAN_ID;
const dueInSeconds = Number(process.env.DUE_IN_SECONDS || "3600");
const {
  assertSchedulable,
  assertWorthScheduling,
  explain,
  readPlans,
  readPoolPrice,
} = require("../nextjs/lib/plans.js");
const net = currentNetwork();

if (!operatorId || !operatorKey || !contractId || planId === undefined) {
  throw new Error(
    "Set HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, BANDPAY_CONTRACT_ID, and PLAN_ID. Never commit the key.",
  );
}

const account = await (await fetch(`${net.mirror}/api/v1/accounts/${contractId}`)).json();
const raw = account.evm_address || "";
const evm = raw.startsWith("0x") ? raw : raw ? `0x${raw}` : null;
if (!evm) throw new Error(`No EVM address for ${contractId}.`);

const count = Number(process.env.COUNT || "1");
const every = Number(process.env.EVERY_SECONDS || "0");
assertSeriesFits(dueInSeconds, count, every);
seriesStep(planId, 0, count, every);

const plans = await readPlans(net.rpc, evm);
const feeds = await readFeeds(net.rpc);
const poolPrice = await readPoolPrice(net.rpc, evm);
const allowRevert = process.env.ALLOW_REVERT === "1";
const key = PrivateKey.fromStringECDSA(operatorKey);
const client = (net.name === "mainnet" ? Client.forMainnet() : Client.forTestnet()).setOperator(
  AccountId.fromString(operatorId),
  key,
);

for (let index = 0; index < count; index += 1) {
  const step = seriesStep(planId, index, count, every);
  const plan = plans.find((item) => item.id === step.planId);
  const due = new Date(Date.now() + (dueInSeconds + step.extraSeconds) * 1000);
  assertSchedulable(plan, Math.floor(due.getTime() / 1000));
  const now = explain(plan, feeds, feeds.readAt, poolPrice);
  assertWorthScheduling(now, allowRevert);
  const release = new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(contractId))
    .setGas(1_000_000)
    .setFunction("release", new ContractFunctionParameters().addUint256(step.planId));
  const schedule = new ScheduleCreateTransaction()
    .setScheduledTransaction(release)
    .setPayerAccountId(AccountId.fromString(operatorId))
    .setAdminKey(key.publicKey)
    .setWaitForExpiry(true)
    .setExpirationTime(Timestamp.fromDate(due))
    .setScheduleMemo(`bandpay release ${step.planId}`);
  const response = await schedule.execute(client);
  const receipt = await response.getReceipt(client);
  console.log(
    JSON.stringify({
      planId: step.planId,
      ifReleasedNow: now,
      status: receipt.status.toString(),
      scheduleId: receipt.scheduleId?.toString() ?? null,
      transactionId: response.transactionId.toString(),
      due: due.toISOString(),
      allowRevert,
    }),
  );
}
client.close();
