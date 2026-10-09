"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AtSign, BadgeCheck, Check, CircleDollarSign, ExternalLink, Facebook, Globe, Hourglass, Instagram, Linkedin, Loader2,
  MessageCircle, Music2, PartyPopper, Plus, RefreshCw, ShieldCheck, Sparkles, Twitter, Video, Wallet, X as Close, Youtube,
} from "lucide-react";
import Logo from "@/components/Logo";
import { Chip, Counter, FieldError, FlowBar, FlowFooter, StepHeader, Tick } from "@/components/apply/parts";
import { api, ApiError, APP_URL, type Application, type ApplicationState } from "@/lib/api";
import {
  AUDIENCE_LOCATIONS, FOLLOWER_BANDS, NICHES, PLATFORM_KEYS, PLATFORMS, VIEW_BANDS, band, fromStored, normalizeHandle, postProblem,
  profileUrl, socialProblem, type DraftSocial, type PlatformKey,
} from "@/lib/creator";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

/**
 * Becoming a CheqPay Creator: a short guided application, one topic per
 * screen, then a status screen while our team reviews it.
 *
 * Identity isn't asked again — it comes from the CheqPay account's own KYC.
 */

const STEPS = ["identity", "platforms", "audience", "background", "code", "review"] as const;
type Step = (typeof STEPS)[number];

const ICON: Record<PlatformKey, typeof Instagram> = {
  instagram: Instagram, tiktok: Music2, x: Twitter, youtube: Youtube, facebook: Facebook,
  snapchat: MessageCircle, threads: AtSign, linkedin: Linkedin, other: Globe,
};

interface Draft {
  phone: string;
  socials: DraftSocial[];
  niches: string[];
  audienceLocation: string;
  avgViews: string;
  sampleLinks: string[];
  bio: string;
  priorBrands: string;
  why: string;
  preferredCode: string;
  agree: boolean;
}

const EMPTY: Draft = {
  phone: "", socials: [], niches: [], audienceLocation: "", avgViews: "", sampleLinks: [""], bio: "", priorBrands: "", why: "",
  preferredCode: "", agree: false,
};

function fromApplication(a: Application): Draft {
  return {
    phone: "",
    socials: a.socials.map(fromStored),
    niches: a.niches.filter((n) => (NICHES as readonly string[]).includes(n)),
    audienceLocation: (AUDIENCE_LOCATIONS as readonly string[]).includes(a.audienceLocation) ? a.audienceLocation : "",
    avgViews: a.avgViews ?? "",
    sampleLinks: a.sampleLinks.length ? a.sampleLinks : [""],
    bio: a.bio,
    priorBrands: a.priorBrands,
    why: a.why,
    preferredCode: a.preferredCode ?? "",
    agree: false,
  };
}

const draftKey = (userId: string) => `cheqpay-creators-draft:${userId}`;
function loadDraft(userId: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>), agree: false } : null;
  } catch {
    return null;
  }
}
function saveDraft(userId: string, d: Draft | null) {
  try {
    if (d) localStorage.setItem(draftKey(userId), JSON.stringify(d));
    else localStorage.removeItem(draftKey(userId));
  } catch {
    /* private mode: the draft just isn't kept */
  }
}

const stepFor = (path?: (string | number)[]): Step => {
  const f = String(path?.[0] ?? "");
  if (f === "socials") return "platforms";
  if (["niches", "audienceLocation", "avgViews", "sampleLinks"].includes(f)) return "audience";
  if (["bio", "why", "priorBrands"].includes(f)) return "background";
  if (f === "preferredCode") return "code";
  if (f === "phone") return "identity";
  return "review";
};

