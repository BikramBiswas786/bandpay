/** What the sign form may send. Hedera refuses a schedule more than 62 days out. */

const MAX_SCHEDULE_SECONDS = 62 * 24 * 60 * 60;

function bandError({ amount, minutes, min, max }) {
  const hbar = String(amount);
  const dueMinutes = String(minutes);
  const low = String(min);
  const high = String(max);
  if (!/^\d+(\.\d{1,8})?$/.test(hbar) || Number(hbar) <= 0) {
    return "Amount must be more than 0 HBAR.";
  }
  if (!/^\d+$/.test(dueMinutes)) return "Due time must be a whole number of minutes, zero or more.";
  if (Number(dueMinutes) * 60 > MAX_SCHEDULE_SECONDS) {
    return "Due time is more than 62 days out. Hedera will not create that schedule.";
  }
  if (!/^\d+(\.\d{1,8})?$/.test(low) || !/^\d+(\.\d{1,8})?$/.test(high)) {
    return "Invalid band. Use a USD amount.";
  }
  if (Number(high) < Number(low)) return "Invalid band. Min is above max.";
  return "";
}

module.exports = { MAX_SCHEDULE_SECONDS, bandError };
