import { forward } from "@/lib/forward";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => forward(req, "/api/admin/developers/reconciliation", "GET");
