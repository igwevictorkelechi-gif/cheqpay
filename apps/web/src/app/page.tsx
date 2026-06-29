"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Eye, EyeOff, Bell, ArrowDown, ArrowRight, RefreshCw } from "lucide-react";
import AppShell from "@/components/AppShell";
import {
  TopBar,
  BalanceBlock,
  ActionRow,
  CircleAction,
  Card,
  NairaFlag,
  SectionHeader,
  useToast,
} from "@/components/MobileUI";
import { authService } from "@/services/auth";
import { walletService } from "@/services/wallet";
import { useAuthStore, useWalletStore, useUIStore } from "@/store";

export default function HomePage() {
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const { wallet, setWallet, setVirtualAccount } = useWalletStore();
  const { showBalance, toggleBalance } = useUIStore();
  const [, setReady] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const load = async () => {
      try {
        const currentUser = await authService.getCurrentUser();
        if (currentUser) {
          setUser(currentUser);
          const [walletData, vaData] = await Promise.all([
            walletService.getWallet(currentUser.id),
            walletService.getVirtualAccount(currentUser.id),
          ]);
          if (walletData) setWallet(walletData);
          if (vaData) setVirtualAccount(vaData);
        }
      } catch (error) {
        console.error("Load failed:", error);
      } finally {
        setReady(true);
      }
    };
    load();
  }, [setUser, setWallet, setVirtualAccount]);

  const balance = wallet?.balance ?? 0;
  const formattedBalance = showBalance
    ? "₦" +
      balance.toLocaleString("en-NG", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "₦••••";

  return (
    <AppShell>
      <TopBar
        name={user?.full_name}
        onAvatar={() => router.push("/profile")}
        icons={[
          { icon: Search, onClick: () => router.push("/transactions") },
          { icon: showBalance ? Eye : EyeOff, onClick: toggleBalance },
          { icon: Bell, onClick: () => toast.show("No new notifications") },
        ]}
      />

      <BalanceBlock label="Total Cash Balance" amount={formattedBalance} />

      <ActionRow>
        <CircleAction icon={ArrowDown} label="Deposit" onClick={() => router.push("/deposit")} />
        <CircleAction icon={ArrowRight} label="Withdraw" onClick={() => router.push("/withdraw")} />
        <CircleAction icon={RefreshCw} label="Convert" onClick={() => router.push("/convert")} />
      </ActionRow>

      {/* Cash account */}
      <div className="mb-4 px-5">
        <Card>
          <p className="mb-4 text-base font-medium text-muted">Cash</p>
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <NairaFlag />
              <div className="ml-3">
                <p className="text-lg font-bold text-ink">NGN</p>
                <p className="text-sm text-muted">Naira</p>
              </div>
            </div>
            <p className="text-lg font-bold text-ink">
              {showBalance ? `${balance.toLocaleString("en-NG")} NGN` : "•••• NGN"}
            </p>
          </div>
        </Card>
      </div>

      {/* Savings */}
      <div className="mb-6 px-5">
        <Card>
          <div className="flex items-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-circle text-[22px]">
              📊
            </span>
            <div className="ml-4 flex-1">
              <p className="text-xl font-bold text-ink">Your money. Working daily</p>
              <p className="mt-1 text-sm text-muted">
                Daily returns in NGN or USD. Flexible or fixed savings
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Transactions */}
      <div className="px-5">
        <SectionHeader title="Transactions" onClick={() => router.push("/transactions")} />
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center">
            <NairaFlag size={44} />
            <div className="ml-3">
              <p className="text-base font-bold text-ink">VICTOR IGWE</p>
              <p className="text-sm text-muted">Jun 21, 2026</p>
            </div>
          </div>
          <p className="text-base font-bold text-ink">-60,521.3 NGN</p>
        </div>
      </div>
      {toast.node}
    </AppShell>
  );
}
