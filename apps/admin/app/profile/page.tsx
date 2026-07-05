"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { ShieldCheck, AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";

export default function AdminProfilePage() {
  const [email, setEmail] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const load = async () => {
    try {
      const r = await fetch("/api/profile");
      const d = await r.json();
      if (r.ok) {
        setEmail(d.email ?? "");
        setNewEmail(d.email ?? "");
        setIsDefault(!!d.isDefault);
      }
    } catch {
      /* ignore */
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const canSave =
    currentPassword.length > 0 &&
    (newEmail.trim().toLowerCase() !== email.toLowerCase() || newPassword.length > 0) &&
    (newPassword.length === 0 || newPassword === confirm) &&
    !saving;

  const save = async () => {
    setError(null);
    setOk(false);
    if (newPassword && newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword && newPassword !== confirm) {
      setError("New passwords don’t match.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, string> = { currentPassword };
      if (newEmail.trim().toLowerCase() !== email.toLowerCase()) payload.email = newEmail.trim();
      if (newPassword) payload.newPassword = newPassword;

      const r = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error || "Could not update credentials.");
        return;
      }
      setEmail(d.email ?? newEmail);
      setIsDefault(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setOk(true);
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
            <ShieldCheck size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin Profile</h1>
            <p className="text-sm text-gray-500">Manage the admin dashboard login credentials</p>
          </div>
        </div>

        {isDefault && loaded && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <span>
              You’re using the <strong>default password</strong>. Change it now to secure the
              dashboard.
            </span>
          </div>
        )}

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="mb-4">
            <p className="text-sm text-gray-500">Current admin email</p>
            <p className="text-base font-semibold text-gray-900">{email || "—"}</p>
          </div>

          <div className="space-y-4 border-t border-gray-100 pt-4">
            <Field label="New email" type="email" value={newEmail} onChange={setNewEmail} />
            <Field
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
              placeholder="Required to save changes"
            />
            <Field
              label="New password"
              type="password"
              value={newPassword}
              onChange={setNewPassword}
              placeholder="Leave blank to keep current"
            />
            {newPassword.length > 0 && (
              <Field
                label="Confirm new password"
                type="password"
                value={confirm}
                onChange={setConfirm}
              />
            )}

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            {ok && (
              <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                <CheckCircle2 size={16} /> Credentials updated.
              </div>
            )}

            <button
              onClick={save}
              disabled={!canSave}
              className="flex items-center justify-center rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
      />
    </div>
  );
}
