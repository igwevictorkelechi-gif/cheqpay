"use client";

import { useRouter } from "next/navigation";
import { Search, Bell, ChevronDown } from "lucide-react";
import AppShell from "@/components/AppShell";
import { TopBar, Card, useToast } from "@/components/MobileUI";
import { useAuthStore } from "@/store";

type Service = { label: string; emoji: string; badge?: string };

const services: Service[] = [
  { label: "Airtime", emoji: "📲" },
  { label: "Data", emoji: "📶" },
  { label: "Betting", emoji: "🎰" },
  { label: "Electricity", emoji: "💡", badge: "New" },
  { label: "Cable TV", emoji: "📺", badge: "New" },
  { label: "Vouchers", emoji: "🎟️" },
];

export default function PayBillPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const toast = useToast();

  return (
    <AppShell>
      <TopBar
        name={user?.full_name}
        onAvatar={() => router.push("/profile")}
        icons={[
          { icon: Search, onClick: () => router.push("/transactions") },
          { icon: Bell, onClick: () => toast.show("No new notifications") },
        ]}
      />

      <h1 className="mb-5 mt-3 px-5 text-[32px] font-extrabold text-ink">
        Quick payments
      </h1>

      {/* Services */}
      <div className="mb-5 px-5">
        <Card>
          <div className="mb-5 flex items-center justify-between">
            <p className="text-base font-bold text-ink">Showing services in</p>
            <button
              onClick={() => toast.show("More countries coming soon")}
              className="flex items-center gap-1.5 rounded-full bg-circle px-3 py-1.5"
            >
              <span className="text-sm">🇳🇬</span>
              <span className="text-sm font-semibold text-ink">Nigeria</span>
              <ChevronDown className="h-4 w-4 text-muted" />
            </button>
          </div>

          <div className="flex flex-wrap justify-between">
            {services.map((service) => (
              <button
                key={service.label}
                onClick={() => toast.show(`${service.label} — coming soon`)}
                className="mb-3 flex h-24 w-[48%] flex-col rounded-2xl p-4 text-left transition active:scale-95"
                style={{ backgroundColor: "#2A2440" }}
              >
                <div className="flex items-start justify-between">
                  <span className="text-[26px]">{service.emoji}</span>
                  {service.badge ? (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">
                      {service.badge}
                    </span>
                  ) : null}
                </div>
                <span className="mt-auto text-base font-bold text-ink">
                  {service.label}
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Empty transactions */}
      <div className="px-5">
        <Card>
          <div className="flex items-center">
            <span className="text-[26px]">🧾</span>
            <div className="ml-4 flex-1">
              <p className="text-lg font-bold text-ink">No transactions yet</p>
              <p className="mt-1 text-sm text-muted">
                Your first transaction will show up here, make it count!
              </p>
            </div>
          </div>
        </Card>
      </div>
      {toast.node}
    </AppShell>
  );
}
