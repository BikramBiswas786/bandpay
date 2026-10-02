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

const operatorId = process.env.HEDERA_OPERATOR_ID;
const operatorKey = process.env.HEDERA_OPERATOR_KEY;
const contractId = process.env.BANDPAY_CONTRACT_ID;
const planId = process.env.PLAN_ID;
const dueInSeconds = Number(process.env.DUE_IN_SECONDS || "3600");

if (!operatorId || !operatorKey || !contractId || planId === undefined) {
  throw new Error("Set HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, BANDPAY_CONTRACT_ID, and PLAN_ID. Never commit the key.");
}

const key = PrivateKey.fromStringECDSA(operatorKey);
const client = Client.forTestnet().setOperator(AccountId.fromString(operatorId), key);
const due = new Date(Date.now() + dueInSeconds * 1000);

const release = new ContractExecuteTransaction()
  .setContractId(ContractId.fromString(contractId))
  .setGas(300_000)
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
