import { readFeeds } from "../../../lib/feeds";
import { explain, readPlans } from "../../../lib/plans";
import { MIRROR, SCHEDULES, loadBooks } from "../../../lib/books";

export const dynamic = "force-dynamic";

const RPC = "https://testnet.hashio.io/api";

async function readSchedule(item) {
  const [scheduleResponse, txResponse] = await Promise.all([
    fetch(`${MIRROR}/api/v1/schedules/${item.id}`, { cache: "no-store" }),
    fetch(`${MIRROR}/api/v1/transactions/${item.transactionId}`, { cache: "no-store" }),
  ]);
  const schedule = await scheduleResponse.json();
  const tx = await txResponse.json();
  const records = tx.transactions || [];
  const executed = records.find((row) => row.scheduled) || null;
  return {
    id: item.id,
    memo: schedule.memo ?? "",
    executed: Boolean(schedule.executed_timestamp),
    executedAt: schedule.executed_timestamp ?? null,
    deleted: Boolean(schedule.deleted),
    result: executed?.result ?? null,
    transactionId: item.transactionId,
  };
}

export async function GET() {
  try {
    const feeds = await readFeeds(RPC);
    const books = [];
    for (const book of await loadBooks()) {
      const plans = await readPlans(RPC, book.address);
      books.push({
        ...book,
        plans: plans.map((plan) => ({ ...plan, release: explain(plan, feeds, feeds.readAt) })),
      });
    }
    const schedules = [];
    for (const item of SCHEDULES) schedules.push(await readSchedule(item));
    return Response.json({ feeds, books, schedules });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Desk read failed" },
      { status: 502 },
    );
  }
}
