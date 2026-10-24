import { forwardBanner } from "@/lib/bannerProxy";

export const dynamic = "force-dynamic";

export const PUT = (req: Request) => forwardBanner(req, "/order", "PUT");
