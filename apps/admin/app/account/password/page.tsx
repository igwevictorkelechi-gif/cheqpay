"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import { KeyRound, AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";

// A sub admin's own password. On first sign-in they land here and can't open
// anything else until they've replaced the starting password they were given.
export default function AccountPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [mustChange, setMustChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (d.role === "super") {
          router.replace("/profile");
          return;
        }
        setEmail(d.email ?? "");
        setMustChange(!!d.mustChangePassword);
      })
      .catch(() => {});
  }, [router]);

  const strong = newPassword.length >= 12 && /[A-Za-z]/.test(newPassword) && /\d/.test(newPassword);
  const canSave = currentPassword.length > 0 && strong && newPassword === confirm && !saving;

  const save = async () => {
    setError(null);
    setOk(false);
    setSaving(true);
    try {
      const r = await fetch("/api/account/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error || "Could not change your password.");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setOk(true);
      if (mustChange) {
        setMustChange(false);
        router.replace("/dashboard");
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
            <KeyRound size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Change password</h1>
            <p className="text-sm text-gray-500">{email || "Your sub admin account"}</p>
          </div>
        </div>

        {mustChange && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <span>
              Welcome! You’re signed in with the <strong>starting password</strong> you were given.
              Set your own password to continue to the dashboard.
            </span>
          </div>
        )}

        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
          <Field
            label={mustChange ? "Starting password" : "Current password"}
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
          />
          <Field label="New password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          <p className="-mt-2 text-xs text-gray-500">At least 12 characters, with letters and numbers.</p>
          <Field label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          {confirm.length > 0 && newPassword !== confirm && (
            <p className="-mt-2 text-xs text-red-600">Passwords don’t match.</p>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}
          {ok && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
              <CheckCircle2 size={16} /> Password changed.
            </div>
          )}

          <button
            onClick={save}
            disabled={!canSave}
            className="flex items-center justify-center rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save new password"}
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Field({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
      />
    </div>
  );
}
