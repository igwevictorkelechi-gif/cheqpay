"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, AlertCircle, Loader2 } from "lucide-react";
import { useAuthStore } from "@/store";
import { api, ApiError, getAccessToken, type Me } from "@/services/api";

function LockedField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white/[0.03] px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-base text-muted">{value || "—"}</p>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      {!!value && <p className="text-xs text-muted">{label}</p>}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? label}
        className="w-full bg-transparent text-base text-ink outline-none placeholder:text-muted"
        style={{ marginTop: value ? 4 : 0 }}
      />
    </div>
  );
}

export default function PersonalDetailsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [me, setMe] = useState<Me | null>(null);
  const [username, setUsername] = useState("");
  const [dob, setDob] = useState("");
  const [nextOfKin, setNextOfKin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!(await getAccessToken())) return;
        const data = await api.getMe();
        setMe(data);
        setUsername(data.username ?? "@" + (data.email?.split("@")[0] ?? "cheqpay"));
        setDob(data.dateOfBirth ?? "");
        setNextOfKin(data.nextOfKin ?? "");
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const verified = (me?.kycTier ?? 0) >= 2;
  const fullName = user?.full_name || "CheqPay User";

  const dirty =
    !!me &&
    (username.replace(/^@+/, "") !== (me.username ?? "").replace(/^@+/, "") ||
      (!verified && dob !== (me.dateOfBirth ?? "")) ||
      nextOfKin !== (me.nextOfKin ?? ""));

  const save = async () => {
    if (!me || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const patch: { username?: string; dateOfBirth?: string; nextOfKin?: string } = {};
      const normUser = username.replace(/^@+/, "");
      if (normUser !== (me.username ?? "")) patch.username = normUser;
      if (!verified && dob !== (me.dateOfBirth ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        patch.dateOfBirth = dob;
      }
      if (nextOfKin !== (me.nextOfKin ?? "")) patch.nextOfKin = nextOfKin;
      const updated = await api.updateProfile(patch);
      setMe(updated);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError("That username is already in use. Try another.");
      } else if (e instanceof ApiError && e.status === 403) {
        setError("Date of birth cannot be changed on a verified account.");
      } else {
        setError("Could not save. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-10 pt-3">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <h1 className="mb-5 mt-6 text-4xl font-extrabold text-ink">Personal details</h1>

        {!me ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
          </div>
        ) : (
          <>
            <div className="space-y-3.5">
              <LockedField label="Full Name" value={fullName} />
              <EditField label="Username" value={username} onChange={setUsername} />

              {verified ? (
                <LockedField label="Date of birth" value={dob} />
              ) : (
                <EditField
                  label="Date of birth"
                  value={dob}
                  onChange={setDob}
                  placeholder="YYYY-MM-DD"
                />
              )}

              <LockedField label="Phone number" value={me.phone || ""} />
              <LockedField label="Email address" value={me.email || ""} />

              <div className="my-1.5 h-px bg-border" />

              <EditField
                label="Next of Kin"
                value={nextOfKin}
                onChange={setNextOfKin}
                placeholder="Next of Kin"
              />
            </div>

            {verified && (
              <div className="mt-6 flex items-start gap-3 rounded-2xl border-[1.5px] border-ink bg-card p-4">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink">
                  <AlertCircle className="h-4 w-4 text-surface" />
                </span>
                <p className="text-sm text-muted">
                  You cannot edit some fields because your account has been verified.{" "}
                  <button
                    onClick={() => router.push("/support")}
                    className="font-semibold text-green-400 underline"
                  >
                    Contact support
                  </button>{" "}
                  to make changes.
                </p>
              </div>
            )}

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

            <button
              onClick={save}
              disabled={!dirty || saving}
              className="mt-6 flex w-full items-center justify-center rounded-full py-4 text-base font-bold text-white disabled:cursor-not-allowed"
              style={{ backgroundColor: dirty && !saving ? "#6B5B95" : "#2C2738" }}
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Save changes"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
