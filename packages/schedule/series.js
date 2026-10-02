/** Pure instalment math. schedule.mjs signs one wait-for-expiry schedule per step. */

export function seriesStep(startId, index, count, everySeconds) {
  const plans = Number(count);
  const every = Number(everySeconds || 0);
  const start = Number(startId);
  const step = Number(index);
  if (!Number.isInteger(plans) || plans < 1 || plans > 12) {
    throw new Error("COUNT must be 1 to 12.");
  }
  if (!Number.isInteger(start) || start < 0) throw new Error("PLAN_ID must be a plan number.");
  if (!Number.isInteger(step) || step < 0 || step >= plans) {
    throw new Error("Instalment index is out of range.");
  }
  if (plans > 1 && (!Number.isInteger(every) || every <= 0)) {
    throw new Error("EVERY_SECONDS is required when COUNT is more than 1.");
  }
  return { planId: start + step, extraSeconds: step * every };
}
