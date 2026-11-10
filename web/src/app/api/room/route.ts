import { NETWORKS, type Report, buildReport, checkHolder, handoverKit } from "satchel-nft";
import { REPORT_DEADLINE_MS, type RoomResponse, readRoomRequest, within } from "@/lib/room-request";

/**
 * The holder room's server route: the app's one API route, and the only place its server reads
 * NEAR (the pages read everything in your browser). Each request carries its own signed proof,
 * checked again from scratch at a final NEAR block: no cookie, no session, nothing stored.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// checkHolder's reads time out after 10 s each and the report after 20 s, so the route answers in time.
export const maxDuration = 60;

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  const parsed = await readRoomRequest(request);
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status);
  const net = NETWORKS[parsed.network];
  const checked = await checkHolder(net, parsed.proof);
  if (!checked.ok) return reply({ error: checked.reason }, checked.status);

  // The holder is in. The report is public and can fail on its own (an EVM RPC down); the room still opens.
  let report: Report | null = null;
  let reportError: string | undefined;
  try {
    report = await within(buildReport(net, checked.holder.tokenId), REPORT_DEADLINE_MS);
    if (report === null) reportError = `No satchel #${checked.holder.tokenId} on ${net.contract}`;
  } catch (err) {
    reportError = `Couldn't read the report: ${err instanceof Error ? err.message : String(err)}`;
  }
  const body: RoomResponse = {
    holder: checked.holder,
    satchel: checked.satchel,
    report,
    ...(reportError === undefined ? {} : { reportError }),
    kit: report === null ? null : handoverKit(report),
  };
  return reply(body);
}
