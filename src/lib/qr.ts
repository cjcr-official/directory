/**
 * The two things Supabase hands back when an authenticator is enrolled, turned
 * into what a browser and a person actually need: an image a phone can
 * photograph, and a key somebody can type.
 *
 * Its own module, with no imports, so scripts/qr-check.ts can run the same
 * functions the app runs without dragging a Supabase client into Node.
 */

/**
 * A data: URI for the QR artwork.
 *
 * Base64 rather than percent-encoding, and this is the whole point of the
 * file. Supabase's own documentation says to prepend `data:image/svg+xml;utf-8,`
 * to the artwork, and `;utf-8` is not a media type parameter - the parameter
 * is `charset`. Chrome shrugs and draws the QR anyway. WebKit reads the type
 * as `image/svg+xml;utf-8`, does not recognise it as an image, and draws the
 * broken-image placeholder - so the QR code was a grey square with a question
 * mark in it on every iPhone, and correct on every machine it was tested on.
 *
 * Base64 has no parameter to get wrong. It also cannot be tripped by the
 * `#000000` in the artwork, which ends a URL and starts a fragment if it is
 * ever pasted in raw.
 *
 * Anything already addressable is passed through untouched: a version of
 * Supabase that returns a data: URI, or a URL, is describing an image rather
 * than holding one.
 */
export function qrDataUri(qrCode: string): string {
  const value = qrCode.trim();
  if (/^(data:|https?:)/i.test(value)) return value;

  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/**
 * The setup key in groups of four.
 *
 * Thirty-two unbroken characters is a thing to lose your place in halfway
 * through, and this is typed by somebody holding a phone in one hand and
 * reading a second screen. Every authenticator ignores the spaces - base32
 * decoders skip whitespace - and the Copy button beside it copies the key
 * without them either way.
 */
export function formatSetupKey(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? [secret]).join(" ");
}
