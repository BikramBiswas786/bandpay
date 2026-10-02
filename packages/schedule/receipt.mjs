import {
  AccountId,
  Client,
  PrivateKey,
  TopicId,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";
import { createRequire } from "node:module";
import { receiptMessage } from "./receipt.js";

const require = createRequire(import.meta.url);
const { currentNetwork } = require("../nextjs/lib/network.js");

const topicId = process.env.BANDPAY_TOPIC_ID;
const operatorId = process.env.HEDERA_OPERATOR_ID;
const operatorKey = process.env.HEDERA_OPERATOR_KEY;
const result = process.env.RESULT;
const planId = process.env.PLAN_ID;
const scheduleId = process.env.SCHEDULE_ID || "";

if (!topicId || !operatorId || !operatorKey || !result || planId === undefined) {
  throw new Error(
    "Set BANDPAY_TOPIC_ID, HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, PLAN_ID, and RESULT=paid|reverted|cancelled. Never commit the key.",
  );
}

const message = receiptMessage({ planId, result, scheduleId });
const net = currentNetwork();
const client = (net.name === "mainnet" ? Client.forMainnet() : Client.forTestnet()).setOperator(
  AccountId.fromString(operatorId),
  PrivateKey.fromStringECDSA(operatorKey),
);
const response = await new TopicMessageSubmitTransaction()
  .setTopicId(TopicId.fromString(topicId))
  .setMessage(message)
  .execute(client);
const receipt = await response.getReceipt(client);
console.log(JSON.stringify({ status: receipt.status.toString(), topicId, message }));
client.close();
