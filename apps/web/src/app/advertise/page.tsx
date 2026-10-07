"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, ImagePlus, Loader2, LocateFixed, Megaphone, MapPin, ShieldCheck, Sparkles, Tv, Users, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card, useToast } from "@/components/MobileUI";
import { useTransactionPin, PIN_CANCELLED } from "@/components/TransactionPinProvider";
import { downscaleToBase64 } from "@/lib/image";
import { useFeatures } from "@/lib/useFeatures";
import { api, ApiError, type AdOptions, type AdPlacement, type AdQuote, type AdTargeting, type AdVenueOption } from "@/services/api";

const CTAS = ["Learn more", "Shop now", "Order now", "Visit us", "Book now", "Sign up", "Call now", "Get offer"];

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const pretty = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });

function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition ${on ? "border-brand bg-brand/20 text-ink" : "border-border bg-card text-muted"}`}
    >
      {on && <Check className="-ml-0.5 mr-1 inline h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

/**
 * The campaign builder: what the ad says, where and when it runs, and who sees
 * it. The price, free slots and audience size update as you go; you pay from
 * your Naira balance with your PIN, and an admin reviews the ad before it runs.
 */
export default function AdvertisePage() {
  const router = useRouter();
  const toast = useToast();
  const features = useFeatures();
  const { authorize } = useTransactionPin();

  const [opts, setOpts] = useState<AdOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("food");
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [cta, setCta] = useState(CTAS[0]);
  const [placements, setPlacements] = useState<AdPlacement[]>(["receipt"]);
  const [venues, setVenues] = useState<string[]>([]);
  const [venueList, setVenueList] = useState<AdVenueOption[] | null>(null);
  const [venueState, setVenueState] = useState<string>("all");
  const [myVenues, setMyVenues] = useState<{ id: string; name: string; city: string }[]>([]);
  const [nearbyVenueId, setNearbyVenueId] = useState<string | null>(null);
  const [infOn, setInfOn] = useState(false);
  const [infPay, setInfPay] = useState("5000");
  const [infPosts, setInfPosts] = useState(5);
  const [infBrief, setInfBrief] = useState("");
  const [startDay, setStartDay] = useState("");
  const [days, setDays] = useState(7);
  const [t, setT] = useState<AdTargeting | null>(null);
  const [quote, setQuote] = useState<AdQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [locating, setLocating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .getAdOptions()
      .then((o) => {
        setOpts(o);
        setStartDay(o.today);
        setT(o.defaults);
        if (o.defaults.states[0]) setVenueState(o.defaults.states[0]);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Couldn't load the ad builder."));
  }, []);

  useEffect(() => {
    if (!opts) return;
    api
      .getAdVenues(venueState === "all" ? null : venueState)
      .then((r) => {
        setVenueList(r.venues);
        setMyVenues(r.myVenues);
      })
      .catch(() => setVenueList([]));
  }, [opts, venueState]);

  const adultOnly = opts?.categories.find((c) => c.key === category)?.adultOnly ?? false;
  useEffect(() => {
    if (adultOnly && t && t.ageMin < 18) setT({ ...t, ageMin: 18 });
  }, [adultOnly, t]);

  // Influencer posts, once the advertiser has filled them in properly.
  const infPayMinor = Math.round(Number(infPay.replace(/[^\d.]/g, "") || 0) * 100);
  const infValid = infOn && !!opts && infPayMinor >= Number(opts.influencer.minPayMinor) && infPosts >= 1 && infPosts <= opts.influencer.maxPosts && infBrief.trim().length >= 10;
  const influencer = useMemo(
    () => (infValid ? { payPerPostMinor: String(infPayMinor), posts: infPosts, brief: infBrief.trim() } : null),
    [infValid, infPayMinor, infPosts, infBrief],
  );

  // Price, availability and audience, refreshed as the form changes.
  useEffect(() => {
    if (!opts || !t || !startDay || (!placements.length && !venues.length && !nearbyVenueId && !influencer)) {
      setQuote(null);
      return;
    }
    setQuoting(true);
    const id = setTimeout(() => {
      api
        .quoteAd({ placements, venues, nearbyVenueId, influencer, startDay, days, category, targeting: t })
        .then((q) => {
          setQuote(q);
          setQuoteErr(null);
        })
        .catch((e) => {
          setQuote(null);
          setQuoteErr(e instanceof ApiError ? e.message : "Couldn't price this campaign.");
        })
        .finally(() => setQuoting(false));
    }, 450);
    return () => clearTimeout(id);
  }, [opts, t, startDay, days, placements, venues, nearbyVenueId, influencer, category]);

  async function pickImage(file: File | undefined) {
    if (!file) return;
    setImageBusy(true);
    try {
      const { base64, contentType } = await downscaleToBase64(file);
      setImage(`data:${contentType};base64,${base64}`);
    } catch {
      toast.show("Couldn't read that image. Try a JPG or PNG.");
    } finally {
      setImageBusy(false);
    }
  }

  function pinMyLocation(km: number) {
    if (!t) return;
    if (!navigator.geolocation) return toast.show("Location isn't available on this device.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setT({ ...t, radius: { lat: Math.round(p.coords.latitude * 1000) / 1000, lng: Math.round(p.coords.longitude * 1000) / 1000, km } });
        setLocating(false);
      },
      () => {
        toast.show("Allow location to target people near your business.");
        setLocating(false);
      },
      { timeout: 8000 },
    );
  }

  const toggle = <K,>(list: K[], v: K) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const linkOk = !linkUrl || /^https:\/\/[^\s/]+\.[^\s]+/.test(linkUrl.trim());
  const ready =
    !!quote && quote.audienceOk && quote.soldOut.length === 0 && businessName.trim().length >= 2 && headline.trim().length >= 3 && !!image && linkOk && (!infOn || infValid);

  async function pay() {
    if (!ready || !t || !quote) return;
    setPaying(true);
    try {
      await authorize(
        (pin) =>
          api.createAdCampaign(
            {
              businessName: businessName.trim(),
              headline: headline.trim(),
              body: body.trim(),
              image: image!,
              linkUrl: linkUrl.trim() || null,
              cta,
              category,
              placements,
              venues,
              nearbyVenueId,
              influencer,
              startDay,
              days,
              targeting: t,
            },
            pin,
          ),
        { title: "Pay for your ad", detail: `${quote.totalFormatted} for ${days} day${days === 1 ? "" : "s"}. Refunded in full if it isn't approved.` },
      );
      router.push("/advertise/campaigns?new=1");
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      toast.show(e instanceof ApiError ? e.message : "That didn't go through. Please try again.");
    } finally {
      setPaying(false);
    }
  }

  const input = "w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand";
  const endDay = useMemo(() => (startDay ? addDays(startDay, days - 1) : ""), [startDay, days]);

  if (!features.ads) {
    return (
      <AppShell>
        <div className="px-5 pt-16 text-center">
          <Megaphone className="mx-auto h-10 w-10 text-muted" />
          <p className="mt-3 font-bold text-ink">Advertising is coming soon</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between px-5 pt-4">
        <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link href="/advertise/campaigns" className="rounded-full bg-card px-4 py-2.5 text-sm font-bold text-ink">
          My campaigns
        </Link>
      </div>
      <div className="px-5 pt-3">
        <h1 className="text-2xl font-extrabold text-ink">Advertise on CheqPay</h1>
        <p className="mt-1 text-sm text-muted">Reach people where they pay — after a payment, on Pay bills, on partner screens and through creators. Every ad is reviewed before it runs.</p>
      </div>

      {!opts || !t ? (
        <div className="px-5 pt-6">
          {loadError ? <Card><p className="py-6 text-center text-sm text-muted">{loadError}</p></Card> : <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>}
        </div>
      ) : !opts.canAdvertise ? (
        <div className="px-5 pt-6">
          <Card>
            <div className="py-4 text-center">
              <ShieldCheck className="mx-auto h-9 w-9 text-brand-light" />
              <p className="mt-2 font-bold text-ink">Verify your identity to advertise</p>
              <p className="mt-1 text-sm text-muted">We only run ads from verified people and businesses.</p>
              <button onClick={() => router.push("/kyc")} className="mt-4 rounded-full bg-brand px-6 py-3 font-bold text-white">Verify now</button>
            </div>
          </Card>
        </div>
      ) : (
        <div className="space-y-4 px-5 pb-28 pt-4 lg:grid lg:grid-cols-[1fr_340px] lg:gap-6 lg:space-y-0">
          <div className="space-y-4">
            {/* 1. The ad */}
            <Card>
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-muted">1 · Your ad</p>
              <div className="space-y-3">
                <input value={businessName} onChange={(e) => setBusinessName(e.target.value.slice(0, 60))} placeholder="Business name" className={input} />
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={input} aria-label="Category">
                  {opts.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <div>
                  <input value={headline} onChange={(e) => setHeadline(e.target.value.slice(0, 40))} placeholder="Headline, e.g. 20% off jollof this week" className={input} />
                  <p className="mt-1 text-right text-xs text-muted">{headline.length}/40</p>
                </div>
                <div>
                  <textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, 120))} rows={2} placeholder="One line about the offer (optional)" className={input} />
                  <p className="mt-1 text-right text-xs text-muted">{body.length}/120</p>
                </div>
                <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card py-5 text-sm font-semibold text-muted">
                  {imageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  {image ? "Change image" : "Add an image (landscape, 1200 × 628 works best)"}
                </button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pickImage(e.target.files?.[0])} />
                <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="Link (optional) — https://…" className={`${input} ${linkOk ? "" : "border-red-500"}`} inputMode="url" />
                {!linkOk && <p className="text-xs text-red-400">Use a full link starting with https://</p>}
                <div className="flex flex-wrap gap-2">
                  {CTAS.map((c) => <Chip key={c} on={cta === c} onClick={() => setCta(c)}>{c}</Chip>)}
                </div>
              </div>
            </Card>

            {/* 2. Where */}
            <Card>
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-muted">2 · Where it shows</p>
              <div className="space-y-2">
                {opts.placements.map((p) => {
                  const on = placements.includes(p.key);
                  const full = quote?.soldOut.filter((s) => s.channel === `placement:${p.key}`).length ?? 0;
                  return (
                    <button key={p.key} type="button" onClick={() => setPlacements(toggle(placements, p.key))} className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left ${on ? "border-brand bg-brand/10" : "border-border"}`}>
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${on ? "border-brand bg-brand" : "border-border"}`}>{on && <Check className="h-4 w-4 text-white" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold text-ink">{p.label}</span>
                        <span className="block text-xs text-muted">{p.perDayFormatted} a day{on && full ? ` · fully booked on ${full} of your days` : ""}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm font-bold text-ink"><Tv className="h-4 w-4 text-brand-light" /> Screens at partner venues</p>
                <select value={venueState} onChange={(e) => setVenueState(e.target.value)} className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-ink" aria-label="Venue state">
                  <option value="all">All states</option>
                  {opts.states.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <p className="mt-1 text-xs text-muted">Your ad plays on TVs in gyms, restaurants and stores. You&apos;re only charged for days the screen was on for {opts.minScreenHours}+ hours.</p>
              <div className="mt-3 space-y-2">
                {venueList === null ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted" />
                ) : venueList.length === 0 ? (
                  <p className="rounded-2xl bg-circle px-4 py-3 text-sm text-muted">No partner screens {venueState === "all" ? "yet" : `in ${venueState} yet`}.</p>
                ) : (
                  venueList.map((v) => {
                    const on = venues.includes(v.id);
                    const full = quote?.soldOut.filter((s) => s.channel === `venue:${v.id}`).length ?? 0;
                    return (
                      <button key={v.id} type="button" onClick={() => setVenues(toggle(venues, v.id))} className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left ${on ? "border-brand bg-brand/10" : "border-border"}`}>
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${on ? "border-brand bg-brand" : "border-border"}`}>{on && <Check className="h-4 w-4 text-white" />}</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {v.photo ? <img src={v.photo} alt="" className="h-10 w-14 shrink-0 rounded-lg object-cover" /> : <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg bg-circle"><Tv className="h-4 w-4 text-muted" /></span>}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold text-ink">{v.name}</span>
                          <span className="block text-xs text-muted">{v.categoryLabel} · {v.city || v.state} · {v.perDayFormatted} a day{v.online ? " · ● on now" : ""}{on && full ? ` · fully booked on ${full} day${full === 1 ? "" : "s"}` : ""}</span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              {myVenues.length > 0 && (
                <div className="mt-5">
                  <p className="flex items-center gap-2 text-sm font-bold text-ink"><MapPin className="h-4 w-4 text-brand-light" /> Feature my venue in Nearby</p>
                  <p className="mt-1 text-xs text-muted">Your place is pinned at the top of &quot;Places near you&quot; with this ad, for people nearby. {opts.nearby.perDayFormatted} a day.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Chip on={!nearbyVenueId} onClick={() => setNearbyVenueId(null)}>Don&apos;t feature</Chip>
                    {myVenues.map((v) => <Chip key={v.id} on={nearbyVenueId === v.id} onClick={() => setNearbyVenueId(v.id)}>{v.name}</Chip>)}
                  </div>
                </div>
              )}
              <div className="mt-5 border-t border-border pt-4">
                <button type="button" onClick={() => setInfOn(!infOn)} className="flex w-full items-center justify-between gap-3 text-left">
                  <span>
                    <span className="flex items-center gap-2 text-sm font-bold text-ink"><Sparkles className="h-4 w-4 text-brand-light" /> Influencer posts</span>
                    <span className="mt-0.5 block text-xs text-muted">CheqPay creators post about you on their socials. You only pay for posts we approve — unused posts are refunded.</span>
                  </span>
                  <span className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition ${infOn ? "bg-brand" : "bg-border"}`}>
                    <span className={`h-5 w-5 rounded-full bg-white transition ${infOn ? "translate-x-5" : ""}`} />
                  </span>
                </button>
                {infOn && (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-semibold text-muted">Pay per post (₦)
                        <input inputMode="numeric" value={infPay} onChange={(e) => setInfPay(e.target.value.replace(/[^\d]/g, ""))} className={`${input} mt-1`} />
                      </label>
                      <label className="text-xs font-semibold text-muted">Number of posts
                        <input inputMode="numeric" value={infPosts || ""} onChange={(e) => setInfPosts(Math.min(opts.influencer.maxPosts, Number(e.target.value.replace(/[^\d]/g, "") || 0)))} className={`${input} mt-1`} />
                      </label>
                    </div>
                    {infPayMinor > 0 && infPayMinor < Number(opts.influencer.minPayMinor) && <p className="text-xs text-amber-400">Pay at least {opts.influencer.minPayFormatted} a post.</p>}
                    <label className="block text-xs font-semibold text-muted">What should they post?
                      <textarea value={infBrief} onChange={(e) => setInfBrief(e.target.value.slice(0, 1000))} rows={3} placeholder="e.g. Show our jollof in a short video, mention 20% off this week and tag @mamaput" className={`${input} mt-1 resize-none`} />
                    </label>
                    <p className="text-xs text-muted">Creators see your brief and ad image. Each approved post pays the creator your amount; CheqPay adds {opts.influencer.feePercent}% on top.</p>
                  </div>
                )}
              </div>
            </Card>

            {/* 3. When */}
            <Card>
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-muted">3 · When</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-muted">Start
                  <input type="date" value={startDay} min={opts.today} max={addDays(opts.today, 90)} onChange={(e) => setStartDay(e.target.value)} className={`${input} mt-1`} />
                </label>
                <label className="text-xs font-semibold text-muted">Days
                  <input type="number" value={days} min={1} max={opts.maxDays} onChange={(e) => setDays(Math.min(opts.maxDays, Math.max(1, Number(e.target.value) || 1)))} className={`${input} mt-1`} />
                </label>
              </div>
              {endDay && <p className="mt-2 text-sm text-muted">Runs {pretty(startDay)} → {pretty(endDay)}</p>}
            </Card>

            {/* 4. Who */}
            <Card>
              <p className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-muted">4 · Who sees it</p>
              <p className="mb-3 text-xs text-muted">Sensible defaults are set. Narrow it to reach the people most likely to buy. (Venue screens show to everyone at the venue; time of day still applies.)</p>

              <p className="mb-2 text-sm font-bold text-ink">Location</p>
              <div className="mb-2 flex flex-wrap gap-2">
                <Chip on={t.states.length === 0 && !t.radius} onClick={() => setT({ ...t, states: [], radius: null })}>Anywhere in Nigeria</Chip>
                {t.states.map((s) => <Chip key={s} on onClick={() => setT({ ...t, states: t.states.filter((x) => x !== s) })}>{s} <X className="ml-1 inline h-3 w-3" /></Chip>)}
              </div>
              <select value="" onChange={(e) => e.target.value && setT({ ...t, states: [...new Set([...t.states, e.target.value])] })} className={input} aria-label="Add a state">
                <option value="">+ Add a state</option>
                {opts.states.filter((s) => !t.states.includes(s)).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <div className="mt-3 rounded-2xl bg-circle p-3">
                {t.radius ? (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-ink">Within <b>{t.radius.km} km</b> of your business</span>
                    <span className="flex gap-1">
                      {[2, 5, 10, 25].map((km) => <Chip key={km} on={t.radius!.km === km} onClick={() => setT({ ...t, radius: { ...t.radius!, km } })}>{km}km</Chip>)}
                      <button onClick={() => setT({ ...t, radius: null })} className="px-2 text-muted" aria-label="Remove distance"><X className="h-4 w-4" /></button>
                    </span>
                  </div>
                ) : (
                  <button type="button" onClick={() => pinMyLocation(5)} className="flex items-center gap-2 text-sm font-semibold text-brand-light">
                    {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />} Only people near me (I&apos;m at my business now)
                  </button>
                )}
              </div>

              <p className="mb-2 mt-4 text-sm font-bold text-ink">Age</p>
              <div className="flex items-center gap-2">
                <input type="number" value={t.ageMin} min={adultOnly ? 18 : 13} max={t.ageMax} onChange={(e) => setT({ ...t, ageMin: Math.max(adultOnly ? 18 : 13, Number(e.target.value) || 18) })} className={`${input} w-24`} aria-label="Minimum age" />
                <span className="text-muted">to</span>
                <input type="number" value={t.ageMax} min={t.ageMin} max={100} onChange={(e) => setT({ ...t, ageMax: Math.min(100, Number(e.target.value) || 65) })} className={`${input} w-24`} aria-label="Maximum age" />
                {adultOnly && <span className="text-xs text-muted">18+ for this category</span>}
              </div>

              <p className="mb-2 mt-4 text-sm font-bold text-ink">Interests <span className="font-normal text-muted">(from how people use CheqPay)</span></p>
              <div className="flex flex-wrap gap-2">
                {opts.segments.map((s) => <Chip key={s.key} on={t.segments.includes(s.key)} onClick={() => setT({ ...t, segments: toggle(t.segments, s.key) })}>{s.label}</Chip>)}
              </div>

              <p className="mb-2 mt-4 text-sm font-bold text-ink">Time of day</p>
              <div className="flex flex-wrap gap-2">
                <Chip on={t.dayparts.length === 0} onClick={() => setT({ ...t, dayparts: [] })}>All day</Chip>
                {opts.dayparts.map((d) => <Chip key={d.key} on={t.dayparts.includes(d.key)} onClick={() => setT({ ...t, dayparts: toggle(t.dayparts, d.key) })}>{d.label}</Chip>)}
              </div>

              <p className="mb-2 mt-4 text-sm font-bold text-ink">Devices</p>
              <div className="flex flex-wrap gap-2">
                <Chip on={t.platforms.length === 0} onClick={() => setT({ ...t, platforms: [] })}>All</Chip>
                {[["android", "Android"], ["ios", "iPhone"], ["web", "Web"]].map(([k, l]) => <Chip key={k} on={t.platforms.includes(k)} onClick={() => setT({ ...t, platforms: toggle(t.platforms, k) })}>{l}</Chip>)}
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-ink">Only new CheqPay users <span className="block text-xs font-normal text-muted">Joined in the last 30 days</span></span>
                <Chip on={t.newUsersOnly} onClick={() => setT({ ...t, newUsersOnly: !t.newUsersOnly })}>{t.newUsersOnly ? "On" : "Off"}</Chip>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-ink">Times a day one person sees it</span>
                <select value={t.frequencyCap} onChange={(e) => setT({ ...t, frequencyCap: Number(e.target.value) })} className="rounded-xl border border-border bg-card px-3 py-2 text-ink" aria-label="Frequency cap">
                  {Array.from({ length: opts.maxFrequencyCap }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </Card>
          </div>

          {/* Preview + summary */}
          <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <div className="overflow-hidden rounded-3xl bg-card">
              <p className="px-4 pt-3 text-[11px] font-semibold text-muted">Sponsored · <span className="text-ink">{businessName || "Your business"}</span></p>
              <div className="p-4 pt-3">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" className="aspect-[1.91/1] w-full rounded-2xl object-cover" />
                ) : (
                  <div className="flex aspect-[1.91/1] w-full items-center justify-center rounded-2xl bg-circle text-sm text-muted">Your image</div>
                )}
                <div className="mt-3 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-ink">{headline || "Your headline"}</p>
                    {body && <p className="mt-0.5 text-sm text-muted">{body}</p>}
                  </div>
                  {linkUrl && <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand px-3.5 py-2 text-xs font-bold text-white">{cta} <ArrowUpRight className="h-3.5 w-3.5" /></span>}
                </div>
              </div>
            </div>

            <Card>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/15 text-brand-light"><Users className="h-5 w-5" /></span>
                <div>
                  <p className="text-lg font-extrabold text-ink">{quote ? (quote.audience === null ? (venues.length || nearbyVenueId ? "People at the venues" : "Creators' followers") : `≈ ${quote.audience.toLocaleString("en-NG")} people`) : "—"}</p>
                  <p className="text-xs text-muted">{quote?.audience === null ? (venues.length || nearbyVenueId ? "Screens and Nearby reach whoever is there" : "Influencer posts reach each creator's audience") : "match your targeting in the app today"}</p>
                </div>
                {quoting && <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted" />}
              </div>
              {quote && !quote.audienceOk && <p className="mt-2 text-xs text-amber-400">That&apos;s fewer than {quote.minAudience} people — widen your targeting to run this ad.</p>}
              {quoteErr && <p className="mt-2 text-xs text-red-400">{quoteErr}</p>}
              {quote && (
                <div className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
                  {quote.lines.map((l) => (
                    <div key={l.channel} className="flex justify-between gap-3">
                      <span className="text-muted">{l.label} × {l.days}{l.unit === "post" ? ` post${l.days === 1 ? "" : "s"}` : "d"}</span>
                      <span className="font-semibold text-ink">{l.totalFormatted}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-border pt-2 text-base">
                    <span className="font-bold text-ink">Total</span>
                    <span className="font-extrabold text-ink">{quote.totalFormatted}</span>
                  </div>
                  {quote.soldOut.length > 0 && <p className="text-xs text-red-400">Some days are fully booked — change the dates or untick that place.</p>}
                </div>
              )}
              <p className="mt-3 text-xs text-muted">Paid from your Naira balance. If your ad isn&apos;t approved you get every naira back, and you can stop it any time for a refund of the days left.</p>
            </Card>
            <div>
              <button onClick={pay} disabled={!ready || paying || quoting} className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white disabled:opacity-40">
                {paying && <Loader2 className="h-4 w-4 animate-spin" />}
                {quote ? `Pay ${quote.totalFormatted} & send for review` : "Pay & send for review"}
              </button>
              {!ready && quote && <p className="mt-1.5 text-center text-xs text-muted">{!image ? "Add an image to continue" : headline.trim().length < 3 ? "Add a headline to continue" : businessName.trim().length < 2 ? "Add your business name to continue" : !linkOk ? "Fix the link" : infOn && !infValid ? "Finish the influencer posts (pay, number and what to post)" : ""}</p>}
            </div>
          </div>

        </div>
      )}
    </AppShell>
  );
}
