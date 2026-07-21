"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { api } from "@/services/api";

type Popup = {
  id: string;
  title: string;
  message: string;
  imageUrl: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
};

const DISMISSED_KEY = "cheqpay:popup:dismissed";

/**
 * Admin-published announcement/promo modal. Shown once per popup id —
 * dismissing stores the id, and a newly published popup (fresh id) shows again.
 */
export default function PromoPopup() {
  const router = useRouter();
  const [popup, setPopup] = useState<Popup | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getPopup()
      .then(({ popup }) => {
        if (!active || !popup) return;
        if (localStorage.getItem(DISMISSED_KEY) === popup.id) return;
        setPopup(popup);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!popup) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, popup.id);
    setPopup(null);
  };

  const onButton = () => {
    const url = popup.buttonUrl?.trim();
    dismiss();
    if (!url) return;
    if (url.startsWith("/")) router.push(url);
    else if (url.startsWith("https://")) window.open(url, "_blank", "noopener");
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/70" onClick={dismiss} aria-hidden="true" />
      <div className="relative w-full max-w-[340px] overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
        <button
          onClick={dismiss}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
        >
          <X className="h-4 w-4" />
        </button>
        {popup.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={popup.imageUrl} alt="" className="h-40 w-full object-cover" />
        )}
        <div className="p-5">
          <p className="text-base font-bold text-ink">{popup.title}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{popup.message}</p>
          <button
            onClick={onButton}
            className="mt-4 w-full rounded-full bg-gradient-to-r from-brand to-brand-light py-3 text-sm font-bold text-white"
          >
            {popup.buttonText || "Got it"}
          </button>
        </div>
      </div>
    </div>
  );
}
