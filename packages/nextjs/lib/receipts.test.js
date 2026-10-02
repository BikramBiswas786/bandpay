const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeReceiptMessage } = require("./receipts");

function encoded(body) {
  return Buffer.from(JSON.stringify(body)).toString("base64");
}

test("decodes the three proof receipts", () => {
  const paid = decodeReceiptMessage(
    encoded({ template: "bandpay", planId: 1, result: "paid", scheduleId: "0.0.10820928" }),
  );
  assert.deepEqual(paid, { planId: 1, result: "paid", scheduleId: "0.0.10820928" });
  const refused = decodeReceiptMessage(
    encoded({ template: "bandpay", planId: 3, result: "reverted", scheduleId: "0.0.10830733" }),
  );
  assert.equal(refused.result, "reverted");
  const token = decodeReceiptMessage(
    encoded({ template: "bandpay", planId: 1, result: "paid", scheduleId: "0.0.10831792" }),
  );
  assert.equal(token.scheduleId, "0.0.10831792");
});

test("drops a message that is not a bandpay receipt", () => {
  assert.equal(
    decodeReceiptMessage(encoded({ template: "other", planId: 1, result: "paid" })),
    null,
  );
  assert.equal(decodeReceiptMessage(Buffer.from("not json").toString("base64")), null);
  assert.equal(decodeReceiptMessage(""), null);
});
