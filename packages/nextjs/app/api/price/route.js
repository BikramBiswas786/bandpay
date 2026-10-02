import { readFeeds } from "../../../lib/feeds";

export const dynamic = "force-dynamic";

const RPC = "https://testnet.hashio.io/api";

export async function GET() {
  try {
    const feeds = await readFeeds(RPC);
    return Response.json(feeds);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Price read failed" }, { status: 502 });
  }
}
