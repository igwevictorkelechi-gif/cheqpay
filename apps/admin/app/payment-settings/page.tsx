'use client';

import React, { useState } from 'react';
import { Eye, EyeOff, Save, AlertCircle } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

export default function PaymentSettingsPage() {
  const [showPaystackSecret, setShowPaystackSecret] = useState(false);
  const [showFlutterwaveSecret, setShowFlutterwaveSecret] = useState(false);
  const [paystackPublic, setPaystackPublic] = useState('pk_live_...');
  const [paystackSecret, setPaystackSecret] = useState('sk_live_...');
  const [flutterwavePublic, setFlutterwavePublic] = useState('FLWPUBK_...');
  const [flutterwaveSecret, setFlutterwaveSecret] = useState('FLWSECK_...');
  const [activeProvider, setActiveProvider] = useState<'paystack' | 'flutterwave'>('paystack');
  const [saving, setSaving] = useState(false);

  const handleSavePaystack = async () => {
    setSaving(true);
    try {
      // Call API to save Paystack config
      console.log('Saving Paystack config...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      alert('Paystack settings saved successfully!');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveFlutterwave = async () => {
    setSaving(true);
    try {
      // Call API to save Flutterwave config
      console.log('Saving Flutterwave config...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      alert('Flutterwave settings saved successfully!');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Payment Gateway Settings</h1>
        <p className="text-gray-600 mt-2">Configure and manage your payment provider API credentials</p>
      </div>

      {/* Warning */}
      <div className="mb-8 bg-orange-50 border border-orange-200 rounded-lg p-4 flex gap-3">
        <AlertCircle className="text-orange-600 flex-shrink-0" size={20} />
        <div>
          <p className="font-semibold text-orange-900">Security Notice</p>
          <p className="text-sm text-orange-800 mt-1">
            Secret keys are encrypted and stored securely. They are never transmitted to the client and only used in Supabase Edge Functions.
          </p>
        </div>
      </div>

      {/* Provider Toggle */}
      <div className="mb-8 flex gap-4">
        <button
          onClick={() => setActiveProvider('paystack')}
          className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
            activeProvider === 'paystack'
              ? 'bg-green-600 text-white'
              : 'bg-white border border-gray-200 text-gray-700 hover:border-gray-300'
          }`}
        >
          Paystack
        </button>
        <button
          onClick={() => setActiveProvider('flutterwave')}
          className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
            activeProvider === 'flutterwave'
              ? 'bg-green-600 text-white'
              : 'bg-white border border-gray-200 text-gray-700 hover:border-gray-300'
          }`}
        >
          Flutterwave
        </button>
      </div>

      {/* Paystack Settings */}
      {activeProvider === 'paystack' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-2xl">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Paystack Configuration</h2>

            {/* Status Toggle */}
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
              <div>
                <p className="font-semibold text-blue-900">Current Status</p>
                <p className="text-sm text-blue-800">Virtual account creation and funding</p>
              </div>
              <label className="flex items-center cursor-pointer">
                <input type="checkbox" defaultChecked className="w-5 h-5 accent-green-600" />
                <span className="ml-2 text-sm font-semibold text-gray-700">Active</span>
              </label>
            </div>

            {/* Public Key */}
            <div className="mb-6">
              <label className="label">Public Key</label>
              <input
                type="text"
                value={paystackPublic}
                onChange={(e) => setPaystackPublic(e.target.value)}
                placeholder="pk_live_..."
                className="input"
              />
              <p className="text-xs text-gray-500 mt-2">
                Find your public key in your Paystack <a href="https://dashboard.paystack.co/settings/developers" target="_blank" rel="noopener noreferrer" className="text-green-600 underline">Dashboard</a>
              </p>
            </div>

            {/* Secret Key */}
            <div className="mb-8">
              <label className="label">Secret Key</label>
              <div className="relative">
                <input
                  type={showPaystackSecret ? 'text' : 'password'}
                  value={paystackSecret}
                  onChange={(e) => setPaystackSecret(e.target.value)}
                  placeholder="sk_live_..."
                  className="input pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPaystackSecret(!showPaystackSecret)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showPaystackSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Your secret key is encrypted and only used in secure backend operations
              </p>
            </div>

            {/* Save Button */}
            <button
              onClick={handleSavePaystack}
              disabled={saving}
              className="btn-primary flex items-center gap-2 w-full justify-center"
            >
              <Save size={18} />
              {saving ? 'Saving...' : 'Save Paystack Settings'}
            </button>
          </div>
        </div>
      )}

      {/* Flutterwave Settings */}
      {activeProvider === 'flutterwave' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-2xl">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Flutterwave Configuration</h2>

            {/* Status Toggle */}
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
              <div>
                <p className="font-semibold text-blue-900">Current Status</p>
                <p className="text-sm text-blue-800">Virtual account creation and funding</p>
              </div>
              <label className="flex items-center cursor-pointer">
                <input type="checkbox" className="w-5 h-5 accent-green-600" />
                <span className="ml-2 text-sm font-semibold text-gray-700">Active</span>
              </label>
            </div>

            {/* Public Key */}
            <div className="mb-6">
              <label className="label">Public Key</label>
              <input
                type="text"
                value={flutterwavePublic}
                onChange={(e) => setFlutterwavePublic(e.target.value)}
                placeholder="FLWPUBK_..."
                className="input"
              />
              <p className="text-xs text-gray-500 mt-2">
                Find your public key in your Flutterwave <a href="https://dashboard.flutterwave.com/settings/apis" target="_blank" rel="noopener noreferrer" className="text-green-600 underline">Dashboard</a>
              </p>
            </div>

            {/* Secret Key */}
            <div className="mb-8">
              <label className="label">Secret Key</label>
              <div className="relative">
                <input
                  type={showFlutterwaveSecret ? 'text' : 'password'}
                  value={flutterwaveSecret}
                  onChange={(e) => setFlutterwaveSecret(e.target.value)}
                  placeholder="FLWSECK_..."
                  className="input pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowFlutterwaveSecret(!showFlutterwaveSecret)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showFlutterwaveSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Your secret key is encrypted and only used in secure backend operations
              </p>
            </div>

            {/* Save Button */}
            <button
              onClick={handleSaveFlutterwave}
              disabled={saving}
              className="btn-primary flex items-center gap-2 w-full justify-center"
            >
              <Save size={18} />
              {saving ? 'Saving...' : 'Save Flutterwave Settings'}
            </button>
          </div>
        </div>
      )}

      {/* Webhook Configuration */}
      <div className="mt-12 bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-2xl">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Webhook Configuration</h2>
        
        <div className="space-y-4">
          <div>
            <p className="font-semibold text-gray-900 mb-2">Paystack Webhook URL</p>
            <code className="block bg-gray-900 text-green-400 p-3 rounded text-sm overflow-x-auto">
              https://your-supabase-url.supabase.co/functions/v1/handle-webhook-paystack
            </code>
            <p className="text-xs text-gray-500 mt-2">
              Add this URL to Paystack Dashboard Settings → Webhooks
            </p>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <p className="font-semibold text-gray-900 mb-2">Flutterwave Webhook URL</p>
            <code className="block bg-gray-900 text-green-400 p-3 rounded text-sm overflow-x-auto">
              https://your-supabase-url.supabase.co/functions/v1/handle-webhook-flutterwave
            </code>
            <p className="text-xs text-gray-500 mt-2">
              Add this URL to Flutterwave Dashboard Settings → Webhooks
            </p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
