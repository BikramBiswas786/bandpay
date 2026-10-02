/** The HCS body for one attempt. Hedera caps a topic message at 1024 bytes. */

export function receiptMessage({ planId, result, scheduleId }) {
  const allowed = new Set(["paid", "reverted", "cancelled"]);
  if (!allowed.has(result)) throw new Error("result must be paid, reverted, or cancelled.");
  const id = Number(planId);
  if (!Number.isInteger(id) || id < 0) throw new Error("planId must be a plan number.");
  const schedule = scheduleId ? String(scheduleId) : "";
  const body = JSON.stringify({ template: "bandpay", planId: id, result, scheduleId: schedule });
  if (Buffer.byteLength(body) > 1024) throw new Error("HCS message is over 1024 bytes.");
  return body;
}
