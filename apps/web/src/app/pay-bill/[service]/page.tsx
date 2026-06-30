"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronLeft,
  CheckCircle2,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import BillerLogo from "@/components/BillerLogo";
import { api, ApiError, getAccessToken, type BillServiceConfig } from "@/services/api";

type Stage = "form" | "review" | "done";

export default function BillServicePage() {
  const router = useRouter();
  const params = useParams<{ service: string }>();
  const service = (params?.service ?? "").toLowerCase();

  const [config, setConfig] = useState<BillServiceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);

  const [billerId, setBillerId] = useState<string>("");
  const [customer, setCustomer] = useState("");
  const [planId, setPlanId] = useState<string>("");
  const [amount, setAmount] = useState("");

  const [validating, setValidating] = useState(false);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("form");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerRef, setProviderRef] = useState<string | undefined>();

  useEffect(() => {
    (async () => {
      try {
        const { services } = await api.getBillCatalog();
        const c = services.find((s) => s.service === service) ?? null;
        setConfig(c);
        if (c) setBillerId(c.billers[0]?.id ?? "");
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

  async function confirm() {
    if (!config) return;
    setProcessing(true);
    setError(null);
    try {
      const res = await api.payBill({
        service,
        billerId,
        customer: customer.trim(),
        ...(config.variableAmount ? { amount: String(payAmount) } : { planId }),
      });
      setProviderRef(res.providerRef);
      setStage("done");
    } catch (e) {
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
        title={`${config.emoji} ${config.label}`}
      />

      {stage === "form" && (
        <div className="px-5 pb-6">
          <p className="text-sm text-muted">
            NGN balance: <span className="font-semibold text-ink">₦{balance.toLocaleString()}</span>
          </p>

          {/* Biller */}
          <p className="mb-2 mt-5 text-sm font-semibold text-muted">Select provider</p>
          <div className="grid grid-cols-3 gap-2">
            {config.billers.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setBillerId(b.id);
                  setPlanId("");
                }}
                className={`flex flex-col items-center gap-2 rounded-2xl border p-3 transition active:scale-95 ${
                  billerId === b.id
                    ? "border-brand bg-brand/10 ring-1 ring-brand"
                    : "border-border bg-card"
                }`}
              >
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
                    className="rounded-full bg-card px-4 py-2 text-sm font-semibold text-ink active:scale-95"
                  >
                    ₦{v.toLocaleString()}
                  </button>
                ))}
              </div>
            </>
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
            Paid securely from your NGN balance via Flutterwave.
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
          <CheckCircle2 className="h-20 w-20 text-green-400" />
          <p className="mt-6 text-2xl font-extrabold text-ink">Payment successful</p>
          <p className="mt-2 text-sm text-muted">
            ₦{payAmount.toLocaleString()} {config.label} for {customer.trim()}.
          </p>
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

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="flex items-center gap-3 px-5 pb-4 pt-4">
      <button
        onClick={onBack}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink active:scale-95"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <h1 className="text-xl font-bold text-ink">{title}</h1>
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
