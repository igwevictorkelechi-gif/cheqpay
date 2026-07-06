/**
 * CheqPay support knowledge base. This is the single source of truth the AI
 * support agent answers from; keep it in sync with the public FAQ page
 * (apps/web/src/app/faq) and product behaviour.
 */
export const SUPPORT_FAQ: { q: string; a: string }[] = [
  {
    q: "What is CheqPay?",
    a: "CheqPay is an all-in-one app to send money, buy and sell crypto (BTC, USDT and USDC), convert between assets, and pay bills like airtime, data, electricity and cable TV.",
  },
  {
    q: "How do I fund my account?",
    a: "Tap Deposit, enter the amount, and transfer to your personal CheqPay virtual account number (shown after a one-time KYC verification). Your Naira balance is credited automatically once the bank transfer is confirmed. You can also receive crypto to your in-app wallet from the Receive screen.",
  },
  {
    q: "How do I withdraw Naira?",
    a: "Tap Withdraw, enter the amount, then choose a saved bank account or add one. For your security, payouts can only go to a bank account in YOUR name — the account name is verified against your profile when you save it. Money usually arrives within minutes.",
  },
  {
    q: "How do I buy or sell crypto?",
    a: "Open the Crypto tab, pick an asset, and choose Buy or Sell. You'll see a live quote with the rate before you confirm. Buys use your NGN balance; sells credit it back.",
  },
  {
    q: "Can I convert BTC to USDT directly?",
    a: "Yes. On the Convert screen you can swap between NGN, BTC and USDT. BTC↔USDT conversions are priced from live market rates with our standard spread applied.",
  },
  {
    q: "How long do crypto deposits take to credit?",
    a: "Crypto deposits are credited after the transaction is confirmed on-chain — usually within 30 minutes. If it takes longer, contact support with your transaction hash.",
  },
  {
    q: "How long do crypto withdrawals take?",
    a: "Crypto withdrawals are reviewed and broadcast to the network, usually within 30 minutes. Confirmation time then depends on the blockchain — minutes for USDT (Tron) and up to an hour for Bitcoin.",
  },
  {
    q: "Why does a crypto asset say 'Coming soon'?",
    a: "An asset shows 'Coming soon' while its deposit rail is being enabled on our side. Your Naira wallet and the other live assets work as usual; the asset opens up automatically once it's live.",
  },
  {
    q: "How do I pay a bill (airtime, data, electricity, cable TV, betting)?",
    a: "Open Pay Bills, pick the service and provider, enter the customer/meter/smartcard number (we validate it first), then confirm the amount. For prepaid electricity, your recharge token appears on the success screen and stays in the transaction receipt.",
  },
  {
    q: "Where is my electricity token?",
    a: "For prepaid meters the recharge token is shown on the payment success screen and saved in the transaction receipt (Transactions → tap the payment). Enter the token on your meter to load the units.",
  },
  {
    q: "What are the fees?",
    a: "Crypto trades include a small spread on the exchange rate. Bill payments and Naira withdrawals may carry a network/processing fee, always shown before you confirm.",
  },
  {
    q: "Is there a minimum or limit?",
    a: "Minimums depend on the asset (e.g. 0.0001 BTC, 2 USDT). Daily limits depend on your KYC tier — verify your identity in Settings to raise them.",
  },
  {
    q: "Why am I asked to verify my identity (KYC)?",
    a: "A one-time BVN verification is required before we can open your personal deposit account number and raise your limits — it's a regulatory requirement. Once verified you are never asked again.",
  },
  {
    q: "How is my money kept safe?",
    a: "Funds sit in secured custodial wallets, transactions pass AML screening, and you can enable two-factor authentication and an app PIN. Sensitive data is encrypted in transit and at rest.",
  },
  {
    q: "I sent crypto to the wrong address — can it be reversed?",
    a: "No. Crypto transactions are irreversible. Always double-check the address and network before sending. CheqPay cannot recover funds sent to an incorrect address.",
  },
  {
    q: "My deposit hasn't arrived — what do I do?",
    a: "Bank transfers usually credit within minutes; crypto within 30 minutes of on-chain confirmation. If it's been longer, check the Transactions screen first, then contact support with your transfer receipt or transaction hash and your registered email.",
  },
  {
    q: "How do I contact a human?",
    a: "Email support@cheqpay.com or use the contact options on the Help & Support page. Include your registered email and the transaction reference. We aim to respond within 24 hours.",
  },
];

export function buildSupportSystemPrompt(): string {
  const faq = SUPPORT_FAQ.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n");
  return [
    "You are Cheq, the in-app customer support assistant for CheqPay — a Nigerian app for Naira payments, crypto (BTC/USDT/USDC) and bill payments.",
    "",
    "Rules:",
    "- Answer ONLY from the FAQ knowledge base below and general CheqPay app navigation it describes. If the answer isn't covered, say you're not sure and direct the user to email support@cheqpay.com with their registered email and transaction reference.",
    "- Be warm, clear and brief: 1–3 short sentences or a short list. No markdown headers.",
    "- Never ask for or accept passwords, PINs, OTPs, seed phrases or full card numbers. Remind users that CheqPay staff never ask for these.",
    "- You cannot see the user's account, balances or transactions, and you cannot move money, reverse transactions or change account settings — for anything account-specific, route to human support.",
    "- Do not give financial, investment, legal or tax advice. Do not quote exchange rates or fees as exact numbers — the app always shows the live rate/fee before confirming.",
    "- If the user is reporting fraud or a compromised account, tell them to email support@cheqpay.com immediately and enable/change their app PIN and password.",
    "- Stay on CheqPay topics; politely decline anything unrelated.",
    "",
    "FAQ knowledge base:",
    "",
    faq,
  ].join("\n");
}
