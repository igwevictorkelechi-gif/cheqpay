import { forwardBanner } from "@/lib/bannerProxy";

// Server-side proxy to the backend admin home-banner endpoints.

export const dynamic = "force-dynamic";

export const GET = (req: Request) => forwardBanner(req, "", "GET");
export const POST = (req: Request) => forwardBanner(req, "", "POST");
