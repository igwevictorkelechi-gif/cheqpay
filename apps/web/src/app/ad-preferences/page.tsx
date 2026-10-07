"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2, MapPin } from "lucide-react";
import DesktopSidebar from "@/components/DesktopSidebar";
import { useToast } from "@/components/MobileUI";
import { api, type AdPrefs } from "@/services/api";

/**
 * Ad preferences: whether ads may use your activity and rough location, and
 * which kinds of ads you never want to see.
 */
export default function AdPreferencesPage() {
  const router = useRouter();
  const toast = useToast();
  const [prefs, setPrefs] = useState<AdPrefs | null>(null);
  const [cats, setCats] = useState<{ key: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getAdPrefs()
      .then((r) => {
        setPrefs(r.prefs);
        setCats(r.categories);
      })
      .catch(() => toast.show("Couldn't load your ad preferences."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(next: AdPrefs) {
    setPrefs(next);
    setSaving(true);
    try {
      setPrefs((await api.setAdPrefs(next)).prefs);
    } catch {
      toast.show("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function allowLocation() {
    if (!navigator.geolocation) return toast.show("Location isn't available on this device.");
    navigator.geolocation.getCurrentPosition(
      () => toast.show("Done — ads and offers can now be from places near you."),
      () => toast.show("Location is blocked. You can allow it in your browser settings."),
      { timeout: 8000, maximumAge: 30 * 60_000 },
    );
  }

  return (
    <div className="flex min-h-screen justify-center bg-black lg:bg-surface lg:pl-64">
      <DesktopSidebar />
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-10 pt-3 lg:max-w-3xl">
        <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink" aria-label="Go back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="mb-1 mt-6 text-3xl font-extrabold text-ink">Ad preferences</h1>
        <p className="text-sm text-muted">CheqPay shows a few ads from businesses. You choose how they&apos;re picked for you.</p>

        {!prefs ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
        ) : (
          <div className="mt-6 space-y-4">
            <button
              onClick={() => save({ ...prefs, personalised: !prefs.personalised })}
              className="flex w-full items-center gap-4 rounded-3xl bg-card p-4 text-left"
              aria-pressed={prefs.personalised}
            >
              <div className="min-w-0 flex-1">
                <p className="text-lg font-bold text-ink">Personalised ads</p>
                <p className="mt-0.5 text-sm text-muted">
                  {prefs.personalised
                    ? "Ads can match how you use CheqPay (e.g. paying bills) and, if you allow it, your rough location (about 5 km)."
                    : "Ads are only chosen by your state. We don't use your activity or location, and we deleted the location we had."}
                </p>
              </div>
              <span className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${prefs.personalised ? "justify-end bg-brand" : "justify-start bg-circle"}`}>
                <span className="h-5 w-5 rounded-full bg-white" />
              </span>
            </button>

            {prefs.personalised && (
              <button onClick={allowLocation} className="flex w-full items-center gap-3 rounded-3xl bg-card p-4 text-left">
                <MapPin className="h-5 w-5 shrink-0 text-brand-light" />
                <span className="text-sm text-ink">See ads and offers from places near you <span className="block text-xs text-muted">Uses your location while CheqPay is open. Never your exact spot.</span></span>
              </button>
            )}

            <div className="rounded-3xl bg-card p-4">
              <p className="text-lg font-bold text-ink">Never show me</p>
              <p className="mb-3 text-sm text-muted">Tap a type of ad to hide it.</p>
              <div className="flex flex-wrap gap-2">
                {cats.map((c) => {
                  const muted = prefs.mutedCategories.includes(c.key);
                  return (
                    <button
                      key={c.key}
                      onClick={() => save({ ...prefs, mutedCategories: muted ? prefs.mutedCategories.filter((x) => x !== c.key) : [...prefs.mutedCategories, c.key] })}
                      className={`rounded-full border px-3.5 py-2 text-sm font-semibold ${muted ? "border-red-400/50 bg-red-500/10 text-red-300" : "border-border text-muted"}`}
                    >
                      {muted && <Check className="-ml-0.5 mr-1 inline h-3.5 w-3.5" />}
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {saving && <p className="text-center text-xs text-muted">Saving…</p>}
          </div>
        )}
      </div>
    </div>
  );
}
