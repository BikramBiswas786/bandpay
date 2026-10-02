/** Mirror topic messages are base64. A bad body is ignored, not thrown. */
function decodeReceiptMessage(encoded) {
  if (!encoded) return null;
  try {
    const body = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (!body || body.template !== "bandpay") return null;
    if (!["paid", "reverted", "cancelled"].includes(body.result)) return null;
    const planId = Number(body.planId);
    if (!Number.isInteger(planId) || planId < 0) return null;
    return {
      planId,
      result: body.result,
      scheduleId: body.scheduleId ? String(body.scheduleId) : "",
    };
  } catch {
    return null;
  }
}

module.exports = { decodeReceiptMessage };
