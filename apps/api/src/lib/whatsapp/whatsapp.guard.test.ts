// apps/api/src/lib/whatsapp/whatsapp.guard.test.ts
//
// The WhatsApp bot must never move money.
//
// Everything it can offer is either a read, or a composed action confirmed with
// the transaction PIN on the website by the routes that already exist. That is
// not a style preference: a chat transcript lives in Meta's message history and
// in unencrypted phone backups, and the WhatsApp account itself falls to a SIM
// swap. The bot holding spending authority would make all of that sufficient to
// drain an account.
//
// It is an easy invariant to break by accident — one convenient import — and
// impossible to notice in review once it is broken. So it is a test.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = __dirname;

/**
 * Helpers that debit, credit or instruct a provider to pay. Importing any of
 * these into the bot would hand it the authority the design withholds.
 */
const FORBIDDEN = [
  "lib/ledger",
  "lib/ngnPayout",
  "lib/billPay",
  "lib/swap",
  "lib/cardFunding",
  "lib/autoCashout",
  "lib/devapi/walletMoves",
  "ajo/personal",
  "ajo/groups",
  "creditBalance",
  "debitBalance",
  "initiateNgnPayout",
  "executeBillPayment",
  "executeSwap",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(path);
    }
  }
  return out;
}

describe("the WhatsApp bot holds no spending authority", () => {
  const files = sourceFiles(DIR);

  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file.slice(DIR.length + 1)} imports no money-moving helper`, () => {
      const source = readFileSync(file, "utf8");
      // Only the import block matters: a mention inside a comment or a user
      // facing string is fine, and this file itself names them all.
      const imports = source
        .split("\n")
        .filter((line) => /^\s*(import|export)\s.*\sfrom\s/.test(line) || /\brequire\(/.test(line))
        .join("\n");
      for (const needle of FORBIDDEN) {
        expect(imports, `${file} must not import ${needle}`).not.toContain(needle);
      }
    });
  }

  it("names every helper it is guarding against", () => {
    // Catches the quiet failure where someone empties the list to make the
    // suite pass.
    expect(FORBIDDEN.length).toBeGreaterThanOrEqual(14);
  });
});
