"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronDown,
  CheckCircle2,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import BillerLogo from "@/components/BillerLogo";
import {
  api,
  ApiError,
  getAccessToken,
  type BillCashback,
  type BillServiceConfig,
} from "@/services/api";
import DataPlanGrid from "@/components/DataPlanGrid";
import { SuccessAnimation } from "@/components/Lottie";
import { invalidateMoneyCaches } from "@/lib/cache";
import { useTransactionPin, PIN_CANCELLED } from "@/components/TransactionPinProvider";

type Stage = "form" | "review" | "done";

export default function BillServicePage() {
  const router = useRouter();
  const params = useParams<{ service: string }>();
  const service = (params?.service ?? "").toLowerCase();

  const [config, setConfig] = useState<BillServiceConfig | null>(null);
  const [cashback, setCashback] = useState<BillCashback | undefined>();
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);

  const [billerId, setBillerId] = useState<string>("");
  // Data uses a compact network chip that expands into the full picker, so the
  // plan grid gets the screen instead of a permanent row of logos.
  const [networkOpen, setNetworkOpen] = useState(false);
  const [customer, setCustomer] = useState("");
  const [planId, setPlanId] = useState<string>("");
  const [amount, setAmount] = useState("");

  const [validating, setValidating] = useState(false);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("form");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerRef, setProviderRef] = useState<string | undefined>();
  const [billToken, setBillToken] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { services, cashback: cb } = await api.getBillCatalog();
        const c = services.find((s) => s.service === service) ?? null;
        setConfig(c);
        setCashback(cb);
        if (c) setBillerId(c.billers.find((b) => !b.comingSoon)?.id ?? "");
        const token = await getAccessToken();
        if (token) {
          await api.ensureProvisioned();
          const { balances } = await api.getBalances();
          const ngn = balances.find((b) => b.asset === "NGN");
          if (ngn) setBalance(Number(ngn.availableFormatted));
        }
      } catch {
        /* not logged in / catalog error */
      } finally {
        setLoading(false);
      }
    })();
  }, [service]);

  // Reset validation + plan whenever the biller or customer changes.
  useEffect(() => {
    setCustomerName(null);
  }, [billerId, customer]);

  const plans = useMemo(
    () => (config ? config.plans.filter((p) => p.billerId === billerId) : []),
    [config, billerId]
  );

  const isData = service === "data";
  const selectedBiller = config?.billers.find((b) => b.id === billerId);
  const selectedPlan = plans.find((p) => p.id === planId);
  const payAmount = config?.variableAmount ? Number(amount || 0) : Number(selectedPlan?.amount ?? 0);

  async function validate() {
    if (!config) return;
    setError(null);
    setValidating(true);
    try {
      const res = await api.validateBillCustomer({ service, billerId, customer });
      setCustomerName(res.customerName ?? "Verified");
    } catch (e) {
      setCustomerName(null);
      setError(e instanceof ApiError ? e.message : "Could not validate customer");
    } finally {
      setValidating(false);
    }
  }

  function goReview() {
    setError(null);
    if (!billerId) return setError("Select a biller.");
    if (customer.trim().length < 3) return setError(`Enter a valid ${config?.customerLabel}.`);
    if (config?.requiresValidation && !customerName)
      return setError("Please verify the customer first.");
    if (config?.variableAmount) {
      if (!(payAmount > 0)) return setError("Enter a valid amount.");
    } else if (!selectedPlan) {
      return setError("Select a plan.");
    }
    if (payAmount > balance) return setError("Amount exceeds your NGN balance.");
    setStage("review");
  }

  const { authorize } = useTransactionPin();

  async function confirm() {
    if (!config) return;
    setProcessing(true);
    setError(null);
    try {
      const res = await authorize(
        (pin) =>
          api.payBill(
            {
              service,
              billerId,
              customer: customer.trim(),
              ...(config.variableAmount ? { amount: String(payAmount) } : { planId }),
            },
            pin,
          ),
        { title: "Confirm this purchase", detail: `Paying ₦${payAmount} for ${service}.` },
      );
      invalidateMoneyCaches();
      setProviderRef(res.providerRef);
      setBillToken(res.token ?? null);
      setStage("done");
    } catch (e) {
      // A dismissed PIN prompt means "not now" — return to review, no error.
      if (e instanceof Error && e.message === PIN_CANCELLED) {
        setStage("review");
        setProcessing(false);
        return;
      }
      setError(e instanceof ApiError ? e.message : "Payment failed");
      setStage("review");
    } finally {
      setProcessing(false);
    }
  }

  const biller = config?.billers.find((b) => b.id === billerId);

  if (loading) {
    return (
      <AppShell>
        <Header onBack={() => router.back()} title="Loading…" />
        <div className="space-y-3 px-5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-card" />
          ))}
        </div>
      </AppShell>
    );
  }

  if (!config) {
    return (
      <AppShell>
        <Header onBack={() => router.back()} title="Pay bill" />
        <p className="px-5 text-center text-muted">This service is unavailable.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Header
        onBack={() => (stage === "review" ? setStage("form") : router.back())}
        title={isData ? "Mobile Data" : `${config.emoji} ${config.label}`}
        action={
          isData && stage === "form" ? (
            <button
              onClick={() => router.push("/transactions")}
              className="min-h-[44px] text-base font-semibold text-brand-light"
            >
              History
            </button>
          ) : undefined
        }
      />

      {stage === "form" && (
        <div className="px-5 pb-6">
          <p className="text-sm text-muted">
            NGN balance: <span className="font-semibold text-ink">₦{balance.toLocaleString()}</span>
          </p>

          {isData ? (
            /* Network + number on one line: the network is a chip that expands
               into the picker, so the plans get the screen. */
            <div className="mt-4 rounded-3xl bg-card p-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setNetworkOpen((o) => !o)}
                  aria-expanded={networkOpen}
                  aria-label="Change network"
                  className="flex min-h-[44px] shrink-0 items-center gap-1 active:scale-95"
                >
                  {selectedBiller ? (
                    <BillerLogo brand={selectedBiller} size={44} />
                  ) : (
                    <span className="h-11 w-11 rounded-full bg-surface" />
                  )}
                  <ChevronDown
                    className={`h-4 w-4 text-muted transition-transform ${
                      networkOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                <span className="h-9 w-px shrink-0 bg-border" />

                <input
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  placeholder={config.customerPlaceholder}
                  inputMode="tel"
                  aria-label={config.customerLabel}
                  className="w-full bg-transparent text-2xl font-bold tracking-wide text-ink placeholder-muted outline-none"
                />
              </div>

              {networkOpen && (
                <div className="mt-4 grid grid-cols-4 gap-2 border-t border-border pt-4">
                  {config.billers.map((b) => (
                    <button
                      key={b.id}
                      disabled={b.comingSoon}
                      onClick={() => {
                        setBillerId(b.id);
                        setPlanId("");
                        setNetworkOpen(false);
                      }}
                      className={`flex flex-col items-center gap-1.5 rounded-2xl border p-2 transition active:scale-95 ${
                        billerId === b.id
                          ? "border-brand bg-brand/10"
                          : "border-transparent bg-surface"
                      } ${b.comingSoon ? "opacity-40" : ""}`}
                    >
                      <BillerLogo brand={b} size={36} />
                      <span className="text-[11px] font-semibold text-ink">{b.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
            {/* Biller */}
            <p className="mb-2 mt-5 text-sm font-semibold text-muted">Select provider</p>
            <div className="grid grid-cols-3 gap-2">
              {config.billers.map((b) => (
                <button
                  key={b.id}
                  disabled={b.comingSoon}
                  onClick={() => {
                    setBillerId(b.id);
                    setPlanId("");
                  }}
                  className={`relative flex flex-col items-center gap-2 rounded-2xl border p-3 transition active:scale-95 ${
                    billerId === b.id
                      ? "border-brand bg-brand/10 ring-1 ring-brand"
                      : "border-border bg-card"
                  } ${b.comingSoon ? "opacity-50" : ""}`}
                >
                  {b.comingSoon && (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                      Soon
                    </span>
                  )}
                  <BillerLogo brand={b} size={48} />
                  <span className="text-xs font-semibold text-ink">{b.name}</span>
                </button>
              ))}
            </div>

            {/* Customer */}
            <label className="mb-2 mt-6 block text-sm font-semibold text-muted">
              {config.customerLabel}
            </label>
            <div className="flex gap-2">
              <input
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder={config.customerPlaceholder}
                className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand"
              />
              {config.requiresValidation && (
                <button
                  onClick={validate}
                  disabled={validating || customer.trim().length < 3}
                  className="shrink-0 rounded-2xl bg-card px-4 font-bold text-brand-light active:scale-95 disabled:opacity-40"
                >
                  {validating ? <Loader2 className="h-5 w-5 animate-spin" /> : "Verify"}
                </button>
              )}
            </div>
            {customerName && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-green-400">
                <CheckCircle2 className="h-4 w-4" /> {customerName}
              </p>
            )}
            </>
          )}

          {/* Amount or plan */}
          {config.variableAmount ? (
            <>
              <label className="mb-2 mt-6 block text-sm font-semibold text-muted">Amount</label>
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3.5 focus-within:border-brand">
                <span className="text-lg font-bold text-muted">₦</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full bg-transparent text-lg font-bold text-ink placeholder-muted outline-none"
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[100, 200, 500, 1000, 2000].map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(String(v))}
                    className="min-h-[44px] rounded-full bg-card px-4 py-2 text-sm font-semibold text-ink active:scale-95"
                  >
                    ₦{v.toLocaleString()}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {service === "data" ? (
                // Data bundles come back ranked by value, so they get the grid
                // that leads with the best deals rather than a flat list.
                <DataPlanGrid
                  plans={plans}
                  selectedId={planId}
                  onSelect={setPlanId}
                  cashback={cashback}
                />
              ) : (
                <>
                  <p className="mb-2 mt-6 text-sm font-semibold text-muted">Select plan</p>
                  <div className="space-y-2">
                    {plans.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setPlanId(p.id)}
                        className={`flex w-full items-center justify-between rounded-2xl border p-4 active:scale-[0.99] ${
                          planId === p.id ? "border-brand bg-card" : "border-border bg-card"
                        }`}
                      >
                        <span className="font-semibold text-ink">{p.name}</span>
                        <span className="font-bold text-ink">
                          ₦{Number(p.amount).toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

          <button
            onClick={goReview}
            className="mt-6 w-full rounded-full bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white active:scale-[0.99]"
          >
            Continue
          </button>
        </div>
      )}

      {stage === "review" && (
        <div className="px-5 pb-6">
          {biller && (
            <div className="mb-5 mt-2 flex flex-col items-center text-center">
              <BillerLogo brand={biller} size={64} />
              <p className="mt-3 text-lg font-bold text-ink">{biller.name}</p>
              <p className="text-sm text-muted">{config.label}</p>
            </div>
          )}
          <p className="mb-2 text-sm font-semibold text-muted">Review payment</p>
          <div className="overflow-hidden rounded-2xl bg-card">
            <Row label="Service" value={config.label} />
            <Row label="Provider" value={biller?.name ?? ""} bordered />
            <Row label={config.customerLabel} value={customer.trim()} bordered />
            {customerName && <Row label="Name" value={customerName} bordered />}
            {selectedPlan && <Row label="Plan" value={selectedPlan.name} bordered />}
            <Row label="Amount" value={`₦${payAmount.toLocaleString()}`} bordered />
          </div>

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

          <div className="mt-6 flex items-center gap-2 text-xs text-muted">
            <ShieldCheck className="h-4 w-4 text-brand-light" />
            Paid securely from your NGN balance.
          </div>

          <button
            onClick={confirm}
            disabled={processing}
            className="mt-4 w-full rounded-full bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white active:scale-[0.99] disabled:opacity-60"
          >
            {processing ? "Processing…" : `Pay ₦${payAmount.toLocaleString()}`}
          </button>
          <button
            onClick={() => setStage("form")}
            disabled={processing}
            className="mt-3 w-full rounded-full bg-card py-4 font-bold text-ink active:scale-[0.99] disabled:opacity-60"
          >
            Edit
          </button>
        </div>
      )}

      {stage === "done" && (
        <div className="flex flex-col items-center px-5 pb-6 pt-10 text-center">
          <SuccessAnimation />
          <p className="mt-6 text-2xl font-extrabold text-ink">Payment successful</p>
          <p className="mt-2 text-sm text-muted">
            ₦{payAmount.toLocaleString()} {config.label} for {customer.trim()}.
          </p>
          {billToken && (
            <div className="mt-4 w-full rounded-2xl border border-green-500/30 bg-green-500/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Recharge token
              </p>
              <p className="mt-1 break-all text-xl font-extrabold tracking-wider text-ink">
                {billToken}
              </p>
              <button
                onClick={() => navigator.clipboard?.writeText(billToken)}
                className="min-h-[44px] mt-3 rounded-full bg-card px-5 py-2 text-sm font-bold text-ink active:scale-95"
              >
                Copy token
              </button>
              <p className="mt-2 text-xs text-muted">
                Enter this token on your meter to load the units.
              </p>
            </div>
          )}
          {providerRef && (
            <p className="mt-3 break-all rounded-xl bg-card px-3 py-2 text-xs text-muted">
              Ref: {providerRef}
            </p>
          )}
          <button
            onClick={() => router.push("/pay-bill")}
            className="mt-8 w-full rounded-full bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white active:scale-[0.99]"
          >
            Done
          </button>
          <button
            onClick={() => router.push("/transactions")}
            className="mt-3 w-full rounded-full bg-card py-4 font-bold text-ink active:scale-[0.99]"
          >
            View receipt
          </button>
        </div>
      )}
    </AppShell>
  );
}

function Header({
  onBack,
  title,
  action,
}: {
  onBack: () => void;
  title: string;
  /** Optional right-hand link. When present the title centres between the two. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-5 pb-4 pt-4">
      <button
        onClick={onBack}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-ink active:scale-95"
        aria-label="Go back"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      {action ? (
        <>
          <h1 className="flex-1 text-center text-xl font-bold text-ink">{title}</h1>
          <div className="flex h-11 shrink-0 items-center justify-end">{action}</div>
        </>
      ) : (
        <h1 className="text-xl font-bold text-ink">{title}</h1>
      )}
    </div>
  );
}

function Row({ label, value, bordered }: { label: string; value: string; bordered?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-4 ${
        bordered ? "border-t border-border" : ""
      }`}
    >
      <span className="text-sm text-muted">{label}</span>
      <span className="max-w-[60%] truncate text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}
