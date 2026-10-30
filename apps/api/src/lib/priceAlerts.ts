/**
 * Has a standing alert's target been crossed by the current spot price?
 *
 * ABOVE fires when the price reaches or passes the target from below (or is
 * already at/above it); BELOW fires at or under the target. Alerts are one-shot,
 * so the cron deactivates them after firing — there is no re-cross tracking here.
 */
export function alertCrossed(direction: string, target: number, price: number): boolean {
  if (!Number.isFinite(target) || !Number.isFinite(price)) return false;
  if (direction === "ABOVE") return price >= target;
  if (direction === "BELOW") return price <= target;
  return false;
}

/** A short "$12,345" style price for notification copy. */
export function prettyUsd(price: number): string {
  return `$${price.toLocaleString("en-US", { maximumFractionDigits: price < 10 ? 4 : 0 })}`;
}
