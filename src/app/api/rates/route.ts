import { getRates } from "@/lib/fx";

export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET() {
  try {
    return Response.json(await getRates());
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Exchange rates could not be loaded." },
      { status: 502 },
    );
  }
}
