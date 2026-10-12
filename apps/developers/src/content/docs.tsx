// The developer docs. Facts that the API defines (scopes, error codes, event
// types, retry schedule, header names) are rendered from @cheqpay/devapi, the
// same package the API itself uses, so these pages can't drift from it.

import Link from "next/link";
import {
  ERROR_CODES,
  EVENT_TYPES,
  SCOPES,
  WEBHOOK_HEADERS,
  WEBHOOK_RETRY_SCHEDULE_SECONDS,
  WEBHOOK_TOLERANCE_SECONDS,
} from "@cheqpay/devapi";
import CodeBlock from "@/components/CodeBlock";
import { PUBLIC_API, SUPPORT_EMAIL } from "@/lib/api";

export interface DocPage {
  slug: string;
  title: string;
  section: "Getting started" | "Conventions" | "Webhooks" | "Guides" | "Going live";
  summary: string;
  body: () => React.ReactNode;
}

const C = ({ children }: { children: React.ReactNode }) => <code className="inline-code">{children}</code>;

function human(seconds: number): string {
  if (seconds < 3600) return `${seconds / 60} min`;
  return `${seconds / 3600} h`;
}

const curl = (method: string, path: string, body?: string, idem = true) =>
  [
    `curl ${method === "GET" ? "" : `-X ${method} `}${PUBLIC_API}${path} \\`,
    `  -H "Authorization: Bearer $CHEQPAY_KEY"${body ? " \\" : ""}`,
    ...(body ? [`  -H "Content-Type: application/json" \\`, ...(idem ? [`  -H "Idempotency-Key: $(uuidgen)" \\`] : []), `  -d '${body}'`] : []),
  ].join("\n");

