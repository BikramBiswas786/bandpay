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

/** Hedera refuses a schedule whose expiration is more than 62 days out. */
export const MAX_SCHEDULE_SECONDS = 62 * 24 * 60 * 60;

export function assertSeriesFits(dueInSeconds, count, everySeconds) {
  const due = Number(dueInSeconds);
  const plans = Number(count);
  const every = Number(everySeconds || 0);
  if (!Number.isInteger(due) || due < 0)
    throw new Error("DUE_IN_SECONDS must be a non-negative integer.");
  const last = seriesStep(0, Math.max(plans, 1) - 1, plans, every);
  if (due + last.extraSeconds > MAX_SCHEDULE_SECONDS) {
    throw new Error(
      "The last instalment is more than 62 days out. Hedera will not create that schedule.",
    );
  }
}
