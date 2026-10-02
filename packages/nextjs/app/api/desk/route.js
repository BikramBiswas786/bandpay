import { readFeeds } from "../../../lib/feeds";
import { explain, readPlans } from "../../../lib/plans";
import { MIRROR, loadBooks } from "../../../lib/books";

export const dynamic = "force-dynamic";

const RPC = "https://testnet.hashio.io/api";

export async function GET() {
  try {
    const feeds = await readFeeds(RPC);
    const books = [];
    for (const book of await loadBooks()) {
      const plans = await readPlans(RPC, book.address);
      books.push({
        ...book,
        plans: plans.map(plan => ({ ...plan, release: explain(plan, feeds, feeds.readAt) })),
      });
    }
    const scheduleResponse = await fetch(`${MIRROR}/api/v1/schedules/0.0.10820928`);
    const schedule = await scheduleResponse.json();
    return Response.json({
      feeds,
      books,
      schedule: {
        id: "0.0.10820928",
        memo: schedule.memo ?? "",
        executed: Boolean(schedule.executed_timestamp),
        executedAt: schedule.executed_timestamp ?? null,
        deleted: Boolean(schedule.deleted),
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Desk read failed" }, { status: 502 });
  }
}
