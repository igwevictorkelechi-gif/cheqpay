// apps/api/src/lib/fileSignature.ts
//
// Is this file really what it says it is? The declared content type comes from
// the client, so it proves nothing; the first bytes of the file do. A "photo"
// that is really HTML or a script is refused before it is stored — it would
// otherwise be served back later under an image content type.

const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) =>
    b.length > 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) =>
    b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  "application/pdf": (b) => b.length > 5 && b.subarray(0, 5).toString("latin1") === "%PDF-",
};

/** True when the bytes start the way files of `contentType` always do. */
export function matchesSignature(bytes: Buffer, contentType: string): boolean {
  const check = SIGNATURES[contentType];
  return Boolean(check && check(bytes));
}
