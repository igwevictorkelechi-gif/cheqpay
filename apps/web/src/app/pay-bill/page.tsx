"use client";

import { useRouter } from "next/navigation";
import {
  Search,
  Bell,
  ChevronDown,
  Smartphone,
  Wifi,
  Dice5,
  Zap,
  Tv,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { TopBar, Card, useToast } from "@/components/MobileUI";
import { useAuthStore } from "@/store";

type Service = {
  label: string;
  icon: LucideIcon;
  color: string;
  route?: string;
  badge?: string;
};

const services: Service[] = [
  { label: "Airtime", icon: Smartphone, color: "#7C5CFF", route: "/pay-bill/airtime" },
  { label: "Data", icon: Wifi, color: "#2E8BFF", route: "/pay-bill/data" },
  { label: "Betting", icon: Dice5, color: "#16A34A", route: "/pay-bill/betting" },
  { label: "Electricity", icon: Zap, color: "#F5A623", route: "/pay-bill/electricity", badge: "New" },
  { label: "Cable TV", icon: Tv, color: "#EC4899", route: "/pay-bill/cabletv", badge: "New" },
  { label: "Vouchers", icon: Ticket, color: "#6E6880" },
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
            {services.map((service) => {
              const Icon = service.icon;
              return (
                <button
                  key={service.label}
                  onClick={() =>
                    service.route
                      ? router.push(service.route)
                      : toast.show(`${service.label} — coming soon`)
                  }
                  className="mb-3 flex h-24 w-[48%] flex-col rounded-2xl p-4 text-left transition active:scale-95"
                  style={{ backgroundColor: "#2A2440" }}
                >
                  <div className="flex items-start justify-between">
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-xl"
                      style={{ backgroundColor: `${service.color}22` }}
                    >
                      <Icon className="h-5 w-5" style={{ color: service.color }} />
                    </span>
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
              );
            })}
          </div>
        </Card>
      </div>

      {/* Payment history shortcut */}
      <div className="px-5">
        <Card>
          <button
            onClick={() => router.push("/transactions")}
            className="flex w-full items-center"
          >
            <span className="text-[26px]">🧾</span>
            <div className="ml-4 flex-1 text-left">
              <p className="text-lg font-bold text-ink">Payment history</p>
              <p className="mt-1 text-sm text-muted">
                View your airtime, data and bill payments.
              </p>
            </div>
            <ChevronDown className="h-5 w-5 -rotate-90 text-muted" />
          </button>
        </Card>
      </div>
      {toast.node}
    </AppShell>
  );
}
