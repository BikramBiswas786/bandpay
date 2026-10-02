import { readFeeds } from "../../../lib/feeds";
import { explain, readPlans } from "../../../lib/plans";

export const dynamic = "force-dynamic";

const RPC = "https://testnet.hashio.io/api";
const MIRROR = "https://testnet.mirrornode.hedera.com";

const BOOKS = [
  {
    id: "0.0.10820921",
    address: "0x87aca0b7ad05e10f7ce953827d9a8b3a8231d9b2",
    note: "HBAR. The wait-for-expiry schedule called release here.",
  },
  {
    id: "0.0.10823213",
    address: "0xa0F8f874341C54C89EE9A2178318Cfa504da7705",
    note: "HTS. associate, then fundToken, then cancel.",
  },
];

export async function GET() {
  try {
    const feeds = await readFeeds(RPC);
    const books = [];
    for (const book of BOOKS) {
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
