import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { buildSupportSystemPrompt } from "@/lib/supportFaq";

export const dynamic = "force-dynamic";
// Model replies can take a while; give the function headroom on Vercel.
export const maxDuration = 60;

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(2_000),
      })
    )
    .min(1)
    .max(24),
});

const HUMAN_FALLBACK =
  "I can’t answer that right now. Please email support@cheqpay.com with your registered email and transaction reference — the team replies within 24 hours.";

/**
 * AI support agent. Answers user questions from the CheqPay FAQ knowledge
 * base. Degrades gracefully (routes to human support) when the model is
 * unavailable or the API key isn't configured.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    enforceRateLimit(`support:chat:${auth.id}`, 15, 60_000);

    const body = chatSchema.parse(await req.json());
    if (body.messages[body.messages.length - 1].role !== "user") {
      throw new ApiError(422, "The last message must be from the user", "bad_messages");
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Agent not configured — never error the support surface; hand off.
      return jsonOk({ reply: HUMAN_FALLBACK, agent: false });
    }

    const client = new Anthropic({ apiKey });
    try {
      const response = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 600,
        system: buildSupportSystemPrompt(),
        messages: body.messages,
      });
      const reply = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      return jsonOk({ reply: reply || HUMAN_FALLBACK, agent: true });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        return jsonOk({
          reply:
            "Our assistant is handling a lot of chats right now — please try again in a minute, or email support@cheqpay.com.",
          agent: false,
        });
      }
      console.error("[support/chat] model call failed", err);
      return jsonOk({ reply: HUMAN_FALLBACK, agent: false });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
