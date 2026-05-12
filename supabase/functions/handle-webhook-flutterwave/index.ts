import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { createHmac } from 'https://esm.sh/crypto';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const flutterwaveSecret = Deno.env.get('FLUTTERWAVE_SECRET_KEY') || '';

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify webhook signature
    const signature = req.headers.get('verifi-hash') || '';
    const body = await req.text();

    const hash = createHmac('sha256', flutterwaveSecret)
      .update(body)
      .digest('base64');

    if (signature !== hash) {
      console.warn('Invalid webhook signature');
      return new Response(
        JSON.stringify({ status: 'unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const event = JSON.parse(body);

    // Handle credit event (incoming transfer to virtual account)
    if (event.event === 'credit' && event.data.status === 'successful') {
      const { amount, reference, narration, customer } = event.data;

      // Find user with virtual account matching this transfer
      const { data: vaData, error: vaError } = await supabase
        .from('virtual_accounts')
        .select('user_id')
        .eq('reference', reference)
        .single();

      if (vaError || !vaData) {
        console.warn('Virtual account not found for reference:', reference);
        return new Response(JSON.stringify({ status: 'processed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const userId = vaData.user_id;

      // Get current wallet balance
      const { data: walletData, error: walletError } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', userId)
        .single();

      if (walletError) {
        console.error('Wallet not found:', walletError);
        return new Response(JSON.stringify({ status: 'error' }), { status: 400 });
      }

      const newBalance = walletData.balance + amount;

      // Update wallet balance
      const { error: updateError } = await supabase
        .from('wallets')
        .update({ balance: newBalance, ledger_balance: newBalance })
        .eq('user_id', userId);

      if (updateError) {
        console.error('Failed to update wallet:', updateError);
        return new Response(JSON.stringify({ status: 'error' }), { status: 400 });
      }

      // Create transaction record
      const { error: txError } = await supabase.from('transactions').insert({
        user_id: userId,
        type: 'credit',
        amount,
        reference,
        narration: `Fund Wallet - ${narration || 'Bank Transfer'}`,
        status: 'completed',
        metadata: {
          flutterwave_reference: reference,
          customer_info: customer || {},
          provider: 'flutterwave',
        },
      });

      if (txError) {
        console.error('Failed to create transaction:', txError);
      }

      // Log audit
      await supabase.from('audit_logs').insert({
        user_id: userId,
        action: 'WALLET_FUNDED',
        resource_type: 'wallet',
        details: {
          amount,
          reference,
          provider: 'flutterwave',
        },
      });

      console.log(`✅ Wallet credited: User ${userId}, Amount: ₦${amount}`);
    }

    // Handle transfer success event (for payouts)
    if (event.event === 'Transfer' && event.data.status === 'success') {
      const { reference } = event.data;

      // Find transaction with this reference
      const { data: txData, error: txError } = await supabase
        .from('transactions')
        .select('id')
        .eq('reference', reference)
        .eq('type', 'withdrawal')
        .single();

      if (txError || !txData) {
        console.warn('Transaction not found for withdrawal reference:', reference);
        return new Response(JSON.stringify({ status: 'processed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Update transaction status
      const { error: updateError } = await supabase
        .from('transactions')
        .update({ status: 'completed' })
        .eq('id', txData.id);

      if (updateError) {
        console.error('Failed to update transaction:', updateError);
      }

      console.log(`✅ Withdrawal completed: Reference ${reference}`);
    }

    return new Response(JSON.stringify({ status: 'received' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Webhook Error:', error);
    return new Response(
      JSON.stringify({ status: 'error', message: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
