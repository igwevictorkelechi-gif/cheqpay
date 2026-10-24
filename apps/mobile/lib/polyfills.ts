// Web APIs that libraries expect but React Native 0.73's engine lacks.
// Imported first by app/_layout.tsx, so they are in place before any screen.

/**
 * UTF-8 only, which is all TextEncoder does. The QR codes (crypto deposit
 * addresses, 2FA set-up, event tickets) are drawn by a library that calls
 * `new TextEncoder().encode(text)`. React Native has no TextEncoder before
 * 0.75, so without this every QR code threw and closed the app.
 */
class Utf8Encoder {
  readonly encoding = 'utf-8';

  encode(input = ''): Uint8Array {
    const bytes: number[] = [];
    for (let i = 0; i < input.length; i++) {
      let c = input.charCodeAt(i);
      // A surrogate pair is one character above U+FFFF.
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < input.length) {
        const low = input.charCodeAt(i + 1);
        if (low >= 0xdc00 && low < 0xe000) {
          c = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00);
          i++;
        }
      }
      // A lone surrogate becomes U+FFFD, as the real TextEncoder does.
      if (c >= 0xd800 && c < 0xe000) c = 0xfffd;
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      else
        bytes.push(
          0xf0 | (c >> 18),
          0x80 | ((c >> 12) & 0x3f),
          0x80 | ((c >> 6) & 0x3f),
          0x80 | (c & 0x3f),
        );
    }
    return new Uint8Array(bytes);
  }
}

const g = globalThis as { TextEncoder?: unknown };
if (typeof g.TextEncoder === 'undefined') g.TextEncoder = Utf8Encoder;

export {};
