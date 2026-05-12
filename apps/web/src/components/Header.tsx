"use client";

import { Bell, Settings, User } from "lucide-react";
import { useAuthStore } from "@/store";

export default function Header() {
  const { user } = useAuthStore();

  return (
    <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
      <div className="flex items-center justify-between px-4 py-4 md:px-6">
        <div className="flex-1" />

        {/* Right Section */}
        <div className="flex items-center gap-4">
          {/* Search - hidden on mobile */}
          <input
            type="text"
            placeholder="Search..."
            className="hidden sm:inline-block rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-primary focus:outline-none"
          />

          {/* Notifications */}
          <button className="relative rounded-lg p-2 hover:bg-gray-100">
            <Bell className="h-5 w-5 text-gray-600" />
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" />
          </button>

          {/* Settings */}
          <button className="rounded-lg p-2 hover:bg-gray-100">
            <Settings className="h-5 w-5 text-gray-600" />
          </button>

          {/* User Avatar */}
          <div className="flex items-center gap-3 border-l border-gray-200 pl-4">
            <div className="hidden sm:block text-right">
              <p className="text-sm font-medium text-gray-900">{user?.full_name}</p>
              <p className="text-xs text-gray-500">{user?.phone}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white font-semibold">
              {user?.full_name?.charAt(0).toUpperCase() || "U"}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
