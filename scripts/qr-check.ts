/**
 * That the QR code setting up an authenticator is an image a phone can read.
 *
 * It was not, on the one browser that matters most here. Supabase's own
 * documentation says to prepend `data:image/svg+xml;utf-8,` to the artwork it
 * returns, and `;utf-8` is not a media type parameter - the parameter is
 * `charset`. Chrome shrugs and draws the QR. WebKit reads the type as
 * `image/svg+xml;utf-8`, does not know it as an image, and draws the
 * broken-image placeholder instead: a grey square with a question mark, on
 * every iPhone, under the words "scan the square below". It was looked at in a
 * browser before it shipped - just not in that one.
 *
 * Written as a rule about the function rather than about a rendered page, in
 * the same spirit as fields-check and strip-check: seeing this needs an
 * iPhone, and an iPhone is not what CI has. What CI can hold is that the URI
 * is one browsers agree on, and that what comes out of it is byte for byte
 * what went in.
 *
 * Run with: npm run qr:check
 */

import { qrDataUri, formatSetupKey } from "@/lib/qr";
import { check } from "./check";
import { readFileSync } from "node:fs";

/** What Supabase hands back: SVG source, with a colour written as a hex. */
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 29 29">' +
  '<rect width="29" height="29" fill="#ffffff"/>' +
  '<path fill="#000000" d="M0 0h7v7H0zM22 0h7v7h-7zM0 22h7v7H0z"/>' +
  "</svg>";

const uri = qrDataUri(SVG);

check("the artwork becomes a data: URI", uri.startsWith("data:"), uri.slice(0, 32) + "…");

check(
  "declared as SVG, base64, with no charset to get wrong",
  uri.startsWith("data:image/svg+xml;base64,"),
  uri.slice(0, uri.indexOf(",") + 1),
);

// The failure this file exists for. `;utf-8` parses as part of the media type
// in WebKit, which then has no image type to draw.
check(
  "the media type carries no bare ;utf-8",
  !/^data:[^,]*;utf-8/i.test(uri),
  "WebKit reads image/svg+xml;utf-8 as the type itself and draws nothing",
);

const decoded = new TextDecoder().decode(
  Uint8Array.from(atob(uri.slice(uri.indexOf(",") + 1)), (c) => c.charCodeAt(0)),
);
check("and it decodes back to the artwork, byte for byte", decoded === SVG);

// The other half of why base64: a # ends a URL and starts a fragment, so raw
// artwork pasted into a data: URI is truncated at its first colour.
check("the hex colours survive it", decoded.includes("#000000") && decoded.includes("#ffffff"));

// A degree sign, an accent, anything above ASCII: btoa alone throws on these,
// so the bytes are encoded before they are base64'd.
const wide = '<svg xmlns="http://www.w3.org/2000/svg"><title>Fairhaven — Café</title></svg>';
let survived = false;
try {
  const back = qrDataUri(wide);
  survived =
    new TextDecoder().decode(
      Uint8Array.from(atob(back.slice(back.indexOf(",") + 1)), (c) => c.charCodeAt(0)),
    ) === wide;
} catch (cause) {
  survived = false;
  console.log(`      ${cause instanceof Error ? cause.message : String(cause)}`);
}
check("text above ASCII survives it too", survived);

// A Supabase release that returns something already addressable is describing
// an image rather than holding one, and re-encoding it would break it.
check(
  "a data: URI is passed through untouched",
  qrDataUri("data:image/png;base64,AAAA") === "data:image/png;base64,AAAA",
);
check(
  "and so is a URL",
  qrDataUri("https://example.test/qr.png") === "https://example.test/qr.png",
);

// The key beside the QR, for the phone that cannot photograph this screen.
check(
  "the setup key is grouped in fours",
  formatSetupKey("IYTNRYQD2GGETHW6HEZ7R3BT3EA7G2CK") === "IYTN RYQD 2GGE THW6 HEZ7 R3BT 3EA7 G2CK",
  formatSetupKey("IYTNRYQD2GGETHW6HEZ7R3BT3EA7G2CK"),
);

check(
  "and a key that does not divide by four keeps every character",
  formatSetupKey("ABCDEF").replace(/ /g, "") === "ABCDEF",
  formatSetupKey("ABCDEF"),
);

// The half of this that is not the artwork: the pane has to still be there
// when you come back from the authenticator app. UpdateGate reloads on the
// visibilitychange that returning fires, and its guard against destroying work
// only knows about typing - the trip out happens before a digit is typed. So a
// reload landed on the enrolment and took the secret with it, and the next
// attempt had to unenrol the half-made factor before it could start again.
//
// A rule about the source rather than a rendered page, in the same spirit as
// fields-check and strip-check: seeing this needs a phone, a backgrounded app
// and a deploy in flight, and CI has none of the three.
const gate = readFileSync("src/components/UpdateGate.tsx", "utf8");
const busy = /const busy =[^;]*;/.exec(gate)?.[0] ?? "";
check("the enrolment screen holds a reload back", busy.includes('"/settings"'), busy);
check(
  "as the backup and the preview still do",
  busy.includes('"/backup"') && busy.includes('"/preview"'),
  busy,
);
