"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Plus,
  Check,
  Loader2,
  Trash2,
  ShieldCheck,
  Landmark,
} from "lucide-react";
import { NIGERIAN_BANKS } from "@cheqpay/shared";
import { api, ApiError, type Bank, type Beneficiary } from "@/services/api";

type Mode = "list" | "add";

export default function WithdrawBeneficiaryPage() {
  const router = useRouter();

  const [amount, setAmount] = useState(0);
  const [mode, setMode] = useState<Mode>("list");
  const [loading, setLoading] = useState(true);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [banks, setBanks] = useState<Bank[]>(NIGERIAN_BANKS as Bank[]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // Add-beneficiary form state
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("amount");
    setAmount(raw ? Number(raw.replace(/\D/g, "")) : 0);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [{ beneficiaries }, banksRes] = await Promise.all([
          api.getBeneficiaries(),
          api.getBanks().catch(() => ({ banks: [] as Bank[] })),
        ]);
        if (!active) return;
        setBeneficiaries(beneficiaries);
        if (banksRes.banks.length) setBanks(banksRes.banks);
        setSelectedId(beneficiaries[0]?.id ?? null);
        if (beneficiaries.length === 0) setMode("add");
      } catch {
        /* keep bank fallback; empty beneficiaries */
        setMode("add");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const bankName = useMemo(
    () => banks.find((b) => b.code === bankCode)?.name ?? "",
    [banks, bankCode]
  );
  const canResolve = bankCode !== "" && /^\d{10}$/.test(accountNumber) && !resolving;
  const selected = beneficiaries.find((b) => b.id === selectedId) ?? null;

  async function verify() {
    setAddError(null);
    setResolvedName(null);
    setResolving(true);
    try {
      const { accountName } = await api.resolveBankAccount({ accountNumber, bankCode });
      setResolvedName(accountName);
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : "Couldn’t verify that account. Check the details.");
    } finally {
      setResolving(false);
    }
  }

  async function save() {
    setAddError(null);
    setSaving(true);
    try {
      const { beneficiary } = await api.addBeneficiary({ bankCode, bankName, accountNumber });
      setBeneficiaries((prev) => [beneficiary, ...prev.filter((b) => b.id !== beneficiary.id)]);
      setSelectedId(beneficiary.id);
      setMode("list");
      setBankCode("");
      setAccountNumber("");
      setResolvedName(null);
    } catch (e) {
      setAddError(
        e instanceof ApiError ? e.message : "Couldn’t save this account. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this saved account?")) return;
    await api.deleteBeneficiary(id).catch(() => undefined);
    setBeneficiaries((prev) => prev.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  async function payout() {
    if (!selected) return;
    setPayError(null);
    setSubmitting(true);
    try {
      await api.createNgnWithdrawal({
        amount: String(amount),
        bankCode: selected.bankCode,
        accountNumber: selected.accountNumber,
      });
      router.replace(`/withdraw/done?amount=${amount}`);
    } catch (e) {
      setPayError(e instanceof ApiError ? e.message : "Withdrawal failed. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-6 pt-3">
        <button
          onClick={() => (mode === "add" && beneficiaries.length ? setMode("list") : router.back())}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <h1 className="mt-4 text-3xl font-extrabold text-ink">
          {mode === "add" ? "Add account" : "Choose account"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Withdrawing <span className="font-bold text-ink">₦{amount.toLocaleString("en-NG")}</span>
        </p>

        {loading ? (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-muted" />
          </div>
        ) : mode === "list" ? (
          <>
            <div className="mt-6 space-y-3">
              {beneficiaries.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setSelectedId(b.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left ${
                    selectedId === b.id ? "border-brand bg-brand/10" : "border-border bg-card"
                  }`}
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-circle">
                    <Landmark className="h-5 w-5 text-ink" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-ink">{b.accountName}</p>
                    <p className="truncate text-sm text-muted">
                      {b.bankName} · {b.accountNumber}
                    </p>
                  </div>
                  {selectedId === b.id ? (
                    <Check className="h-5 w-5 shrink-0 text-brand" />
                  ) : (
                    <Trash2
                      className="h-4 w-4 shrink-0 text-muted"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(b.id);
                      }}
                    />
                  )}
                </button>
              ))}
            </div>

            <button
              onClick={() => setMode("add")}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-4 font-bold text-brand-light active:scale-[0.99]"
            >
              <Plus className="h-5 w-5" /> Add a new account
            </button>

            {payError && <p className="mt-4 text-sm text-red-400">{payError}</p>}

            <div className="mt-auto pt-6">
              <button
                onClick={payout}
                disabled={!selected || submitting}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand to-brand-light py-4 text-base font-bold text-white active:scale-[0.98] disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-5 w-5 animate-spin" />}
                {submitting ? "Processing…" : `Withdraw ₦${amount.toLocaleString("en-NG")}`}
              </button>
            </div>
          </>
        ) : (
          // ---- Add beneficiary ----
          <>
            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-muted">Bank</label>
                <select
                  value={bankCode}
                  onChange={(e) => {
                    setBankCode(e.target.value);
                    setResolvedName(null);
                    setAddError(null);
                  }}
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink outline-none focus:border-brand"
                >
                  <option value="">Select a bank</option>
                  {banks.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-muted">
                  Account number
                </label>
                <input
                  value={accountNumber}
                  onChange={(e) => {
                    setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10));
                    setResolvedName(null);
                    setAddError(null);
                  }}
                  inputMode="numeric"
                  placeholder="10-digit NUBAN"
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand"
                />
              </div>

              {resolvedName ? (
                <div className="flex items-center gap-2 rounded-2xl border border-green-500/30 bg-green-500/10 p-4">
                  <ShieldCheck className="h-5 w-5 shrink-0 text-green-400" />
                  <p className="text-sm font-bold text-ink">{resolvedName}</p>
                </div>
              ) : (
                <button
                  onClick={verify}
                  disabled={!canResolve}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-card py-3.5 font-bold text-ink active:scale-[0.99] disabled:opacity-40"
                >
                  {resolving && <Loader2 className="h-5 w-5 animate-spin" />}
                  {resolving ? "Verifying…" : "Verify account"}
                </button>
              )}

              {addError && <p className="text-sm text-red-400">{addError}</p>}

              <div className="flex items-start gap-2 text-xs text-muted">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-light" />
                For your security, you can only withdraw to a bank account in your own name.
              </div>
            </div>

            {resolvedName && (
              <div className="mt-auto pt-6">
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand to-brand-light py-4 text-base font-bold text-white active:scale-[0.98] disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-5 w-5 animate-spin" />}
                  {saving ? "Saving…" : "Save account"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
