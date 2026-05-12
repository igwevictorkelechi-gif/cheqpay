"use client";

import { useState, useEffect } from "react";
import MainLayout from "@/components/MainLayout";
import { useAuthStore, useWalletStore } from "@/store";
import { walletService } from "@/services/wallet";
import { ArrowDownLeft, ArrowUpRight, Banknote } from "lucide-react";
import type { Transaction } from "@cheqpay/shared";

const getTransactionIcon = (type: string) => {
  switch (type) {
    case "credit":
      return <ArrowDownLeft className="h-5 w-5 text-success" />;
    case "debit":
    case "transfer":
      return <ArrowUpRight className="h-5 w-5 text-danger" />;
    case "withdrawal":
      return <Banknote className="h-5 w-5 text-warning" />;
    default:
      return <Banknote className="h-5 w-5 text-gray-400" />;
  }
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case "completed":
      return <span className="badge badge-success">Completed</span>;
    case "pending":
      return <span className="badge badge-warning">Pending</span>;
    case "failed":
      return <span className="badge badge-danger">Failed</span>;
    default:
      return <span className="badge">{status}</span>;
  }
};

export default function TransactionsPage() {
  const { user } = useAuthStore();
  const { transactions, setTransactions } = useWalletStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTransactions = async () => {
      try {
        if (!user) return;
        const txns = await walletService.getTransactions(user.id);
        setTransactions(txns);
      } catch (error) {
        console.error("Failed to load transactions:", error);
      } finally {
        setLoading(false);
      }
    };

    loadTransactions();
  }, [user, setTransactions]);

  return (
    <MainLayout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Transaction History</h1>

        <div className="card-lg">
          {loading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="skeleton h-16" />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <div className="py-12 text-center">
              <Banknote className="h-12 w-12 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">No transactions yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                      Type
                    </th>
                    <th className="hidden sm:table-cell px-4 py-3 text-left text-sm font-semibold text-gray-700">
                      Reference
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                      Amount
                    </th>
                    <th className="hidden md:table-cell px-4 py-3 text-center text-sm font-semibold text-gray-700">
                      Status
                    </th>
                    <th className="hidden lg:table-cell px-4 py-3 text-right text-sm font-semibold text-gray-700">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((txn: Transaction) => (
                    <tr
                      key={txn.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="rounded-full p-2 bg-gray-100">
                            {getTransactionIcon(txn.type)}
                          </div>
                          <span className="font-medium text-gray-900 capitalize">
                            {txn.type}
                          </span>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-4 text-sm text-gray-600">
                        {txn.reference}
                      </td>
                      <td className="px-4 py-4 text-right font-bold text-gray-900">
                        ₦{txn.amount.toLocaleString()}
                      </td>
                      <td className="hidden md:table-cell px-4 py-4 text-center">
                        {getStatusBadge(txn.status)}
                      </td>
                      <td className="hidden lg:table-cell px-4 py-4 text-right text-sm text-gray-600">
                        {new Date(txn.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
