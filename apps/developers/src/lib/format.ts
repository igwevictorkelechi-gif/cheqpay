/** Minor units → "₦1,234.50" / "$12.00". */
export function money(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return "—";
  const symbol = currency === "NGN" ? "₦" : currency === "USD" ? "$" : "";
  const value = (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${minor < 0 ? "-" : ""}${symbol}${value.replace("-", "")}`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function bps(v: number): string {
  return `${(v / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}
