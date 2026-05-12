import { supabase } from './supabase';
import { Wallet, Transaction, VirtualAccount, SendMoneyPayload, WithdrawPayload } from '@cheqpay/shared';

export const walletService = {
  async getWallet(userId: string): Promise<Wallet | null> {
    try {
      const { data, error } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        console.error('Get wallet error:', error);
        return null;
      }
      return data;
    } catch (error) {
      console.error('Get wallet error:', error);
      return null;
    }
  },

  async getVirtualAccount(userId: string): Promise<VirtualAccount | null> {
    try {
      const { data, error } = await supabase
        .from('virtual_accounts')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .single();

      if (error) {
        console.error('Get virtual account error:', error);
        return null;
      }
      return data;
    } catch (error) {
      console.error('Get virtual account error:', error);
      return null;
    }
  },

  async getTransactions(
    userId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<Transaction[] | null> {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('Get transactions error:', error);
        return null;
      }
      return data;
    } catch (error) {
      console.error('Get transactions error:', error);
      return null;
    }
  },

  async sendMoney(userId: string, payload: SendMoneyPayload) {
    try {
      const { data, error } = await supabase.functions.invoke('send-money', {
        body: {
          user_id: userId,
          ...payload,
        },
      });

      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      console.error('Send money error:', error);
      return { success: false, error };
    }
  },

  async initiateWithdrawal(userId: string, payload: WithdrawPayload) {
    try {
      const { data, error } = await supabase.functions.invoke('process-payout', {
        body: {
          user_id: userId,
          ...payload,
        },
      });

      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      console.error('Withdrawal error:', error);
      return { success: false, error };
    }
  },

  // Listen to wallet real-time updates
  subscribeToWallet(userId: string, callback: (wallet: Wallet) => void) {
    const subscription = supabase
      .from(`wallets:user_id=eq.${userId}`)
      .on('*', (payload) => {
        if (payload.new) {
          callback(payload.new as Wallet);
        }
      })
      .subscribe();

    return subscription;
  },

  // Listen to transaction real-time updates
  subscribeToTransactions(userId: string, callback: (tx: Transaction) => void) {
    const subscription = supabase
      .from(`transactions:user_id=eq.${userId}`)
      .on('INSERT', (payload) => {
        if (payload.new) {
          callback(payload.new as Transaction);
        }
      })
      .subscribe();

    return subscription;
  },
};