export default function ApplyPage() {
  const session = useSession();
  const router = useRouter();
  const [state, setState] = useState<ApplicationState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"welcome" | "form" | "status">("welcome");
  const [step, setStep] = useState<Step>("identity");
  const [reviewing, setReviewing] = useState(false); // came to a step from Review's "Edit"
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const userId = session?.user.id;

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const s = await api.application();
      if (s.isInfluencer) {
        router.replace("/dashboard");
        return null;
      }
      setState(s);
      return s;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Something went wrong.");
      return null;
    }
  }, [router]);

  useEffect(() => {
    if (session === undefined) return;
    if (session === null) {
      router.replace("/login?next=/apply");
      return;
    }
    refresh().then((s) => {
      if (!s) return;
      const saved = loadDraft(session.user.id);
      if (s.application && !s.canSubmit) setMode("status");
      else if (s.application) {
        setDraft(saved ?? fromApplication(s.application));
        setMode("status"); // NEEDS_INFO / REJECTED: show what we said first
      } else if (saved) {
        setDraft(saved);
        setMode("welcome");
      }
    });
  }, [session, router, refresh]);

  // Keep the draft as they type, so leaving to verify identity loses nothing.
  useEffect(() => {
    if (userId && mode === "form") saveDraft(userId, draft);
  }, [draft, userId, mode]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const index = STEPS.indexOf(step);

  const problems = useMemo(() => validate(draft, state), [draft, state]);
  const stepOk = (s: Step) => Object.keys(problems[s]).length === 0;

  function go(to: Step) {
    setShowErrors(false);
    setError(null);
    setStep(to);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function next() {
    if (!stepOk(step)) {
      setShowErrors(true);
      return;
    }
    if (reviewing) {
      setReviewing(false);
      return go("review");
    }
    go(STEPS[index + 1]);
  }

  function back() {
    if (reviewing) {
      setReviewing(false);
      return go("review");
    }
    if (index === 0) return setMode(state?.application ? "status" : "welcome");
    go(STEPS[index - 1]);
  }

  async function submit() {
    const bad = STEPS.find((s) => !stepOk(s));
    if (bad) {
      setShowErrors(true);
      if (bad !== "review") go(bad);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const s = await api.apply({
        ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
        socials: draft.socials.map((x) => ({ platform: x.platform, handle: normalizeHandle(x.handle), followers: x.followers, ...(x.url.trim() ? { url: x.url.trim() } : {}) })),
        niches: draft.niches,
        audienceLocation: draft.audienceLocation,
        avgViews: draft.avgViews,
        sampleLinks: draft.sampleLinks.map((l) => l.trim()).filter(Boolean),
        bio: draft.bio.trim(),
        priorBrands: draft.priorBrands.trim(),
        why: draft.why.trim(),
        ...(draft.preferredCode ? { preferredCode: draft.preferredCode } : {}),
        agreeTerms: true,
      });
      if (userId) saveDraft(userId, null);
      setState(s);
      setJustSent(true);
      setMode("status");
      window.scrollTo({ top: 0 });
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError(err?.message ?? "We couldn't send your application. Please try again.");
      if (err?.code === "verify_identity_first") {
        await refresh();
        go("identity");
      } else if (err?.path) {
        const s = stepFor(err.path);
        if (s !== "review") go(s);
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function startForm() {
    setError(null);
    setMode("form");
    go("identity");
  }

  // ---------------------------------------------------------------- render

  if (!state) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
        {loadError ? (
          <>
            <p className="subhead">{loadError}</p>
            <button onClick={() => refresh()} className="btn-tinted"><RefreshCw className="h-4 w-4" /> Try again</button>
          </>
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        )}
      </div>
    );
  }

  if (mode === "status" && state.application) {
    return (
      <StatusScreen
        state={state}
        justSent={justSent}
        onEdit={() => {
          setJustSent(false);
          setMode("form");
          go("review");
        }}
      />
    );
  }

  if (mode === "welcome") {
    return <Welcome hasDraft={draft !== EMPTY} onStart={startForm} />;
  }

  const p = showErrors ? problems[step] : {};

  return (
    <div ref={topRef} className="mx-auto flex min-h-[100dvh] max-w-[560px] flex-col px-5">
      <FlowBar step={index + 1} total={STEPS.length} onBack={back} />

      <main key={step} className="appear flex-1">
        {step === "identity" && (
          <>
            <StepHeader title="Your identity" sub="We use your verified CheqPay identity, so there's nothing to upload here." />
            {state.me.verified ? (
              <div className="group-list">
                <div className="group-row">
                  <BadgeCheck className="h-7 w-7 shrink-0 text-good" />
                  <div className="min-w-0 flex-1">
                    <p className="headline truncate">{state.me.legalName ?? "Verified"}</p>
                    <p className="footnote">Verified with your BVN · goes on your application</p>
                  </div>
                </div>
                <div className="group-row">
                  <span className="w-7" />
                  <div className="min-w-0 flex-1">
                    <p className="footnote">Email</p>
                    <p className="truncate text-[17px]">{state.me.email}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card text-center">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warn/12 text-warn"><ShieldCheck className="h-7 w-7" /></span>
                <h2 className="headline mt-4 text-[20px]">Verify your identity first</h2>
                <p className="subhead mt-2">
                  Creators are paid into their CheqPay wallet, so we need to know it&apos;s really you. It takes about two minutes in the CheqPay app.
                </p>
                <a href={`${APP_URL}/kyc`} target="_blank" rel="noopener" className="btn mt-6 w-full">Verify in CheqPay</a>
                <button onClick={() => refresh()} className="btn-ghost mt-2 w-full"><RefreshCw className="h-4 w-4" /> I&apos;ve verified — check again</button>
                <p className="footnote mt-3">Your answers so far are saved on this device.</p>
              </div>
            )}

            {state.me.verified && !state.me.hasPhone && (
              <div className="mt-6">
                <label className="label" htmlFor="phone">Phone number</label>
                <input id="phone" type="tel" inputMode="tel" autoComplete="tel" className="input" placeholder="0803 000 0000" value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
                <FieldError>{p.phone}</FieldError>
                <p className="footnote mt-1.5 px-1">So our creator team can reach you. Never shown publicly.</p>
              </div>
            )}
          </>
        )}

        {step === "platforms" && (
          <PlatformsStep draft={draft} setSocials={(s) => set("socials", s)} problems={p} />
        )}

        {step === "audience" && (
          <>
            <StepHeader title="Your audience" sub="Roughly is fine. We look at your profile too." />

            <section>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <p className="headline">What do you post about?</p>
                <span className="footnote">{draft.niches.length}/3</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {NICHES.map((n) => {
                  const on = draft.niches.includes(n);
                  return (
                    <Chip key={n} on={on} disabled={!on && draft.niches.length >= 3} onClick={() => set("niches", on ? draft.niches.filter((x) => x !== n) : [...draft.niches, n])}>
                      {n}
                    </Chip>
                  );
                })}
              </div>
              <FieldError>{p.niches}</FieldError>
            </section>

            <section className="mt-8">
              <label className="headline mb-2 block px-1" htmlFor="loc">Where are most of your followers?</label>
              <select id="loc" className="input appearance-none" value={draft.audienceLocation} onChange={(e) => set("audienceLocation", e.target.value)}>
                <option value="" disabled>Choose a place</option>
                {AUDIENCE_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <FieldError>{p.audienceLocation}</FieldError>
            </section>

            <section className="mt-8">
              <p className="headline mb-2 px-1">Typical views on a post</p>
              <div className="grid grid-cols-5 gap-1 rounded-xl bg-circle p-1">
                {VIEW_BANDS.map((b) => (
                  <button key={b} type="button" aria-pressed={draft.avgViews === b} onClick={() => set("avgViews", b)}
                    className={`h-9 rounded-[9px] text-[13px] font-semibold transition ${draft.avgViews === b ? "bg-card text-ink shadow-card" : "text-muted"}`}>
                    {band(b)}
                  </button>
                ))}
              </div>
              <FieldError>{p.avgViews}</FieldError>
            </section>

            <section className="mt-8">
              <p className="headline px-1">Recent posts you&apos;re proud of</p>
              <p className="footnote mb-3 px-1">Paste 1–3 links. They help us see your style.</p>
              <div className="space-y-2">
                {draft.sampleLinks.map((l, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2">
                      <input
                        type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" className="input" placeholder="https://"
                        aria-label={`Post link ${i + 1}`} value={l}
                        onChange={(e) => set("sampleLinks", draft.sampleLinks.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                      {draft.sampleLinks.length > 1 && (
                        <button type="button" aria-label="Remove link" onClick={() => set("sampleLinks", draft.sampleLinks.filter((_, j) => j !== i))}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-circle">
                          <Close className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                    <FieldError>{p[`post${i}`]}</FieldError>
                  </div>
                ))}
              </div>
              {draft.sampleLinks.length < 3 && (
                <button type="button" onClick={() => set("sampleLinks", [...draft.sampleLinks, ""])} className="btn-ghost -ml-3 mt-1 !h-11 !px-3 text-[15px]">
                  <Plus className="h-4 w-4" /> Add another
                </button>
              )}
              <FieldError>{p.sampleLinks}</FieldError>
            </section>
          </>
        )}

        {step === "background" && (
          <>
            <StepHeader title="About you" sub="A few lines in your own words. This is what our team reads first." />
            <div>
              <div className="mb-1.5 flex items-baseline justify-between px-1">
                <label className="text-[13px] font-medium text-muted" htmlFor="bio">Tell us about yourself and your content</label>
                <Counter n={draft.bio.trim().length} max={500} />
              </div>
              <textarea id="bio" className="input" rows={5} maxLength={600} placeholder="I make short, funny videos about saving money as a student in Lagos…" value={draft.bio} onChange={(e) => set("bio", e.target.value)} />
              <FieldError>{p.bio}</FieldError>
            </div>
            <div className="mt-6">
              <div className="mb-1.5 flex items-baseline justify-between px-1">
                <label className="text-[13px] font-medium text-muted" htmlFor="why">Why CheqPay?</label>
                <Counter n={draft.why.trim().length} max={500} />
              </div>
              <textarea id="why" className="input" rows={4} maxLength={600} placeholder="What would you tell your followers about CheqPay?" value={draft.why} onChange={(e) => set("why", e.target.value)} />
              <FieldError>{p.why}</FieldError>
            </div>
            <div className="mt-6">
              <label className="label" htmlFor="brands">Brands you&apos;ve worked with <span className="font-normal">(optional)</span></label>
              <input id="brands" className="input" maxLength={300} placeholder="e.g. a bank, a phone brand, an app" value={draft.priorBrands} onChange={(e) => set("priorBrands", e.target.value)} />
            </div>
          </>
        )}

        {step === "code" && <CodeStep value={draft.preferredCode} onChange={(v) => set("preferredCode", v)} problem={p.preferredCode} />}

        {step === "review" && (
          <ReviewStep
            draft={draft}
            state={state}
            agree={draft.agree}
            setAgree={(v) => set("agree", v)}
            agreeProblem={p.agree}
            onEdit={(s) => {
              setReviewing(true);
              go(s);
            }}
          />
        )}
      </main>

      <FlowFooter>
        {error && <p className="notice-bad mb-3" role="alert">{error}</p>}
        {step === "review" ? (
          <button onClick={submit} disabled={busy} className="btn w-full">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : state.application ? "Send update" : "Submit application"}
          </button>
        ) : (
          <button onClick={next} disabled={step === "identity" && !state.me.verified} className="btn w-full">
            {reviewing ? "Done" : step === "code" && !draft.preferredCode ? "Skip for now" : "Continue"}
          </button>
        )}
      </FlowFooter>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rules per step (the API checks them again)

function validate(d: Draft, s: ApplicationState | null): Record<Step, Record<string, string>> {
  const out: Record<Step, Record<string, string>> = { identity: {}, platforms: {}, audience: {}, background: {}, code: {}, review: {} };
  if (!s?.me.verified) out.identity.kyc = "Verify your identity first.";
  if (s && !s.me.hasPhone && !/^\+?[\d\s()-]{7,20}$/.test(d.phone.trim())) out.identity.phone = "Add a phone number we can reach you on.";

  if (!d.socials.length) out.platforms.none = "Pick at least one platform.";
  d.socials.forEach((x, i) => {
    const pr = socialProblem(x);
    if (pr) out.platforms[`s${i}`] = pr;
  });

  if (!d.niches.length) out.audience.niches = "Pick at least one topic.";
  if (!d.audienceLocation) out.audience.audienceLocation = "Choose where most of your followers are.";
  if (!d.avgViews) out.audience.avgViews = "Pick roughly how many views a post gets.";
  const links = d.sampleLinks.map((l) => l.trim());
  if (!links.some(Boolean)) out.audience.sampleLinks = "Add a link to at least one recent post.";
  links.forEach((l, i) => {
    const pr = l ? postProblem(l, d.socials) : null;
    if (pr) out.audience[`post${i}`] = pr;
  });

  const bio = d.bio.trim().length;
  if (bio < 20) out.background.bio = "A couple of sentences, please (20 characters or more).";
  if (bio > 500) out.background.bio = "Keep it under 500 characters.";
  const why = d.why.trim().length;
  if (why < 10) out.background.why = "Tell us a little more.";
  if (why > 500) out.background.why = "Keep it under 500 characters.";

  if (d.preferredCode && !/^[A-Z0-9]{4,16}$/.test(d.preferredCode)) out.code.preferredCode = "Use 4–16 letters or numbers.";
  if (!d.agree) out.review.agree = "Please agree to the Creator terms.";
  return out;
}

// ---------------------------------------------------------------------------
// Screens

function Welcome({ onStart, hasDraft }: { onStart: () => void; hasDraft: boolean }) {
  const rows = [
    { Icon: CircleDollarSign, title: "Earn on every transaction", body: "A share of our fee each time someone you bring in pays, sends or converts." },
    { Icon: Sparkles, title: "Paid brand tasks", body: "Post for brands advertising on CheqPay and get paid per post." },
    { Icon: Wallet, title: "Paid straight to your wallet", body: "Earnings land in your CheqPay wallet. Withdraw to your bank any time." },
  ];
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[560px] flex-col px-5">
      <header className="flex items-center justify-between py-5">
        <Logo />
        <button onClick={() => supabase.auth.signOut().then(() => (window.location.href = "/"))} className="footnote font-medium hover:text-ink">Sign out</button>
      </header>
      <main className="appear flex-1 pt-6">
        <h1 className="title-lg">Become a<br />CheqPay Creator</h1>
        <p className="subhead mt-3 text-[17px]">Share CheqPay with your audience and earn when they use it.</p>
        <ul className="mt-10 space-y-7">
          {rows.map(({ Icon, title, body }) => (
            <li key={title} className="flex gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-brand/12 text-brand-light"><Icon className="h-6 w-6" /></span>
              <div>
                <p className="headline">{title}</p>
                <p className="subhead mt-0.5">{body}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-10 rounded-2xl bg-card p-4 ring-1 ring-border/40">
          <p className="footnote font-semibold uppercase tracking-[0.04em]">What we&apos;ll ask</p>
          <p className="subhead mt-1">Where you post, a little about your audience and a few recent posts. About 3 minutes. Your identity comes from your verified CheqPay account.</p>
        </div>
      </main>
      <FlowFooter>
        <button onClick={onStart} className="btn w-full">{hasDraft ? "Continue application" : "Get started"}</button>
      </FlowFooter>
    </div>
  );
}

function PlatformsStep({ draft, setSocials, problems }: { draft: Draft; setSocials: (s: DraftSocial[]) => void; problems: Record<string, string> }) {
  const has = (k: PlatformKey) => draft.socials.some((s) => s.platform === k);
  const toggle = (k: PlatformKey) =>
    setSocials(has(k) && k !== "other" ? draft.socials.filter((s) => s.platform !== k) : [...draft.socials, { platform: k, handle: "", followers: "", url: "" }]);
  const update = (i: number, patch: Partial<DraftSocial>) => setSocials(draft.socials.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <>
      <StepHeader title="Where do you post?" sub="Pick every platform you're active on. Your biggest one matters most." />
      <div className="grid grid-cols-3 gap-2">
        {PLATFORM_KEYS.map((k) => {
          const Icon = ICON[k];
          const on = has(k);
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => toggle(k)}
              className={`relative flex h-[84px] flex-col items-center justify-center gap-1.5 rounded-2xl text-[13px] font-semibold transition duration-200 ease-spring active:scale-[0.97] ${on ? "bg-brand text-white shadow-float" : "bg-card text-ink ring-1 ring-border/50 hover:ring-border"}`}>
              <Icon className="h-6 w-6" />
              {PLATFORMS[k].name}
              {on && <Check className="absolute right-2 top-2 h-4 w-4" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
      <FieldError>{problems.none}</FieldError>

      <div className="mt-8 space-y-5">
        {draft.socials.map((s, i) => {
          const P = PLATFORMS[s.platform];
          const Icon = ICON[s.platform];
          const built = profileUrl({ ...s, url: "" });
          const link = profileUrl(s);
          return (
            <section key={i} className="appear">
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="headline flex items-center gap-2"><Icon className="h-5 w-5 text-brand-light" /> {P.name}</p>
                <button type="button" onClick={() => setSocials(draft.socials.filter((_, j) => j !== i))} className="footnote font-medium hover:text-bad">Remove</button>
              </div>
              <div className="card space-y-4 !p-4">
                <div>
                  <label className="label" htmlFor={`h${i}`}>{s.platform === "other" ? "Name of the site or page" : "Handle"}</label>
                  <div className="relative">
                    {s.platform !== "other" && <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[17px] text-muted">@</span>}
                    <input id={`h${i}`} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={`input ${s.platform !== "other" ? "pl-9" : ""}`}
                      placeholder={s.platform === "other" ? "My blog" : "yourname"} value={s.handle}
                      onChange={(e) => update(i, { handle: s.platform === "other" ? e.target.value : e.target.value.replace(/^@+/, "").replace(/\s/g, "") })} />
                  </div>
                </div>
                <div>
                  <p className="label">Followers</p>
                  <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
                    {FOLLOWER_BANDS.map((b) => (
                      <Chip key={b} on={s.followers === b} onClick={() => update(i, { followers: b })}>{band(b)}</Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor={`u${i}`}>Profile link {built && <span className="font-normal">(optional)</span>}</label>
                  <input id={`u${i}`} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" className="input" placeholder={built ?? "https://"} value={s.url} onChange={(e) => update(i, { url: e.target.value })} />
                  {link && !problems[`s${i}`] && (
                    <a href={link} target="_blank" rel="noopener noreferrer" className="footnote mt-1.5 inline-flex items-center gap-1 px-1 font-medium text-brand-light">
                      Check it&apos;s you <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
                <FieldError>{problems[`s${i}`]}</FieldError>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function CodeStep({ value, onChange, problem }: { value: string; onChange: (v: string) => void; problem?: string }) {
  const [check, setCheck] = useState<{ code: string; available: boolean; reason?: string } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setCheck(null);
    if (value.length < 4) return;
    setChecking(true);
    const t = setTimeout(() => {
      api
        .codeAvailable(value)
        .then((r) => setCheck({ code: value, available: r.available, reason: r.reason }))
        .catch(() => setCheck(null))
        .finally(() => setChecking(false));
    }, 350);
    return () => {
      clearTimeout(t);
      setChecking(false);
    };
  }, [value]);

  return (
    <>
      <StepHeader title="Your creator code" sub="Followers use it to sign up, and it's in your link. Pick something they'll remember. We'll confirm it when you're approved." />
      <input
        aria-label="Creator code"
        autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={16}
        className="input !h-16 text-center font-mono text-[26px] font-semibold uppercase tracking-[0.12em]"
        placeholder="ADA2026" value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16))}
      />
      <div className="mt-2 h-5 px-1 text-[13px] font-medium">
        {value && value.length < 4 ? (
          <span className="text-muted">At least 4 letters or numbers</span>
        ) : checking ? (
          <span className="inline-flex items-center gap-1.5 text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</span>
        ) : check && check.code === value ? (
          check.available ? <span className="inline-flex items-center gap-1 text-good"><Check className="h-4 w-4" strokeWidth={3} /> Available</span> : <span className="text-bad">{check.reason ?? "Not available"}</span>
        ) : null}
      </div>
      <FieldError>{problem}</FieldError>

      <p className="section-label mt-8">Your link will look like</p>
      <div className="group-list">
        <div className="group-row">
          <Video className="h-5 w-5 shrink-0 text-brand-light" />
          <p className="min-w-0 flex-1 truncate font-mono text-[15px]">creator.mycheqpay.com/r/<span className="font-semibold text-brand-light">{value || "YOURCODE"}</span></p>
        </div>
      </div>
      <p className="footnote mt-3 px-1">Optional. Skip it and we&apos;ll suggest one.</p>
    </>
  );
}

function ReviewStep({ draft, state, agree, setAgree, agreeProblem, onEdit }: {
  draft: Draft; state: ApplicationState; agree: boolean; setAgree: (v: boolean) => void; agreeProblem?: string; onEdit: (s: Step) => void;
}) {
  const Section = ({ title, step, children }: { title: string; step: Step; children: React.ReactNode }) => (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline justify-between px-4">
        <p className="text-[13px] font-medium uppercase tracking-[0.04em] text-muted">{title}</p>
        <button type="button" onClick={() => onEdit(step)} className="text-[15px] font-medium text-brand-light">Edit</button>
      </div>
      <div className="group-list">{children}</div>
    </section>
  );
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="group-row items-start">
      <p className="w-28 shrink-0 text-[15px] text-muted">{k}</p>
      <div className="min-w-0 flex-1 break-words text-[15px]">{v}</div>
    </div>
  );

  return (
    <>
      <StepHeader title="Review and send" sub={state.application?.status === "NEEDS_INFO" ? "Check your changes, then send them back to our team." : "Check everything looks right."} />

      <Section title="You" step="identity">
        <Row k="Name" v={<span className="inline-flex items-center gap-1.5">{state.me.legalName ?? "—"} <BadgeCheck className="h-4 w-4 text-good" /></span>} />
        <Row k="Email" v={state.me.email} />
        {draft.phone && <Row k="Phone" v={draft.phone} />}
      </Section>

      <Section title="Platforms" step="platforms">
        {draft.socials.map((s, i) => (
          <Row key={i} k={PLATFORMS[s.platform].name} v={<>{s.platform === "other" ? s.handle : `@${normalizeHandle(s.handle)}`}<span className="text-muted"> · {band(s.followers)}</span></>} />
        ))}
      </Section>

      <Section title="Audience" step="audience">
        <Row k="Topics" v={draft.niches.join(", ")} />
        <Row k="Mostly in" v={draft.audienceLocation} />
        <Row k="Views" v={`${band(draft.avgViews)} per post`} />
        <Row k="Posts" v={draft.sampleLinks.filter(Boolean).map((l) => <span key={l} className="block truncate">{l.replace(/^https:\/\/(www\.)?/, "")}</span>)} />
      </Section>

      <Section title="About you" step="background">
        <Row k="About" v={<span className="line-clamp-3">{draft.bio}</span>} />
        <Row k="Why CheqPay" v={<span className="line-clamp-3">{draft.why}</span>} />
        {draft.priorBrands && <Row k="Brands" v={draft.priorBrands} />}
      </Section>

      <Section title="Code" step="code">
        <Row k="Preferred" v={draft.preferredCode ? <span className="font-mono font-semibold">{draft.preferredCode}</span> : <span className="text-muted">We&apos;ll suggest one</span>} />
      </Section>

      <p className="section-label mt-8">Creator terms</p>
      <div className="group-list">
        <ul className="space-y-2 px-4 py-4 text-[15px] text-muted">
          <li>• I&apos;ll mark promotional posts as ads (for example #ad).</li>
          <li>• No fake, bought or self-made sign-ups, and no misleading claims about CheqPay.</li>
          <li>• Earnings are paid to my CheqPay wallet and can be held or reversed if a sign-up breaks these rules.</li>
          <li>• CheqPay can end the arrangement if these terms are broken.</li>
        </ul>
        <button type="button" onClick={() => setAgree(!agree)} aria-pressed={agree} className="group-row w-full border-t border-border/70 text-left">
          <Tick on={agree} />
          <span className="flex-1 text-[17px]">I agree to the Creator terms</span>
        </button>
      </div>
      <FieldError>{agreeProblem}</FieldError>
    </>
  );
}

function StatusScreen({ state, justSent, onEdit }: { state: ApplicationState; justSent: boolean; onEdit: () => void }) {
  const a = state.application!;
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

  const hero = {
    PENDING: { Icon: justSent ? PartyPopper : Hourglass, tint: "bg-brand/12 text-brand-light", title: justSent ? "Application sent" : "We're reviewing it", body: "Our creator team is looking at your profile. We usually reply within 2 working days and will email you." },
    NEEDS_INFO: { Icon: MessageCircle, tint: "bg-warn/12 text-warn", title: "We need a little more", body: "Our team has a question before they can decide." },
    REJECTED: { Icon: Close, tint: "bg-bad/10 text-bad", title: "Not this time", body: state.canSubmit ? "You can apply again now." : `You can apply again from ${fmt(a.reapplyAfter)}.` },
    APPROVED: { Icon: BadgeCheck, tint: "bg-good/12 text-good", title: "You're in", body: "Welcome to CheqPay Creators." },
  }[a.status];

  const decided = a.status === "APPROVED" || a.status === "REJECTED";
  const timeline = [
    { label: a.submissions > 1 ? "Updated" : "Submitted", detail: fmt(a.updatedAt), done: true },
    { label: a.status === "NEEDS_INFO" ? "Waiting on you" : "In review", detail: a.status === "NEEDS_INFO" ? "Answer below" : decided ? "" : "Usually 2 working days", done: decided, current: !decided },
    { label: "Decision", detail: decided ? fmt(a.reviewedAt) : "", done: decided },
  ];

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[560px] flex-col px-5">
      <header className="flex items-center justify-between py-5">
        <Logo />
        <button onClick={() => supabase.auth.signOut().then(() => (window.location.href = "/"))} className="footnote font-medium hover:text-ink">Sign out</button>
      </header>
      <main className="appear flex-1 pt-6 text-center">
        <span className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full ${hero.tint}`}><hero.Icon className="h-10 w-10" /></span>
        <h1 className="title mt-6">{hero.title}</h1>
        <p className="subhead mx-auto mt-2 max-w-sm text-[17px]">{hero.body}</p>

        {a.status === "NEEDS_INFO" && a.requestNote && (
          <div className="card mt-8 text-left">
            <p className="footnote font-semibold uppercase tracking-[0.04em]">From the creator team</p>
            <p className="mt-2 whitespace-pre-wrap text-[17px]">{a.requestNote}</p>
          </div>
        )}
        {a.status === "REJECTED" && a.reason && (
          <div className="card mt-8 text-left">
            <p className="footnote font-semibold uppercase tracking-[0.04em]">Why</p>
            <p className="mt-2 whitespace-pre-wrap text-[17px]">{a.reason}</p>
          </div>
        )}

        <div className="group-list mt-8 text-left">
          {timeline.map((t) => (
            <div key={t.label} className="group-row">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${t.done ? "bg-good text-white" : t.current ? "bg-brand/15 text-brand-light" : "bg-circle text-muted"}`}>
                {t.done ? <Check className="h-4 w-4" strokeWidth={3} /> : t.current ? <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand" /> : <span className="h-2 w-2 rounded-full bg-muted/50" />}
              </span>
              <p className={`flex-1 text-[17px] ${t.done || t.current ? "" : "text-muted"}`}>{t.label}</p>
              <p className="footnote">{t.detail}</p>
            </div>
          ))}
        </div>
        <p className="footnote mt-4">Questions? <a className="link" href="mailto:support@mycheqpay.com">support@mycheqpay.com</a></p>
      </main>

      {(state.canSubmit || a.status === "APPROVED") && (
        <FlowFooter>
          {a.status === "APPROVED" ? (
            <a href="/dashboard" className="btn w-full">Open your dashboard</a>
          ) : (
            <button onClick={onEdit} className="btn w-full">{a.status === "NEEDS_INFO" ? "Update application" : "Apply again"}</button>
          )}
        </FlowFooter>
      )}
    </div>
  );
}
