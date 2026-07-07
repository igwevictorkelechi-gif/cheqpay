"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Send, Sparkles } from "lucide-react";
import { api, ApiError } from "@/services/api";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const GREETING: ChatMessage = {
  role: "assistant",
  content:
    "Hi, I’m Cheq — your CheqPay assistant. Ask me anything about deposits, withdrawals, crypto, bills or your account. How can I help?",
};

const SUGGESTIONS = [
  "How do I fund my account?",
  "Where is my electricity token?",
  "How long do withdrawals take?",
  "What are the fees?",
];

export default function SupportChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setInput("");
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setSending(true);
    try {
      // The greeting is client-side flavour; the API needs a user-first thread.
      const thread = next.slice(1).slice(-20);
      const res = await api.supportChat(thread);
      setMessages([...next, { role: "assistant", content: res.reply }]);
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 401
          ? "Your session has expired — please sign in again to chat."
          : "I couldn’t send that. Check your connection and try again, or email support@cheqpay.com.";
      setMessages([...next, { role: "assistant", content: msg }]);
    } finally {
      setSending(false);
    }
  }

  const showSuggestions = messages.length === 1 && !sending;

  return (
    <div className="flex min-h-screen w-full justify-center bg-black">
      <div className="flex min-h-screen w-full max-w-[480px] flex-col bg-surface">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-surface px-5 py-4">
          <button
            onClick={() => router.back()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink active:scale-95"
            aria-label="Go back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-light">
            <Sparkles className="h-5 w-5 text-white" />
          </span>
          <div>
            <p className="font-bold text-ink">Cheq · AI assistant</p>
            <p className="text-xs text-muted">Answers from our help center</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "rounded-br-md bg-gradient-to-r from-brand to-brand-light text-white"
                    : "rounded-bl-md bg-card text-ink"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-card px-4 py-3">
                <span className="inline-flex gap-1">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted"
                      style={{ animationDelay: `${d * 150}ms` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          )}
          {showSuggestions && (
            <div className="flex flex-wrap gap-2 pt-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold text-ink active:scale-95"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-surface px-4 py-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question…"
            maxLength={2000}
            className="h-12 flex-1 rounded-2xl border border-border bg-card px-4 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/50"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-brand to-brand-light text-white active:scale-95 disabled:opacity-40"
          >
            <Send className="h-5 w-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
