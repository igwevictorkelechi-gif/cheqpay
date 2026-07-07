"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Plus,
  Loader2,
  Trash2,
  ShieldCheck,
  Landmark,
} from "lucide-react";
import { NIGERIAN_BANKS } from "@cheqpay/shared";
import { api, ApiError, type Bank, type Beneficiary } from "@/services/api";

type Mode = "list" | "add";

/**
 * Manage the bank accounts saved for Naira withdrawals (beneficiaries). Unlike
 * the in-flow /withdraw/beneficiary screen, this is a standalone management
 * view opened from the profile menu — it only lists, adds and removes accounts.
 */
export default function BankAccountsPage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("list");
  const [loading, setLoading] = useState(true);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [banks, setBanks] = useState<Bank[]>(NIGERIAN_BANKS as Bank[]);

  // Add-account form state
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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
      } catch {
        /* keep bank fallback; empty beneficiaries */
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

  function resetForm() {
    setBankCode("");
    setAccountNumber("");
    setResolvedName(null);
    setAddError(null);
  }

  async function verify() {
    setAddError(null);
    setResolvedName(null);
    setResolving(true);
    try {
      const { accountName } = await api.resolveBankAccount({ accountNumber, bankCode });
      setResolvedName(accountName);
    } catch (e) {
      setAddError(
        e instanceof ApiError ? e.message : "Couldn’t verify that account. Check the details."
      );
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
      resetForm();
      setMode("list");
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
  }

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-6 pt-3">
        <button
          onClick={() => (mode === "add" ? (resetForm(), setMode("list")) : router.back())}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
          aria-label="Go back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <h1 className="mt-4 text-3xl font-extrabold text-ink">
          {mode === "add" ? "Add bank account" : "Bank accounts"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {mode === "add"
            ? "Add an account you can withdraw Naira to."
            : "Accounts saved for your Naira withdrawals."}
        </p>

        {loading ? (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-muted" />
          </div>
        ) : mode === "list" ? (
          <>
            {beneficiaries.length === 0 ? (
              <div className="mt-10 flex flex-col items-center text-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-circle">
                  <Landmark className="h-7 w-7 text-muted" />
                </span>
                <p className="mt-4 font-bold text-ink">No bank accounts yet</p>
                <p className="mt-1 max-w-[280px] text-sm text-muted">
                  Add a bank account in your name to withdraw your Naira balance.
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                {beneficiaries.map((b) => (
                  <div
                    key={b.id}
                    className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4"
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
                    <button
                      onClick={() => remove(b.id)}
                      aria-label="Remove account"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-soft active:scale-90"
                    >
                      <Trash2 className="h-4 w-4 text-muted" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setMode("add")}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-4 font-bold text-brand-light active:scale-[0.99]"
            >
              <Plus className="h-5 w-5" /> Add a new account
            </button>

            <div className="mt-6 flex items-start gap-2 text-xs text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-light" />
              For your security, you can only withdraw to a bank account in your own name.
            </div>
          </>
        ) : (
          // ---- Add account ----
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
