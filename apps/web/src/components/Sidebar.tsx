"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Wallet,
  Send,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useAuthStore, useUIStore } from "@/store";
import { authService } from "@/services/auth";
import { useState } from "react";

const navItems = [
  { icon: Wallet, label: "Wallet", href: "/" },
  { icon: Send, label: "Send Money", href: "/send" },
  { icon: BarChart3, label: "Transactions", href: "/transactions" },
  { icon: Settings, label: "Settings", href: "/settings" },
];

export default function Sidebar() {
  const router = useRouter();
  const { logout } = useAuthStore();
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const [isLoading, setIsLoading] = useState(false);

  const handleLogout = async () => {
    try {
      setIsLoading(true);
      await authService.logout();
      logout();
      router.push("/login");
    } catch (error) {
      console.error("Logout failed:", error);
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Mobile Menu Toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed left-4 top-4 z-50 md:hidden rounded-lg p-2 hover:bg-gray-100"
      >
        {sidebarOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <Menu className="h-6 w-6" />
        )}
      </button>

      {/* Sidebar */}
      <div
        className={`fixed left-0 top-0 h-screen w-64 transform bg-white shadow-lg transition-transform duration-300 md:relative md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } z-40`}
      >
        {/* Logo */}
        <div className="border-b border-gray-200 p-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-white font-bold text-lg">₦</span>
            </div>
            <span className="font-bold text-lg">Cheqpay</span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-2 p-4">
          {navItems.map(({ icon: Icon, label, href }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-lg px-4 py-3 text-gray-700 transition-all hover:bg-primary-light hover:text-primary"
              onClick={() => setSidebarOpen(false)}
            >
              <Icon className="h-5 w-5" />
              <span className="font-medium">{label}</span>
            </Link>
          ))}
        </nav>

        {/* Logout Button */}
        <div className="border-t border-gray-200 p-4">
          <button
            onClick={handleLogout}
            disabled={isLoading}
            className="btn-danger w-full flex items-center justify-center gap-2"
          >
            <LogOut className="h-4 w-4" />
            {isLoading ? "Logging out..." : "Logout"}
          </button>
        </div>
      </div>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </>
  );
}
