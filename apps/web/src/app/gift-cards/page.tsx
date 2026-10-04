"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, CheckCircle2, ChevronRight, History, Loader2, Search, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/MobileUI";
import { downscaleToBase64 } from "@/lib/image";
import { api, ApiError, type GiftCardBrand, type GiftCardRate, type GiftCardTrade } from "@/services/api";

const inputCls =
  "w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand";

/** A steady colour per brand, for the logo tile when there's no logo image. */
const TILE_COLORS = ["#F59E0B", "#6B5B95", "#2563EB", "#16A34A", "#DC2626", "#0EA5A0", "#DB2777", "#7C3AED"];
function tileColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}

function BrandTile({ brand, size = 48 }: { brand: { name: string; logoUrl: string | null }; size?: number }) {
  if (brand.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={brand.logoUrl} alt="" width={size} height={size} className="rounded-2xl object-cover" style={{ width: size, height: size }} />;
  }
  const initials = brand.name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-2xl font-extrabold text-white"
      style={{ width: size, height: size, background: tileColor(brand.name), fontSize: size * 0.36 }}
    >
      {initials || "GC"}
    </span>
  );
}

function formatNaira(minor: bigint): string {
  const naira = Number(minor) / 100;
  return `₦${naira.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

type Step = "brand" | "details" | "card" | "review" | "done";

export default function GiftCardsPage() {
  const router = useRouter();
  const [brands, setBrands] = useState<GiftCardBrand[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [step, setStep] = useState<Step>("brand");
  const [brand, setBrand] = useState<GiftCardBrand | null>(null);
  const [country, setCountry] = useState<string>("");
  const [cardType, setCardType] = useState<"PHYSICAL" | "ECODE" | "">("");
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<{ id: string; preview: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [trade, setTrade] = useState<GiftCardTrade | null>(null);
  // One key per card being submitted, so a double tap or retry never makes two trades.
  const submitKey = useRef<string>("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .getGiftCardRates()
      .then(({ brands }) => setBrands(brands))
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : "Couldn't load gift cards.");
        setBrands([]);
      });
  }, []);

  const countries = useMemo(() => {
    const seen = new Map<string, GiftCardRate>();
    for (const r of brand?.rates ?? []) if (!seen.has(r.country)) seen.set(r.country, r);
    return [...seen.values()];
  }, [brand]);
  const types = useMemo(() => (brand?.rates ?? []).filter((r) => r.country === country), [brand, country]);
  const rate = types.find((r) => r.cardType === cardType) ?? null;
  const face = Math.trunc(Number(amount) || 0);
  const inRange = !!rate && face >= rate.minValue && face <= rate.maxValue;
  const payout = rate && face > 0 ? BigInt(face) * BigInt(rate.rateMinor) : 0n;

  function pickBrand(b: GiftCardBrand) {
    setBrand(b);
    const firstCountry = b.rates[0]?.country ?? "";
    setCountry(firstCountry);
    const t = b.rates.filter((r) => r.country === firstCountry);
    setCardType(t.length === 1 ? t[0].cardType : "");
    setAmount("");
    setStep("details");
  }

  function reset() {
    setStep("brand");
    setBrand(null);
    setAmount("");
    setCode("");
    setPin("");
    setNote("");
    setPhotos([]);
    setTrade(null);
    setFormError(null);
    submitKey.current = "";
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setFormError(null);
    try {
      for (const file of Array.from(files).slice(0, 6 - photos.length)) {
        const { base64, contentType } = await downscaleToBase64(file);
        const { id } = await api.uploadGiftCardPhoto(base64, contentType);
        setPhotos((p) => [...p, { id, preview: `data:${contentType};base64,${base64}` }]);
      }
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Couldn't upload that photo. Try another.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit() {
    if (!rate) return;
    setSubmitting(true);
    setFormError(null);
    if (!submitKey.current) submitKey.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    try {
      const res = await api.submitGiftCardTrade(
        {
          rateId: rate.id,
          faceValue: face,
          fileIds: photos.map((p) => p.id),
          ...(code.trim() ? { code: code.trim() } : {}),
          ...(pin.trim() ? { pin: pin.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        submitKey.current,
      );
      setTrade(res.trade);
      setStep("done");
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Couldn't submit your card. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const back = () => {
    if (step === "details") setStep("brand");
    else if (step === "card") setStep("details");
    else if (step === "review") setStep("card");
    else router.push("/pay-bill");
  };

  const shown = (brands ?? []).filter((b) => b.name.toLowerCase().includes(query.trim().toLowerCase()));
  const sym = rate?.symbol ?? types[0]?.symbol ?? countries[0]?.symbol ?? "$";

  return (
    <AppShell>
      <div className="flex items-center justify-between px-5 pt-4">
        <button onClick={back} className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button
          onClick={() => router.push("/gift-cards/trades")}
          className="flex min-h-[44px] items-center gap-1.5 rounded-full bg-card px-4 text-sm font-semibold text-ink"
        >
          <History className="h-4 w-4" /> My trades
        </button>
      </div>

      <h1 className="mt-3 px-5 text-2xl font-extrabold text-ink">
        {step === "brand" ? "Sell gift cards" : step === "done" ? "Card submitted" : brand?.name}
      </h1>
      <p className="mb-5 mt-1 px-5 text-sm text-muted">
        {step === "brand"
          ? "Trade your gift cards for Naira, paid straight into your balance."
          : step === "details"
            ? "Where is the card from, and how much is it worth?"
            : step === "card"
              ? "Add clear photos of the card, or type its code."
              : step === "review"
                ? "Check everything before you submit."
                : "We're checking your card now."}
      </p>

      {step === "brand" && (
        <div className="px-5 pb-10">
          {brands === null ? (
            <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
          ) : error ? (
            <Card><p className="py-6 text-center text-sm text-muted">{error}</p></Card>
          ) : brands.length === 0 ? (
            <Card><p className="py-6 text-center text-sm text-muted">We aren&apos;t buying gift cards right now. Check back soon.</p></Card>
          ) : (
            <>
              <div className="relative mb-4">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input className={`${inputCls} pl-11`} placeholder="Search cards" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {shown.map((b) => {
                  const best = b.rates.reduce((m, r) => (BigInt(r.rateMinor) > BigInt(m.rateMinor) ? r : m), b.rates[0]);
                  return (
                    <button key={b.id} onClick={() => pickBrand(b)} className="flex flex-col gap-3 rounded-3xl bg-card p-4 text-left transition active:scale-95">
                      <BrandTile brand={b} />
                      <div>
                        <p className="font-bold text-ink">{b.name}</p>
                        <p className="mt-0.5 text-xs text-muted">Up to {best.rateFormatted}/{best.symbol.trim() || best.currency}1</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {step === "details" && brand && (
        <div className="space-y-5 px-5 pb-10">
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Card country</p>
            <div className="flex flex-wrap gap-2">
              {countries.map((c) => (
                <button
                  key={c.country}
                  onClick={() => {
                    setCountry(c.country);
                    const t = brand.rates.filter((r) => r.country === c.country);
                    setCardType(t.length === 1 ? t[0].cardType : "");
                  }}
                  className={`min-h-[44px] rounded-full px-4 text-sm font-semibold ${country === c.country ? "bg-brand text-white" : "bg-card text-ink"}`}
                >
                  {c.countryName} ({c.currency})
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Card type</p>
            <div className="grid grid-cols-2 gap-2">
              {types.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setCardType(t.cardType)}
                  className={`rounded-2xl p-4 text-left ${cardType === t.cardType ? "bg-brand text-white" : "bg-card text-ink"}`}
                >
                  <p className="font-bold">{t.cardType === "ECODE" ? "E-code" : "Physical card"}</p>
                  <p className={`mt-0.5 text-xs ${cardType === t.cardType ? "text-white/80" : "text-muted"}`}>{t.rateFormatted} per {t.symbol.trim()}1</p>
                </button>
              ))}
            </div>
          </div>
          {rate && (
            <div>
              <p className="mb-2 text-sm font-semibold text-ink">Card value ({rate.currency})</p>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-semibold text-muted">{sym.trim()}</span>
                <input
                  className={`${inputCls} pl-12 text-lg font-bold`}
                  inputMode="numeric"
                  placeholder={`${rate.minValue} – ${rate.maxValue}`}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                />
              </div>
              <p className={`mt-2 text-xs ${face > 0 && !inRange ? "text-red-400" : "text-muted"}`}>
                From {sym.trim()}{rate.minValue} to {sym.trim()}{rate.maxValue}
              </p>
              <Card className="mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">You&apos;ll get</span>
                  <span className="text-2xl font-extrabold text-ink">{inRange ? formatNaira(payout) : "—"}</span>
                </div>
                <p className="mt-1 text-xs text-muted">Rate: {rate.rateFormatted} per {sym.trim()}1. Locked when you submit.</p>
              </Card>
            </div>
          )}
          <button
            disabled={!rate || !inRange}
            onClick={() => setStep("card")}
            className="w-full rounded-full bg-brand py-4 font-bold text-white disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      )}

      {step === "card" && rate && (
        <div className="space-y-5 px-5 pb-10">
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Photos of the card</p>
            <div className="grid grid-cols-3 gap-2">
              {photos.map((p) => (
                <div key={p.id} className="relative aspect-square overflow-hidden rounded-2xl bg-card">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt="" className="h-full w-full object-cover" />
                  <button
                    onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))}
                    className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
                    aria-label="Remove photo"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {photos.length < 6 && (
                <button
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-border bg-card text-xs font-semibold text-muted"
                >
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                  {uploading ? "Uploading" : "Add photo"}
                </button>
              )}
            </div>
            <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
            <p className="mt-2 text-xs text-muted">
              {rate.cardType === "PHYSICAL"
                ? "Show the front and the scratched-off back with the code clearly visible, plus the receipt if you have it."
                : "A screenshot of the e-code email or page works."}
            </p>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Card code {photos.length ? "(optional)" : ""}</p>
            <input className={`${inputCls} font-mono`} placeholder="e.g. AQ12-ZZ34-HJ56" value={code} onChange={(e) => setCode(e.target.value.slice(0, 120))} autoComplete="off" />
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">PIN (if the card has one)</p>
            <input className={`${inputCls} font-mono`} placeholder="Optional" value={pin} onChange={(e) => setPin(e.target.value.slice(0, 60))} autoComplete="off" />
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Note for our team (optional)</p>
            <textarea className={inputCls} rows={2} placeholder="Anything we should know" value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} />
          </div>
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          <button
            disabled={uploading || (!photos.length && !code.trim())}
            onClick={() => setStep("review")}
            className="w-full rounded-full bg-brand py-4 font-bold text-white disabled:opacity-40"
          >
            Review
          </button>
        </div>
      )}

      {step === "review" && rate && brand && (
        <div className="space-y-5 px-5 pb-10">
          <Card>
            <div className="mb-4 flex items-center gap-3">
              <BrandTile brand={brand} size={44} />
              <div>
                <p className="font-bold text-ink">{brand.name}</p>
                <p className="text-xs text-muted">{rate.countryName} · {rate.cardType === "ECODE" ? "E-code" : "Physical card"}</p>
              </div>
            </div>
            {[
              ["Card value", `${sym.trim()}${face.toLocaleString("en-US")}`],
              ["Rate", `${rate.rateFormatted} per ${sym.trim()}1`],
              ["Photos", String(photos.length)],
              ["Code", code.trim() ? "Added" : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-t border-border py-3 text-sm">
                <span className="text-muted">{k}</span>
                <span className="font-semibold text-ink">{v}</span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-border pt-4">
              <span className="font-semibold text-ink">You&apos;ll get</span>
              <span className="text-2xl font-extrabold text-ink">{formatNaira(payout)}</span>
            </div>
          </Card>
          <p className="text-xs leading-relaxed text-muted">
            Our team checks every card, usually within minutes in working hours. Once it&apos;s approved, the money lands in your Naira balance.
            A card that&apos;s already been used, or doesn&apos;t match what you entered, won&apos;t be paid.
          </p>
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          <button onClick={submit} disabled={submitting} className="w-full rounded-full bg-brand py-4 font-bold text-white disabled:opacity-50">
            {submitting ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "Submit card"}
          </button>
        </div>
      )}

      {step === "done" && trade && (
        <div className="space-y-5 px-5 pb-10">
          <Card>
            <div className="py-6 text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-green-500" />
              <p className="mt-3 text-lg font-extrabold text-ink">We&apos;re reviewing your card</p>
              <p className="mt-1 text-sm text-muted">
                {trade.faceValueFormatted} {trade.brandName} → <b className="text-ink">{trade.payoutFormatted}</b>
              </p>
              <p className="mt-3 text-xs text-muted">We&apos;ll notify you the moment it&apos;s approved.</p>
            </div>
          </Card>
          <button onClick={() => router.push("/gift-cards/trades")} className="flex w-full items-center justify-center gap-1 rounded-full bg-brand py-4 font-bold text-white">
            Track it <ChevronRight className="h-4 w-4" />
          </button>
          <button onClick={reset} className="w-full rounded-full bg-card py-4 font-bold text-ink">Sell another card</button>
        </div>
      )}
    </AppShell>
  );
}
