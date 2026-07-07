'use client';

import { useEffect, useState } from 'react';
import { Mail, Phone, MessageCircle, Save } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

interface Contact {
  email: string;
  phone: string;
  whatsapp: string;
}

export default function SupportContactPage() {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function apply(c: Contact) {
    setEmail(c.email ?? '');
    setPhone(c.phone ?? '');
    setWhatsapp(c.whatsapp ?? '');
  }

  useEffect(() => {
    let active = true;
    fetch('/api/support-contact', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to load (' + r.status + ')');
        return r.json();
      })
      .then((d) => { if (active) apply(d); })
      .catch((e) => { if (active) setMessage({ kind: 'err', text: (e as Error).message }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/support-contact', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, phone, whatsapp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save');
      apply(data);
      setMessage({ kind: 'ok', text: 'Saved. The app shows these immediately.' });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    'w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Support Contact</h1>
        <p className="text-gray-600 mt-2">
          Shown on the app&apos;s Help &amp; Support page. Leave phone or WhatsApp blank to hide
          that channel entirely (no placeholder numbers).
        </p>
      </div>

      {message && (
        <div
          className={`mb-6 rounded-lg px-4 py-3 text-sm ${
            message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="max-w-xl space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <label className="flex items-center gap-2 text-gray-700 font-semibold mb-2">
            <Mail size={18} className="text-brand-600" />
            Support email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading || saving}
            className={inputCls}
            placeholder="support@cheqpay.com"
          />
          <p className="text-sm text-gray-500 mt-2">Always shown. Defaults to support@cheqpay.com.</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <label className="flex items-center gap-2 text-gray-700 font-semibold mb-2">
            <Phone size={18} className="text-brand-600" />
            Phone number
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={loading || saving}
            className={inputCls}
            placeholder="+234 801 234 5678 (leave blank to hide)"
          />
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <label className="flex items-center gap-2 text-gray-700 font-semibold mb-2">
            <MessageCircle size={18} className="text-brand-600" />
            WhatsApp number
          </label>
          <input
            type="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            disabled={loading || saving}
            className={inputCls}
            placeholder="2348012345678 (country code, no +; leave blank to hide)"
          />
          <p className="text-sm text-gray-500 mt-2">
            Used to build a wa.me chat link. Digits only, including country code.
          </p>
        </div>

        <button
          onClick={save}
          disabled={loading || saving}
          className="flex items-center gap-2 px-5 py-3 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
        >
          <Save size={18} />
          {saving ? 'Saving…' : 'Save contact details'}
        </button>
      </div>
    </DashboardLayout>
  );
}
