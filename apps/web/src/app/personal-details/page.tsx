"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { useAuthStore } from "@/store";
import { api, getAccessToken } from "@/services/api";

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
  const [verified, setVerified] = useState(false);
  const [nextOfKin, setNextOfKin] = useState("");
  const [username, setUsername] = useState(
    "@" + (user?.email?.split("@")[0] || "cheqpay")
  );

  useEffect(() => {
    (async () => {
      try {
        if (!(await getAccessToken())) return;
        const { kycTier } = await api.getKyc();
        setVerified(kycTier >= 2);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const fullName = user?.full_name || "CheqPay User";

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

        <div className="space-y-3.5">
          {verified ? (
            <LockedField label="Full Name" value={fullName} />
          ) : (
            <EditField label="Full Name" value={fullName} onChange={() => {}} />
          )}

          <EditField label="Username" value={username} onChange={setUsername} />

          <LockedField label="Date of birth" value="" />
          <LockedField label="Phone number" value={user?.phone || ""} />
          <LockedField label="Email address" value={user?.email || ""} />

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
      </div>
    </div>
  );
}
