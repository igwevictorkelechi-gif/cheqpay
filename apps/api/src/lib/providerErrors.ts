// apps/api/src/lib/providerErrors.ts
//
// Did the provider REFUSE this request, or do we simply not know what happened?
//
// That is the question every money-out path asks when a provider call throws,
// and the two answers need opposite handling:
//
//   - refused (an HTTP 4xx: bad account, insufficient float, validation) —
//     nothing was sent, so the user's money goes straight back;
//   - unknown (a timeout, a dropped connection, a 5xx) — the payout may well
//     have gone out. Refunding now can pay the same money twice: once to the
//     bank account, and again to the balance. The row stays in flight and the
//     webhook or the reconcile job settles it.

/** True only when the provider definitely did not act on the request. */
export function isDefiniteRejection(err: unknown): boolean {
  const e = err as { providerStatus?: unknown; status?: unknown } | null;
  const status =
    typeof e?.providerStatus === "number"
      ? e.providerStatus
      : typeof e?.status === "number"
        ? e.status
        : null;
  return status !== null && status >= 400 && status < 500;
}
