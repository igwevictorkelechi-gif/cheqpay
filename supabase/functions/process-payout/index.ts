import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';

interface ProcessPayoutPayload {
  user_id: string;
  amount: number;
  bank_account_number: string;
  bank_code: string;
  narration?: string;
  provider?: 'paystack' | 'flutterwave';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload: ProcessPayoutPayload = await req.json();
    const { user_id, amount, bank_account_number, bank_code, narration, provider } = payload;

    // Validate input
    if (!user_id || !amount || !bank_account_number || !bank_code) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check user wallet balance
    const { data: walletData, error: walletError } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', user_id)
      .single();

    if (walletError || !walletData || walletData.balance < amount) {
      return new Response(
        JSON.stringify({ error: 'Insufficient funds' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Determine provider (fallback to paystack)
    let payoutProvider = provider || 'paystack';

    // Get payment config for provider
    const { data: configData, error: configError } = await supabase
      .from('payment_configs')
      .select('secret_key_encrypted')
      .eq('provider', payoutProvider)
      .eq('is_active', true)
      .single();

    if (configError || !configData) {
      return new Response(
        JSON.stringify({ error: 'Payment provider not configured' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const reference = `PAYOUT_${user_id}_${Date.now()}`;
    let payoutResponse;

    if (payoutProvider === 'paystack') {
      // Create transfer recipient
      const recipientRes = await fetch('https://api.paystack.co/transferrecipient', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${configData.secret_key_encrypted}`,
        },
        body: JSON.stringify({
          type: 'nuban',
          account_number: bank_account_number,
          bank_code: bank_code,
          currency: 'NGN',
        }),
      });

      const recipientData = await recipientRes.json();

      if (!recipientRes.ok) {
        console.error('Recipient creation failed:', recipientData);
        return new Response(
          JSON.stringify({ error: 'Failed to process payout', details: recipientData }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Initiate transfer
      payoutResponse = await fetch('https://api.paystack.co/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${configData.secret_key_encrypted}`,
        },
        body: JSON.stringify({
          source: 'balance',
          recipient: recipientData.data.recipient_code,
          amount: Math.round(amount * 100), // Convert to kobo
          reason: narration || 'Wallet withdrawal',
          reference,
        }),
      });
    } else if (payoutProvider === 'flutterwave') {
      // Flutterwave transfer/payout
      payoutResponse = await fetch('https://api.flutterwave.com/v3/transfers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${configData.secret_key_encrypted}`,
        },
        body: JSON.stringify({
          account_bank: bank_code,
          account_number: bank_account_number,
          amount: amount,
          narration: narration || 'Wallet withdrawal',
          currency: 'NGN',
          reference,
          meta: {
            user_id,
          },
        }),
      });
    }

    const payoutData = await payoutResponse?.json();

    if (!payoutResponse?.ok) {
      console.error('Payout Error:', payoutData);
      return new Response(
        JSON.stringify({ error: 'Failed to process payout', details: payoutData }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Deduct from wallet
    const newBalance = walletData.balance - amount;
    const { error: updateError } = await supabase
      .from('wallets')
      .update({ balance: newBalance, ledger_balance: newBalance })
      .eq('user_id', user_id);

    if (updateError) {
      console.error('Wallet update failed:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update wallet' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create transaction record
    const { error: txError } = await supabase.from('transactions').insert({
      user_id,
      type: 'withdrawal',
      amount,
      reference,
      narration: `Withdrawal to ${bank_account_number}`,
      status: 'pending',
      metadata: {
        bank_account_number,
        bank_code,
        provider: payoutProvider,
        external_ref: payoutData.data.id || payoutData.data.transfer_id,
      },
    });

    if (txError) {
      console.error('Transaction creation failed:', txError);
    }

    // Log audit
    await supabase.from('audit_logs').insert({
      user_id,
      action: 'WITHDRAWAL_INITIATED',
      resource_type: 'transaction',
      details: {
        amount,
        bank_account_number,
        reference,
        provider: payoutProvider,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Withdrawal initiated successfully',
        data: {
          reference,
          amount,
          status: 'pending',
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
