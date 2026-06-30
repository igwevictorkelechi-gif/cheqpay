"use client";

import { useState } from "react";
import MainLayout from "@/components/MainLayout";
import { useAuthStore, useUIStore } from "@/store";
import { Settings } from "lucide-react";

export default function SettingsPage() {
  const { user } = useAuthStore();
  const { darkMode, setDarkMode } = useUIStore();
  const [notifications, setNotifications] = useState(true);
  const [biometric, setBiometric] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSavePreferences = () => {
    // Save preferences logic
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <MainLayout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-3">
          <Settings className="h-6 w-6 text-primary" />
          Settings
        </h1>

        {/* User Profile Section */}
        <div className="card-lg mb-6">
          <h2 className="text-lg font-bold mb-4">User Profile</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-4 border-b border-gray-200">
              <div>
                <p className="text-sm text-gray-600">Full Name</p>
                <p className="font-medium">{user?.full_name}</p>
              </div>
            </div>
            <div className="flex items-center justify-between pb-4 border-b border-gray-200">
              <div>
                <p className="text-sm text-gray-600">Phone Number</p>
                <p className="font-medium">{user?.phone}</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Email Address</p>
                <p className="font-medium">{user?.email}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Preferences Section */}
        <div className="card-lg mb-6">
          <h2 className="text-lg font-bold mb-4">Preferences</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Push Notifications</p>
                <p className="text-sm text-gray-600">Receive transaction alerts</p>
              </div>
              <button
                onClick={() => setNotifications(!notifications)}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                  notifications ? "bg-primary" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                    notifications ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="border-t border-gray-200 pt-4 flex items-center justify-between">
              <div>
                <p className="font-medium">Biometric Authentication</p>
                <p className="text-sm text-gray-600">Use fingerprint or face ID</p>
              </div>
              <button
                onClick={() => setBiometric(!biometric)}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                  biometric ? "bg-primary" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                    biometric ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="border-t border-gray-200 pt-4 flex items-center justify-between">
              <div>
                <p className="font-medium">Dark Mode</p>
                <p className="text-sm text-gray-600">Easier on the eyes at night</p>
              </div>
              <button
                onClick={() => setDarkMode(!darkMode)}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                  darkMode ? "bg-primary" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                    darkMode ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>

          {saved && (
            <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800 border border-green-200">
              Preferences saved successfully!
            </div>
          )}

          <button
            onClick={handleSavePreferences}
            className="btn-primary w-full mt-6"
          >
            Save Preferences
          </button>
        </div>

        {/* Help Section */}
        <div className="card-lg">
          <h2 className="text-lg font-bold mb-4">Help & Support</h2>
          <div className="space-y-3">
            <a
              href="mailto:support@cheqpay.com"
              className="block p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-200"
            >
              <p className="font-medium">Contact Support</p>
              <p className="text-sm text-gray-600">support@cheqpay.com</p>
            </a>
            <a
              href="/faq"
              className="block p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-200"
            >
              <p className="font-medium">FAQs</p>
              <p className="text-sm text-gray-600">Answers to common questions</p>
            </a>
            <a
              href="/privacy"
              className="block p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-200"
            >
              <p className="font-medium">Privacy Policy</p>
              <p className="text-sm text-gray-600">View our privacy policy</p>
            </a>
            <a
              href="/terms"
              className="block p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-200"
            >
              <p className="font-medium">Terms of Service</p>
              <p className="text-sm text-gray-600">View our terms</p>
            </a>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
