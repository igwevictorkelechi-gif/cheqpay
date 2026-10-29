import { createHash } from "node:crypto";
import type { NqrMerchant, NqrPayloadInput, NqrProvider } from "./types";

/**
 * A mock NQR provider for tests and the pentest lab.
 *
 * It emits a *structurally* valid EMVCo TLV string (correct tag/length framing
 * and a correct CRC-16/CCITT-FALSE checksum), so parsing and QR rendering can
 * be exercised end to end — but every code it mints is marked as a MOCK
 * merchant and could never settle against a real bank app. `live` is false, so
 * callers can refuse to show these as if they were payable.
 */

/** EMVCo uses CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over the payload
 * including the "6304" tag+length, as a 4-char uppercase hex string. */
export function emvCrc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** One EMVCo data object: two-digit id, two-digit length, then the value. */
function tlv(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, "0")}${value}`;
}

export class MockNqrProvider implements NqrProvider {
  readonly name = "mock";
  readonly live = false;

  async registerMerchant(merchant: NqrMerchant): Promise<{ merchantId: string }> {
    // Deterministic from the account, so a re-register returns the same id.
    const h = createHash("sha256").update(merchant.accountNumber).digest("hex").slice(0, 12);
    return { merchantId: `MOCK${h.toUpperCase()}` };
  }

  async generatePayload(input: NqrPayloadInput): Promise<string> {
    const amount = input.amountMinor != null ? (Number(input.amountMinor) / 100).toFixed(2) : null;
    let body =
      tlv("00", "01") + // payload format indicator
      tlv("01", amount ? "12" : "11") + // 11 = static (payer enters amount), 12 = dynamic
      // Merchant account information (mock scheme under a reserved template id).
      tlv("26", tlv("00", "ng.mock.nqr") + tlv("01", input.merchantId)) +
      tlv("52", "0000") + // merchant category code (unset)
      tlv("53", "566") + // currency = NGN (ISO 4217 566)
      (amount ? tlv("54", amount) : "") +
      tlv("58", "NG") + // country
      tlv("59", "CHEQPAY LAB") + // merchant name
      tlv("60", "LAGOS") + // city
      (input.reference ? tlv("62", tlv("05", input.reference.slice(0, 25))) : "");
    body += "6304"; // CRC tag + length, checksum computed over everything up to here
    return body + emvCrc16(body);
  }
}
