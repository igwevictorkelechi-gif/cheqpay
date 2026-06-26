"use client";

import { useRouter } from "next/navigation";
import { X, Users, MessageSquare, ChevronRight, LucideIcon } from "lucide-react";
import { Avatar } from "@/components/MobileUI";
import { authService } from "@/services/auth";
import { useAuthStore } from "@/store";

type Item = {
  title: string;
  subtitle: string;
  href?: string;
};

const items: Item[] = [
  {
    title: "Account",
    subtitle: "Personal details, invite friends, account limits, statements, delete account",
    href: "/settings",
  },
  { title: "Recipients", subtitle: "Bank accounts, Mobile money", href: "/send" },
  {
    title: "Connected bank accounts",
    subtitle: "Manage your payment accounts",
    href: "/settings",
  },
  {
    title: "Security",
    subtitle: "2FA, app lock, passcode, biometrics, instant withdrawal",
    href: "/settings",
  },
  {
    title: "Preferences",
    subtitle: "Notifications, display currency & app themes",
    href: "/settings",
  },
  {
    title: "About us",
    subtitle: "FAQs, privacy policy, our blog, contact us",
    href: "/settings",
  },
];

function FeatureCard({
  icon: Icon,
  title,
  subtitle,
  dark,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  dark?: boolean;
}) {
  return (
    <div
      className="flex flex-1 flex-col justify-between rounded-3xl p-4"
      style={{
        minHeight: 130,
        backgroundColor: dark ? "#161320" : "#3A3055",
      }}
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: dark ? "#2C2738" : "#6B5B95" }}
      >
        <Icon className="h-5 w-5 text-white" />
      </span>
      <div>
        <p className="text-base font-bold text-ink">{title}</p>
        <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const name = user?.full_name || "CheqPay User";
  const handle =
    "@" +
    (user?.email?.split("@")[0] ||
      name.split(" ")[0].toLowerCase() ||
      "cheqpay");

  const handleLogout = async () => {
    try {
      await authService.logout();
    } catch {
      // ignore — still clear local state
    }
    logout();
    router.push("/login");
  };

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-8 pt-3">
        {/* Close */}
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Identity */}
        <div className="mt-3 flex flex-col items-center">
          <div className="scale-150">
            <Avatar name={name} />
          </div>
          <h1 className="mt-6 text-2xl font-extrabold text-ink">{name}</h1>
          <span className="mt-2 rounded-full bg-card px-3 py-1 text-sm font-medium text-muted">
            {handle}
          </span>
        </div>

        {/* Feature cards */}
        <div className="mt-6 flex gap-4">
          <FeatureCard
            icon={Users}
            title="Join CheqPay Tribe"
            subtitle="For exclusive updates"
          />
          <FeatureCard
            icon={MessageSquare}
            title="Need help?"
            subtitle="Chat with us"
            dark
          />
        </div>

        {/* Menu */}
        <div className="mt-6 space-y-3">
          {items.map((item) => (
            <button
              key={item.title}
              onClick={() => item.href && router.push(item.href)}
              className="flex w-full items-center gap-4 rounded-2xl bg-card p-4 text-left"
            >
              <div className="flex-1">
                <p className="text-base font-bold text-ink">{item.title}</p>
                <p className="mt-0.5 text-sm text-muted">{item.subtitle}</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
            </button>
          ))}

          {/* Log out */}
          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-between rounded-2xl bg-card p-4 text-left"
          >
            <span className="text-base font-bold" style={{ color: "#EF4444" }}>
              Log out
            </span>
            <ChevronRight className="h-5 w-5" style={{ color: "#EF4444" }} />
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-muted">App v1.0.0 (1)</p>
      </div>
    </div>
  );
}
