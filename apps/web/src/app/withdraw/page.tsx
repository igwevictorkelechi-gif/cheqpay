"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MainLayout from "@/components/MainLayout";
import { useAuthStore, useWalletStore } from "@/store";
import { walletService } from "@/services/wallet";
import { CreditCard } from "lucide-react";
import { NIGERIAN_BANKS } from "@cheqpay/shared";

export default function WithdrawPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { wallet, updateBalance } = useWalletStore();
  const [formData, setFormData] = useState({
    bankCode: "",
    accountNumber: "",
    amount: "",
    narration: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    // Validate form
    if (!formData.bankCode) {
      setError("Please select a bank");
      setLoading(false);
      return;
    }

    if (formData.accountNumber.length !== 10) {
      setError("Account number must be 10 digits");
      setLoading(false);
      return;
    }

    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount < 100) {
      setError("Minimum withdrawal is ₦100");
      setLoading(false);
      return;
    }

    if (amount > 5000000) {
      setError("Maximum withdrawal is ₦5,000,000");
      setLoading(false);
      return;
    }

    if (!wallet || wallet.balance < amount) {
      setError("Insufficient balance");
      setLoading(false);
      return;
    }

    try {
      if (!user) throw new Error("User not found");

      await walletService.initiateWithdrawal(user.id, {
        bank_account_number: formData.accountNumber,
        bank_code: formData.bankCode,
        amount,
        narration: formData.narration,
      });

      updateBalance(-amount);
      setSuccess("Withdrawal initiated! Funds will arrive in 1-2 business days.");
      setFormData({ bankCode: "", accountNumber: "", amount: "", narration: "" });

      setTimeout(() => router.push("/transactions"), 2000);
    } catch (err) {
      setError("Failed to initiate withdrawal. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <MainLayout>
      <div className="max-w-2xl mx-auto">
        <div className="card-lg">
          <div className="flex items-center gap-3 mb-6">
            <CreditCard className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Withdraw Money</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="label">Select Bank</label>
              <select
                name="bankCode"
                value={formData.bankCode}
                onChange={handleChange}
                className="input"
                disabled={loading}
              >
                <option value="">-- Choose a bank --</option>
                {NIGERIAN_BANKS.map((bank) => (
                  <option key={bank.code} value={bank.code}>
                    {bank.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Account Number</label>
              <input
                type="text"
                name="accountNumber"
                value={formData.accountNumber}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, "").slice(0, 10);
                  setFormData({ ...formData, accountNumber: value });
                }}
                placeholder="0123456789"
                maxLength={10}
                className="input font-mono"
                disabled={loading}
              />
              <p className="mt-1 text-xs text-gray-500">
                Must be 10 digits
              </p>
            </div>

            <div>
              <label className="label">Amount (₦)</label>
              <input
                type="number"
                name="amount"
                value={formData.amount}
                onChange={handleChange}
                placeholder="1,000"
                className="input"
                disabled={loading}
              />
              <p className="mt-1 text-xs text-gray-500">
                Min: ₦100 | Max: ₦5,000,000
              </p>
            </div>

            <div>
              <label className="label">Narration (Optional)</label>
              <textarea
                name="narration"
                value={formData.narration}
                onChange={handleChange}
                placeholder="Why are you withdrawing?"
                className="input resize-none"
                rows={3}
                disabled={loading}
              />
            </div>

            {/* Balance Info */}
            <div className="rounded-lg bg-blue-50 p-4 border border-blue-200">
              <p className="text-sm text-blue-900">
                Available Balance: <strong>₦{(wallet?.balance || 0).toLocaleString()}</strong>
              </p>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800 border border-red-200">
                {error}
              </div>
            )}

            {success && (
              <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800 border border-green-200">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={
                loading ||
                !formData.bankCode ||
                !formData.accountNumber ||
                !formData.amount
              }
              className="btn-primary w-full"
            >
              {loading ? "Processing..." : "Withdraw"}
            </button>
          </form>
        </div>
      </div>
    </MainLayout>
  );
}
