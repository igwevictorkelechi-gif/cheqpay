"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MainLayout from "@/components/MainLayout";
import { useAuthStore, useWalletStore } from "@/store";
import { walletService } from "@/services/wallet";
import { Send } from "lucide-react";

export default function SendMoneyPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { wallet, updateBalance } = useWalletStore();
  const [formData, setFormData] = useState({
    recipientPhone: "",
    amount: "",
    narration: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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

    // Validate phone
    const phoneRegex = /^(\+234|0)[0-9]{10}$/;
    if (!phoneRegex.test(formData.recipientPhone.replace(/\s/g, ""))) {
      setError("Invalid recipient phone number");
      setLoading(false);
      return;
    }

    // Validate amount
    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount < 50) {
      setError("Minimum amount is ₦50");
      setLoading(false);
      return;
    }

    if (amount > 5000000) {
      setError("Maximum amount is ₦5,000,000");
      setLoading(false);
      return;
    }

    // Check balance
    if (!wallet || wallet.balance < amount) {
      setError("Insufficient balance");
      setLoading(false);
      return;
    }

    try {
      if (!user) throw new Error("User not found");

      await walletService.sendMoney(user.id, {
        recipient_phone: formData.recipientPhone,
        amount,
        narration: formData.narration,
      });

      updateBalance(-amount);
      setSuccess("Money sent successfully!");
      setFormData({ recipientPhone: "", amount: "", narration: "" });

      setTimeout(() => router.push("/transactions"), 2000);
    } catch (err) {
      setError("Failed to send money. Please try again.");
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
            <Send className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Send Money</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="label">Recipient Phone Number</label>
              <input
                type="tel"
                name="recipientPhone"
                value={formData.recipientPhone}
                onChange={handleChange}
                placeholder="+234 81 2345 6789"
                className="input"
                disabled={loading}
              />
              <p className="mt-1 text-xs text-gray-500">
                Recipient must be a Cheqpay user
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
                Min: ₦50 | Max: ₦5,000,000
              </p>
            </div>

            <div>
              <label className="label">Narration (Optional)</label>
              <textarea
                name="narration"
                value={formData.narration}
                onChange={handleChange}
                placeholder="What is this payment for?"
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
              disabled={loading || !formData.recipientPhone || !formData.amount}
              className="btn-primary w-full"
            >
              {loading ? "Processing..." : "Send Money"}
            </button>
          </form>
        </div>
      </div>
    </MainLayout>
  );
}
