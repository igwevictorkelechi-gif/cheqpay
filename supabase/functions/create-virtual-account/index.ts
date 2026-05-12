import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';

interface PaystackCreateVAPayload {
  customer: {
    email: string;
    first_name: string;
    last_name: string;
    phone: string;
  };
  preferred_bank?: string;
  subaccount?: string;
}

interface FlutterwaveCreateVAPayload {
  email: string;
  is_permanent: boolean;
  narration?: string;
  bvn?: string;
  phonenumber?: string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { user_id, provider, customer_email, customer_phone, customer_name } = await req.json();

    if (!user_id || !provider || !customer_email) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get payment config
    const { data: configData, error: configError } = await supabase
      .from('payment_configs')
      .select('public_key, secret_key_encrypted')
      .eq('provider', provider)
      .eq('is_active', true)
      .single();

    if (configError || !configData) {
      return new Response(
        JSON.stringify({ error: 'Payment provider not configured' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let vaResponse;
    const nameParts = customer_name?.split(' ') || ['User', 'Account'];
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || 'Account';

    if (provider === 'paystack') {
      // Create Paystack Dedicated Virtual Account
      const paystackPayload: PaystackCreateVAPayload = {
        customer: {
          email: customer_email,
          first_name: firstName,
          last_name: lastName,
          phone: customer_phone || '+234',
        },
        preferred_bank: '035', // Wema Bank
      };

      vaResponse = await fetch('https://api.paystack.co/bank_account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${configData.public_key}`,
        },
        body: JSON.stringify(paystackPayload),
      });
    } else if (provider === 'flutterwave') {
      // Create Flutterwave Static Virtual Account
      const flutterwavePayload: FlutterwaveCreateVAPayload = {
        email: customer_email,
        is_permanent: true,
        narration: `${firstName} ${lastName}`,
        phonenumber: customer_phone || '+234',
      };

      vaResponse = await fetch('https://api.flutterwave.com/v3/virtual-account-numbers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${configData.public_key}`,
        },
        body: JSON.stringify(flutterwavePayload),
      });
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid provider' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const vaData = await vaResponse.json();

    if (!vaResponse.ok) {
      console.error('VA Creation Error:', vaData);
      return new Response(
        JSON.stringify({ error: 'Failed to create virtual account', details: vaData }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let accountNumber: string;
    let bankName: string;
    let bankCode: string;
    let reference: string;

    if (provider === 'paystack') {
      // Paystack response structure
      const bankAccount = vaData.data.bank_accounts[0];
      accountNumber = bankAccount.account_number;
      bankName = bankAccount.bank_name;
      bankCode = bankAccount.bank_name.includes('Wema') ? '035' : '000';
      reference = `PAYSTACK_${user_id}`;
    } else {
      // Flutterwave response structure
      accountNumber = vaData.data.account_number;
      bankName = vaData.data.bank_name || 'Flutterwave Bank';
      bankCode = vaData.data.bank_code || '000';
      reference = `FLUTTERWAVE_${vaData.data.id}`;
    }

    // Store virtual account in database
    const { error: insertError } = await supabase.from('virtual_accounts').insert({
      user_id,
      provider,
      account_number: accountNumber,
      bank_name: bankName,
      bank_code: bankCode,
      reference,
      is_active: true,
      metadata: {
        created_via_api: true,
        external_ref: provider === 'paystack' ? vaData.data.id : vaData.data.id,
      },
    });

    if (insertError) {
      console.error('Database Insert Error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save virtual account', details: insertError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Log audit
    await supabase.from('audit_logs').insert({
      user_id,
      action: 'VIRTUAL_ACCOUNT_CREATED',
      resource_type: 'virtual_account',
      details: { provider, account_number: accountNumber },
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          account_number: accountNumber,
          bank_name: bankName,
          bank_code: bankCode,
          provider,
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
