import { supabase } from "./supabase";
import type {
  Wallet,
  VirtualAccount,
  Transaction,
  SendMoneyPayload,
  WithdrawPayload,
} from "@cheqpay/shared";

export const walletService = {
  async getWallet(userId: string): Promise<Wallet | null> {
    try {
      const { data } = await supabase
        .from("wallets")
        .select("*")
        .eq("user_id", userId)
        .single();

      return data;
    } catch (error) {
      console.error("getWallet error:", error);
      return null;
    }
  },

  async getVirtualAccount(userId: string): Promise<VirtualAccount | null> {
    try {
      const { data } = await supabase
        .from("virtual_accounts")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .single();

      return data;
    } catch (error) {
      console.error("getVirtualAccount error:", error);
      return null;
    }
  },

  async getTransactions(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Transaction[]> {
    try {
      const { data } = await supabase
        .from("transactions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      return data || [];
    } catch (error) {
      console.error("getTransactions error:", error);
      return [];
    }
  },

  async sendMoney(userId: string, payload: SendMoneyPayload) {
    try {
      const response = await fetch("/api/wallet/send-money", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, ...payload }),
      });

      if (!response.ok) throw new Error("Send money failed");
      return await response.json();
    } catch (error) {
      console.error("sendMoney error:", error);
      throw error;
    }
  },

  async initiateWithdrawal(userId: string, payload: WithdrawPayload) {
    try {
      const response = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, ...payload }),
      });

      if (!response.ok) throw new Error("Withdrawal failed");
      return await response.json();
    } catch (error) {
      console.error("initiateWithdrawal error:", error);
      throw error;
    }
  },

  subscribeToWallet(userId: string, callback: (wallet: Wallet) => void) {
    const channel = supabase
      .channel(`wallets:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "wallets",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          callback(payload.new as Wallet);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  subscribeToTransactions(
    userId: string,
    callback: (transaction: Transaction) => void
  ) {
    const channel = supabase
      .channel(`transactions:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "transactions",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          callback(payload.new as Transaction);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
};
