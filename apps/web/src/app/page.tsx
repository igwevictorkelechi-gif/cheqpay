"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import MainLayout from "@/components/MainLayout";
import { authService } from "@/services/auth";
import { walletService } from "@/services/wallet";
import { useAuthStore, useWalletStore, useUIStore } from "@/store";
import { Eye, EyeOff, Copy, CheckCircle } from "lucide-react";
import { useState } from "react";

export default function WalletPage() {
  const router = useRouter();
  const { user, isAuthenticated, setUser, setLoading } = useAuthStore();
  const { wallet, virtualAccount, setWallet, setVirtualAccount } =
    useWalletStore();
  const { showBalance, toggleBalance } = useUIStore();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const currentUser = await authService.getCurrentUser();
        if (!currentUser) {
          router.push("/login");
          return;
        }
        setUser(currentUser);

        const walletData = await walletService.getWallet(currentUser.id);
        setWallet(walletData);

        const vaData = await walletService.getVirtualAccount(currentUser.id);
        setVirtualAccount(vaData);
      } catch (error) {
        console.error("Auth check failed:", error);
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Balance Card */}
        <div className="card-lg bg-gradient-to-br from-primary to-primary-dark text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium opacity-90">Available Balance</p>
              <div className="mt-2 flex items-center gap-3">
                {showBalance ? (
                  <p className="text-3xl font-bold">
                    ₦{(wallet?.balance || 0).toLocaleString()}
                  </p>
                ) : (
                  <p className="text-3xl font-bold">••••••</p>
                )}
                <button
                  onClick={toggleBalance}
                  className="rounded-full p-2 hover:bg-white/20"
                >
                  {showBalance ? (
                    <Eye className="h-5 w-5" />
                  ) : (
                    <EyeOff className="h-5 w-5" />
                  )}
                </button>
              </div>
              <p className="mt-3 text-xs opacity-75">
                Ledger Balance: ₦{(wallet?.ledger_balance || 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        {/* Virtual Account Card */}
        {virtualAccount && (
          <div className="card-lg border-2 border-primary">
            <h3 className="text-lg font-bold text-gray-900">
              Your Virtual Account
            </h3>
            <div className="mt-4 space-y-4 rounded-lg bg-gray-50 p-4">
              <div>
                <p className="text-xs font-medium text-gray-600 uppercase">
                  Account Number
                </p>
                <div className="mt-2 flex items-center justify-between rounded-lg bg-white p-3">
                  <span className="font-mono text-lg font-bold">
                    {virtualAccount.account_number}
                  </span>
                  <button
                    onClick={() => copyToClipboard(virtualAccount.account_number)}
                    className="rounded-lg p-2 transition-colors hover:bg-gray-100"
                  >
                    {copied ? (
                      <CheckCircle className="h-5 w-5 text-success" />
                    ) : (
                      <Copy className="h-5 w-5 text-gray-600" />
                    )}
                  </button>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-600 uppercase">
                  Bank
                </p>
                <p className="mt-2 text-lg font-bold">
                  {virtualAccount.bank_name}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-600 uppercase">
                  Provider
                </p>
                <div className="mt-2">
                  <span className="badge badge-info">
                    {virtualAccount.provider.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <a href="/send" className="card text-center hover:shadow-md transition-shadow">
            <div className="text-3xl">📤</div>
            <p className="mt-2 font-medium">Send Money</p>
          </a>
          <a href="/withdraw" className="card text-center hover:shadow-md transition-shadow">
            <div className="text-3xl">💳</div>
            <p className="mt-2 font-medium">Withdraw</p>
          </a>
          <a href="/kyc" className="card text-center hover:shadow-md transition-shadow">
            <div className="text-3xl">📋</div>
            <p className="mt-2 font-medium">KYC</p>
          </a>
          <a href="/settings" className="card text-center hover:shadow-md transition-shadow">
            <div className="text-3xl">⚙️</div>
            <p className="mt-2 font-medium">Settings</p>
          </a>
        </div>

        {/* Recent Transactions */}
        <div className="card-lg">
          <h3 className="text-lg font-bold text-gray-900">Recent Transactions</h3>
          <div className="mt-4 space-y-3">
            <p className="text-center text-sm text-gray-500 py-8">
              No transactions yet. Start by sending money or receiving funds.
            </p>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
