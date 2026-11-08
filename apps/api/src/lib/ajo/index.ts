// apps/api/src/lib/ajo/index.ts
//
// Ajo savings: personal plans (personal.ts), rotating groups (groups.ts) and
// the arrears lien (lien.ts). runAjo is what the scheduler calls.

import { ensureAjoSchema } from "./schema";
import { runDuePlans } from "./personal";
import { runDueRounds, sweepArrears } from "./groups";

export { ensureAjoSchema } from "./schema";
export { ajoArrearsKobo, assertNoAjoArrears } from "./lien";
export { breakPlan, createPlan, listPlans, type PlanRow } from "./personal";
export {
  cancelGroup,
  createGroup,
  groupDetail,
  joinGroup,
  leaveGroup,
  listMyGroups,
  runDueRounds,
  startGroup,
  sweepArrears,
  type GroupRow,
} from "./groups";

/**
 * One scheduler pass, within a time budget:
 *   1. sweep arrears first, so money that came in since the last pass reaches
 *      the collectors it is owed to before anything else touches it;
 *   2. run due group rounds;
 *   3. take due personal-plan contributions.
 */
export async function runAjo(opts: { budgetMs: number }) {
  await ensureAjoSchema();
  const deadline = Date.now() + opts.budgetMs;
  const arrears = await sweepArrears({ deadline });
  const rounds = await runDueRounds({ deadline });
  const plans = await runDuePlans({ deadline });
  return {
    arrears: { users: arrears.users, settledKobo: arrears.settledKobo.toString() },
    rounds,
    plans,
  };
}