export const DOCS: DocPage[] = [
  {
    slug: "introduction",
    title: "Introduction",
    section: "Getting started",
    summary: "What you can build with CheqPay, and how the API is shaped.",
    body: () => (
      <>
        <p>
          The CheqPay API lets your business hold money for your own customers and move it: naira wallets with dedicated bank account numbers,
          transfers and NGN↔USD conversions, airtime, data, electricity and cable TV, and USD virtual cards.
        </p>
        <h2>The building blocks</h2>
        <ul>
          <li><strong>Customers</strong>: the people you serve. Each one is verified (BVN, ID document) before they can hold money.</li>
          <li><strong>Wallets</strong>: balances in NGN and USD. You have main wallets; every verified customer gets their own.</li>
          <li><strong>Virtual accounts</strong>: a bank account number per customer. Transfers into it land in their NGN wallet.</li>
          <li><strong>Transfers and conversions</strong>: move money between your wallets, or between naira and dollars.</li>
          <li><strong>Bills</strong>: pay airtime, data, electricity and cable TV from any NGN wallet.</li>
          <li><strong>Cards</strong>: USD virtual cards for verified customers, funded from a USD wallet.</li>
          <li><strong>Events and webhooks</strong>: every change is an event, signed and delivered to your server.</li>
        </ul>
        <h2>How requests look</h2>
        <ul>
          <li>Base URL: <C>{PUBLIC_API}</C>. JSON in, JSON out.</li>
          <li>Authenticate with a secret key: <C>Authorization: Bearer cp_test_sk_…</C>. The key decides test or live mode.</li>
          <li>Amounts are whole numbers in minor units: kobo for NGN, cents for USD. ₦1,500.00 is <C>150000</C>.</li>
          <li>Ids carry their type: <C>cus_…</C>, <C>wal_…</C>, <C>va_…</C>, <C>txn_…</C>, <C>card_…</C>, <C>evt_…</C>.</li>
          <li>Every POST needs an <C>Idempotency-Key</C> header, so a retry never acts twice.</li>
        </ul>
        <p>
          Start with the <Link href="/docs/quickstart/">quickstart</Link>: it takes about ten minutes in the sandbox, with simulated money.
        </p>
      </>
    ),
  },
  {
    slug: "quickstart",
    title: "Quickstart",
    section: "Getting started",
    summary: "From a test key to a funded customer and a paid bill, in the sandbox.",
    body: () => (
      <>
        <p>
          Sign in to the <Link href="/dashboard/">dashboard</Link> with your CheqPay account, open a developer account, and create a test key.
          Test keys start with <C>cp_test_sk_</C> and only ever touch simulated money. Your sandbox main wallets start with ₦1,000,000 and $1,000.
        </p>
        <CodeBlock label="Shell" code={`export CHEQPAY_KEY=cp_test_sk_…`} />
        <h2>1. Check your key</h2>
        <CodeBlock code={curl("GET", "/account")} />
        <h2>2. Upload an ID and create a customer</h2>
        <p>Upload a photo of the customer&apos;s government ID, then create the customer with it. In the sandbox any 11-digit BVN verifies, except the test values on <Link href="/docs/test-mode/">Test mode</Link>.</p>
        <CodeBlock code={`curl -X POST ${PUBLIC_API}/files \\
  -H "Authorization: Bearer $CHEQPAY_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -F purpose=identity_document \\
  -F file=@id-front.jpg`} />
        <CodeBlock
          code={curl(
            "POST",
            "/customers",
            `{"first_name":"Ada","last_name":"Obi","email":"ada@example.com","phone":"08031234567","date_of_birth":"1990-04-12","bvn":"12345678901","address":{"street":"1 Marina","city":"Lagos","state":"Lagos","postal_code":"101001"},"identity":{"type":"NIN","number":"12345678901","document_front":"file_…"},"kyc_consent":true}`,
          )}
        />
        <p>The customer comes back <C>pending</C> and becomes <C>verified</C> moments later; you receive <C>customer.verified</C>. Their NGN and USD wallets now exist.</p>
        <h2>3. Give them a bank account number</h2>
        <CodeBlock code={curl("POST", "/virtual_accounts", `{"customer_id":"cus_…"}`)} />
        <h2>4. Simulate a bank transfer in</h2>
        <CodeBlock code={curl("POST", "/test_helpers/virtual_accounts/va_…/deposit", `{"amount":500000}`)} />
        <p>The customer&apos;s NGN wallet is credited ₦5,000, less your plan&apos;s deposit fee, and you receive <C>deposit.received</C>.</p>
        <h2>5. Pay a bill from their wallet</h2>
        <CodeBlock code={curl("POST", "/bills/payments", `{"service":"airtime","biller_id":"mtn","customer":"08031234567","amount":50000,"wallet_id":"wal_…"}`)} />
        <p>
          That&apos;s the whole loop. Next: <Link href="/docs/webhooks/">receive webhooks</Link>, then read the guides for{" "}
          <Link href="/docs/wallets/">wallets</Link>, <Link href="/docs/bills/">bills</Link> and <Link href="/docs/cards/">cards</Link>.
        </p>
      </>
    ),
  },
  {
    slug: "authentication",
    title: "Authentication and keys",
    section: "Getting started",
    summary: "Secret keys, scopes, IP allowlists and rotation.",
    body: () => (
      <>
        <p>Every request carries a secret key in the <C>Authorization</C> header. Create, roll and revoke keys in the dashboard.</p>
        <CodeBlock code={`Authorization: Bearer cp_live_sk_…`} />
        <h2>Keep keys on your server</h2>
        <ul>
          <li>Requests from a web browser are refused: a secret key in a web page or mobile app is a secret key anyone can read.</li>
          <li>Never put a key in a URL. A key seen in a query string is revoked automatically.</li>
          <li>A refused key always gets the same <C>invalid_api_key</C> answer. Why it was refused (revoked, expired, wrong IP) is in your dashboard&apos;s request log.</li>
          <li>Repeated failures from one IP address block it for 15 minutes.</li>
        </ul>
        <h2>Scopes</h2>
        <p>Give each key only what it needs. A key used by a bill-payment job doesn&apos;t need to create customers.</p>
        <table>
          <thead><tr><th>Scope</th><th>Allows</th></tr></thead>
          <tbody>
            {SCOPES.map((s) => (
              <tr key={s.id}><td><C>{s.id}</C></td><td>{s.description}</td></tr>
            ))}
          </tbody>
        </table>
        <p><C>cards:details</C> (full card numbers) is never given by default. A live key with it must have an IP allowlist.</p>
        <h2>IP allowlists</h2>
        <p>Restrict a key to your servers&apos; addresses. Requests from anywhere else are refused as an invalid key.</p>
        <h2>Rotation</h2>
        <p>Rolling a key issues a new secret with the same settings. The old one can keep working for up to 24 hours while you deploy.</p>
        <h2>If a key leaks</h2>
        <p>Revoke it in the dashboard; it stops working within seconds. The <strong>emergency stop</strong> on the Security page revokes every live key and pauses money movement in one step.</p>
      </>
    ),
  },
  {
    slug: "test-mode",
    title: "Test mode and sandbox data",
    section: "Getting started",
    summary: "How test and live differ, and the test values that trigger each outcome.",
    body: () => (
      <>
        <p>
          A test key (<C>cp_test_sk_</C>) works on simulated money and never contacts a bank, a biller or a card issuer. Test and live are
          completely separate: a test key can&apos;t see live objects and the other way round.
        </p>
        <h2>Test values</h2>
        <table>
          <thead><tr><th>Where</th><th>Value</th><th>Outcome</th></tr></thead>
          <tbody>
            <tr><td>Customer BVN</td><td><C>22222222222</C></td><td>Verification is rejected</td></tr>
            <tr><td>Customer BVN</td><td><C>33333333333</C></td><td>Stays pending for a minute, then verifies</td></tr>
            <tr><td>Customer BVN</td><td>any other 11 digits</td><td>Verifies</td></tr>
            <tr><td>Bill customer number</td><td>ends in <C>0000</C></td><td>Payment fails and is refunded; validation says invalid</td></tr>
            <tr><td>Bill customer number</td><td>ends in <C>1111</C></td><td>Stays pending until you settle it with the test helper</td></tr>
            <tr><td>Virtual accounts</td><td>numbers start <C>99</C></td><td>&quot;CheqPay Test Bank&quot;: never a real account</td></tr>
            <tr><td>Conversions</td><td>fixed rates</td><td>₦1,600 to buy $1; ₦1,550 when you sell $1</td></tr>
          </tbody>
        </table>
        <h2>Test helpers</h2>
        <ul>
          <li><C>POST /test_helpers/virtual_accounts/{"{id}"}/deposit</C>: a bank transfer arrives.</li>
          <li><C>POST /test_helpers/bill_payments/{"{id}"}/settle</C>: a pending bill succeeds or fails.</li>
          <li><C>POST /test_helpers/cards/{"{id}"}/purchase</C>: a card is used at a merchant.</li>
        </ul>
        <p>The dashboard can also top up your sandbox main wallets and simulate deposits. Live keys get 404 from every test helper.</p>
      </>
    ),
  },
  {
    slug: "errors",
    title: "Errors",
    section: "Conventions",
    summary: "The error shape, and every code the API returns.",
    body: () => (
      <>
        <p>Errors use HTTP status codes and always have the same body. Branch on <C>type</C> and <C>code</C>; show <C>message</C> to people.</p>
        <CodeBlock
          code={`{
  "error": {
    "type": "invalid_request_error",
    "code": "insufficient_funds",
    "message": "The wallet does not hold enough for this.",
    "param": "amount",
    "request_id": "req_…"
  }
}`}
        />
        <p>Quote the <C>request_id</C> when you contact us.</p>
        <table>
          <thead><tr><th>Code</th><th>Status</th><th>Meaning</th></tr></thead>
          <tbody>
            {Object.entries(ERROR_CODES).map(([code, info]) => (
              <tr key={code}><td><C>{code}</C></td><td>{info.status}</td><td>{info.description}</td></tr>
            ))}
          </tbody>
        </table>
      </>
    ),
  },
  {
    slug: "idempotency",
    title: "Idempotency",
    section: "Conventions",
    summary: "Retry safely: the same key never acts twice.",
    body: () => (
      <>
        <p>
          Every POST needs an <C>Idempotency-Key</C> header: a unique string per operation (a UUID works). If a request times out, retry it with
          the <strong>same</strong> key: you get the first request&apos;s result, and money never moves twice.
        </p>
        <ul>
          <li>The same key with a different body is refused (<C>idempotency_key_reused</C>): it&apos;s a bug in the caller.</li>
          <li>A retry while the first request is still running gets <C>idempotency_in_progress</C>; wait a moment and retry.</li>
          <li>Keys are remembered per mode. Use a new key for each new operation.</li>
        </ul>
        <p>Separately, <C>reference</C> lets you attach your own id to a transaction, card or customer; it must be unique per mode.</p>
      </>
    ),
  },
  {
    slug: "pagination",
    title: "Pagination",
    section: "Conventions",
    summary: "Lists, limit and starting_after.",
    body: () => (
      <>
        <p>List endpoints return newest first, in pages:</p>
        <CodeBlock code={`{ "object": "list", "data": [ … ], "has_more": true }`} />
        <ul>
          <li><C>limit</C>: 1 to 100 (default 20).</li>
          <li><C>starting_after</C>: the id of the last item you have. Returns the next older page.</li>
        </ul>
        <CodeBlock code={curl("GET", "/transactions?limit=100&starting_after=txn_…")} />
      </>
    ),
  },
  {
    slug: "rate-limits",
    title: "Rate limits and money limits",
    section: "Conventions",
    summary: "Requests per minute, and the caps on live money.",
    body: () => (
      <>
        <p>
          Each key may make a number of requests per minute set by your plan; your account as a whole may make three times that. Every response
          carries <C>RateLimit-Limit</C>, <C>RateLimit-Remaining</C> and <C>RateLimit-Reset</C>. Past the limit you get 429 with <C>Retry-After</C>.
        </p>
        <h2>Money limits (live)</h2>
        <ul>
          <li><strong>Daily outflow</strong>: how much may leave your account each day through bills and cards, per currency. Lower for the first 30 days after approval.</li>
          <li><strong>Largest single payment</strong>, per currency.</li>
          <li><strong>Most you may hold</strong> across all your live wallets.</li>
        </ul>
        <p><C>GET /account</C> shows your current limits. Over a limit, the request is refused with <C>limit_exceeded</C> and nothing moves.</p>
      </>
    ),
  },
  {
    slug: "webhooks",
    title: "Webhooks",
    section: "Webhooks",
    summary: "Events, signatures, retries and the polling fallback.",
    body: () => (
      <>
        <p>
          Add an https endpoint in the dashboard and choose its events. Each event is a POST of JSON to your URL, signed with your endpoint&apos;s
          secret (<C>whsec_…</C>, shown once). Answer with any 2xx within 10 seconds.
        </p>
        <h2>Verify every delivery</h2>
        <p>
          Signatures follow the open Standard Webhooks format. Three headers: <C>{WEBHOOK_HEADERS.id}</C>, <C>{WEBHOOK_HEADERS.timestamp}</C> and{" "}
          <C>{WEBHOOK_HEADERS.signature}</C>. The signature is <C>v1,</C> followed by the base64 HMAC-SHA256 of <C>id.timestamp.body</C>, keyed with
          the base64-decoded part of your secret after <C>whsec_</C>. During a secret roll there are two signatures, separated by a space; accept either.
        </p>
        <ul>
          <li>Use the <strong>raw</strong> request body, before any JSON parsing.</li>
          <li>Compare in constant time.</li>
          <li>Refuse timestamps more than {WEBHOOK_TOLERANCE_SECONDS / 60} minutes from your clock.</li>
          <li>Deduplicate on <C>{WEBHOOK_HEADERS.id}</C>: a delivery can arrive more than once.</li>
        </ul>
        <CodeBlock
          label="Node.js"
          code={`import crypto from "node:crypto";

export function verify(rawBody, headers, secret) {
  const id = headers["webhook-id"];
  const ts = headers["webhook-timestamp"];
  const sigs = (headers["webhook-signature"] || "").split(" ");
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(\`\${id}.\${ts}.\${rawBody}\`).digest();
  return sigs.some((s) => {
    const got = Buffer.from(s.replace(/^v1,/, ""), "base64");
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}`}
        />
        <CodeBlock
          label="Python"
          code={`import base64, hashlib, hmac, time

def verify(raw_body: bytes, headers, secret: str) -> bool:
    msg_id, ts = headers["webhook-id"], headers["webhook-timestamp"]
    if abs(time.time() - int(ts)) > 300:
        return False
    key = base64.b64decode(secret.removeprefix("whsec_"))
    expected = hmac.new(key, f"{msg_id}.{ts}.".encode() + raw_body, hashlib.sha256).digest()
    for sig in headers.get("webhook-signature", "").split(" "):
        if hmac.compare_digest(base64.b64decode(sig.removeprefix("v1,")), expected):
            return True
    return False`}
        />
        <CodeBlock
          label="PHP"
          code={`function verify(string $rawBody, array $h, string $secret): bool {
    $id = $h['webhook-id']; $ts = $h['webhook-timestamp'];
    if (abs(time() - (int)$ts) > 300) return false;
    $key = base64_decode(preg_replace('/^whsec_/', '', $secret));
    $expected = hash_hmac('sha256', "$id.$ts.$rawBody", $key, true);
    foreach (explode(' ', $h['webhook-signature'] ?? '') as $sig) {
        if (hash_equals($expected, base64_decode(preg_replace('/^v1,/', '', $sig)))) return true;
    }
    return false;
}`}
        />
        <h2>Retries</h2>
        <p>
          A delivery that doesn&apos;t get a 2xx is retried after {WEBHOOK_RETRY_SCHEDULE_SECONDS.map(human).join(", ")}. After that it&apos;s marked failed (you
          can resend it from the dashboard). An endpoint that has failed every delivery for three days is switched off and you&apos;re emailed.
        </p>
        <h2>Missed something? Poll.</h2>
        <p><C>GET /events</C> returns the last 30 days of events, newest first: the same objects your webhooks receive.</p>
        <h2>Events</h2>
        <table>
          <thead><tr><th>Event</th><th>Object</th><th>When</th></tr></thead>
          <tbody>
            {EVENT_TYPES.map((e) => (
              <tr key={e.type}><td><C>{e.type}</C></td><td>{e.object}</td><td>{e.description}</td></tr>
            ))}
          </tbody>
        </table>
      </>
    ),
  },
  {
    slug: "customers",
    title: "Customers and verification",
    section: "Guides",
    summary: "Who can hold money, and what verification needs.",
    body: () => (
      <>
        <p>
          Before a customer can hold money, get a virtual account or a card, they&apos;re verified: their BVN, date of birth and phone, and a photo
          of a government ID. You need their consent; send <C>kyc_consent: true</C> to confirm you have it.
        </p>
        <h2>Statuses</h2>
        <ul>
          <li><C>pending</C>: being checked. Usually seconds; occasionally longer.</li>
          <li><C>verified</C>: their NGN and USD wallets exist. You get <C>customer.verified</C>.</li>
          <li><C>rejected</C>: <C>kyc.reason</C> says why. Correct their details with <C>PATCH /customers/{"{id}"}</C> to try again.</li>
        </ul>
        <h2>Rules</h2>
        <ul>
          <li>Customers must be 18 or over, with a Nigerian mobile number.</li>
          <li>One BVN is one customer in your account. Creating the same person twice returns <C>customer_exists</C>.</li>
          <li>The BVN and ID number are write-only. Responses only ever show the BVN&apos;s last four digits.</li>
          <li>Your plan sets how many customers you can have.</li>
        </ul>
        <p>Under the Nigeria Data Protection Act you&apos;re responsible for telling your customers how their data is used, and for having their consent.</p>
      </>
    ),
  },
  {
    slug: "wallets",
    title: "Wallets, deposits and transfers",
    section: "Guides",
    summary: "Main and customer wallets, virtual accounts, transfers and conversions.",
    body: () => (
      <>
        <h2>Wallets</h2>
        <p>
          You have a main NGN and a main USD wallet in each mode. Every verified customer gets their own NGN and USD wallets. Balances are in{" "}
          <C>available_balance</C>; <C>GET /wallets/{"{id}"}/transactions</C> is the statement.
        </p>
        <h2>Fund your main wallet</h2>
        <p>In live mode, move money between your CheqPay balance and your main wallets in the dashboard (<strong>Add money</strong>, <strong>Move out</strong>). Money only leaves CheqPay through your own CheqPay balance.</p>
        <h2>Virtual accounts</h2>
        <p>
          <C>POST /virtual_accounts</C> gives a verified customer a bank account number in their name. Transfers into it credit their NGN wallet,
          less your plan&apos;s deposit fee, and send <C>deposit.received</C> with the payer&apos;s details. One per customer; asking again returns it.
        </p>
        <h2>Transfers</h2>
        <p>
          <C>POST /transfers</C> moves money between two of your wallets in the same currency: main to customer, back, or customer to customer.
          Instant, free and internal. Sends <C>transfer.completed</C>.
        </p>
        <CodeBlock code={curl("POST", "/transfers", `{"from_wallet_id":"wal_…","to_wallet_id":"wal_…","amount":250000}`)} />
        <h2>Converting NGN and USD</h2>
        <p>
          First ask for a quote (<C>POST /fx/quotes</C>): it says exactly what will arrive, after our fee. It&apos;s good for 45 seconds and can be used
          once. Then spend it between two wallets of the same owner (<C>POST /fx/conversions</C>).
        </p>
        <CodeBlock code={curl("POST", "/fx/quotes", `{"from_currency":"NGN","to_currency":"USD","amount":1600000}`)} />
        <CodeBlock code={curl("POST", "/fx/conversions", `{"quote_id":"fxq_…","from_wallet_id":"wal_…","to_wallet_id":"wal_…"}`)} />
        <p>Live conversions can answer 202 while they settle; you then get <C>conversion.completed</C>, or <C>conversion.failed</C> with a full refund.</p>
      </>
    ),
  },
  {
    slug: "bills",
    title: "Bill payments",
    section: "Guides",
    summary: "Airtime, data, electricity and cable TV from any NGN wallet.",
    body: () => (
      <>
        <p>Pay airtime, data, electricity and cable TV from your main NGN wallet or a customer&apos;s. The wallet is debited the bill plus your plan&apos;s bill fee.</p>
        <h2>1. Find the biller</h2>
        <p><C>GET /bills/services</C> lists services and billers. <C>amount_type</C> tells you what to send: an <C>amount</C> (airtime, electricity, in whole naira) or a <C>plan_id</C> (data, cable TV).</p>
        <CodeBlock code={curl("GET", "/bills/plans?service=data&biller_id=mtn")} />
        <h2>2. Check the customer (electricity and TV)</h2>
        <CodeBlock code={curl("POST", "/bills/validate", `{"service":"electricity","biller_id":"ikedc-prepaid","customer":"45160826181"}`)} />
        <h2>3. Pay</h2>
        <CodeBlock code={curl("POST", "/bills/payments", `{"service":"data","biller_id":"mtn","customer":"08031234567","plan_id":"mtn:…","amount":60000}`)} />
        <p>With a plan, sending the <C>amount</C> you showed your customer protects them: if the price changed, the payment is refused with <C>price_changed</C> instead of charging more.</p>
        <h2>Outcomes</h2>
        <ul>
          <li><C>201 successful</C>: delivered. Prepaid electricity tokens are in <C>details.token</C>.</li>
          <li><C>201 failed</C>: the biller refused it. The amount and fee are back in the wallet.</li>
          <li><C>202 pending</C>: the biller is confirming. You&apos;ll get <C>bill_payment.successful</C> or <C>bill_payment.failed</C> (with a refund). We never refund a payment the biller might still deliver.</li>
        </ul>
        <p>Live bill payments count toward your daily outflow limit.</p>
      </>
    ),
  },
  {
    slug: "cards",
    title: "Virtual cards",
    section: "Guides",
    summary: "Issue USD cards to verified customers, fund them, and show details safely.",
    body: () => (
      <>
        <p>Issue a USD virtual card to a verified customer, funded from a USD wallet: theirs, or your main one. Convert naira first if you need to.</p>
        <h2>Issue</h2>
        <CodeBlock code={curl("POST", "/cards", `{"customer_id":"cus_…","amount":2000,"brand":"VISA"}`)} />
        <p>
          <C>amount</C> is the first top-up, in cents, loaded onto the card. The wallet is debited the top-up, the card price and the top-up fee from
          your plan. In live mode the card is <C>pending</C> for a moment; you get <C>card.active</C>, or <C>card.failed</C> with everything refunded.
        </p>
        <h2>Fund, withdraw, freeze</h2>
        <ul>
          <li><C>POST /cards/{"{id}"}/fund</C>: load money onto it (plus the top-up fee).</li>
          <li><C>POST /cards/{"{id}"}/withdraw</C>: take money off it, back to a USD wallet. The wallet is credited once the issuer confirms.</li>
          <li><C>POST /cards/{"{id}"}/freeze</C> and <C>/unfreeze</C>: stop and resume spending.</li>
          <li><C>GET /cards/{"{id}"}/transactions</C>: what it was used for.</li>
        </ul>
        <h2>Showing card details</h2>
        <p>
          <C>GET /cards/{"{id}"}/details</C> returns the full number, CVV and expiry, fetched from the issuer and never stored by CheqPay. It needs a key
          with the <C>cards:details</C> scope (live keys with it must have an IP allowlist), works ten times per card per hour, and every reveal is in
          your security log. Fetch it only when your customer asks to see it, show it, and don&apos;t store or log it.
        </p>
      </>
    ),
  },
  {
    slug: "going-live",
    title: "Going live",
    section: "Going live",
    summary: "Verification, a plan, and your first live key.",
    body: () => (
      <>
        <ol>
          <li><strong>Verify yourself</strong> in the CheqPay app (identity verification). The person behind the business is known first.</li>
          <li><strong>Turn on two-factor authentication</strong> in the dashboard. Every live change asks for it.</li>
          <li><strong>Verify your business</strong> on the Go live page: registration (CAC) number and certificate, website, and what you&apos;ll build. We usually answer within two working days.</li>
          <li><strong>Choose a plan</strong>. It&apos;s paid monthly from your main NGN wallet.</li>
          <li><strong>Create a live key</strong> and set an IP allowlist.</li>
        </ol>
        <h2>Checklist before launch</h2>
        <ul>
          <li>Your server verifies webhook signatures and deduplicates on <C>webhook-id</C>.</li>
          <li>Every POST sends a unique <C>Idempotency-Key</C>, reused on retry.</li>
          <li>You handle <C>202 pending</C> answers and wait for the event.</li>
          <li>Keys live in your server&apos;s secret store, never in code or a client app.</li>
        </ul>
        <p>For the first 30 days, live accounts have lower daily outflow limits. They rise automatically.</p>
      </>
    ),
  },
  {
    slug: "changelog",
    title: "Changelog",
    section: "Going live",
    summary: "What changed, newest first.",
    body: () => (
      <>
        <h2>October 2026</h2>
        <ul>
          <li>USD virtual cards: issue, fund, withdraw, freeze, transactions and card details.</li>
          <li>Bill payments: airtime, data, electricity and cable TV from any NGN wallet.</li>
          <li>Customers and verification, virtual accounts, deposits, transfers, NGN↔USD conversions, events and webhooks.</li>
          <li>Accounts, keys, wallets and plans: the first release.</li>
        </ul>
      </>
    ),
  },
  {
    slug: "support",
    title: "Support",
    section: "Going live",
    summary: "How to reach us.",
    body: () => (
      <>
        <p>Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Include the <C>request_id</C> of any request you&apos;re asking about, and never send a secret key.</p>
        <p>If a key may have leaked, don&apos;t wait for us: revoke it in the dashboard, or use the emergency stop.</p>
      </>
    ),
  },
];

export const SECTIONS: DocPage["section"][] = ["Getting started", "Conventions", "Webhooks", "Guides", "Going live"];

export function docBySlug(slug: string): DocPage | undefined {
  return DOCS.find((d) => d.slug === slug);
}
