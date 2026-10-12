import type { Metadata } from "next";
import DashShell from "@/components/DashShell";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashShell>{children}</DashShell>;
}
