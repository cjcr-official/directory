import { PHOTO_BUCKET, supabase } from "./supabase";

/**
 * Photographs, end to end.
 *
 * Resizing happens in the browser before anything is uploaded. A phone photo
 * is often 4-8 MB; at the size it prints (about 1.7 inches wide) 900 pixels on
 * the long edge is already past what any printer resolves. Shrinking first
 * means uploads finish quickly on a church hall's wifi, storage stays small,
 * and a 200-family PDF builds in seconds instead of minutes.
 */

const MAX_EDGE = 900;
const JPEG_QUALITY = 0.85;

export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
  /** An object URL for previewing before upload. Revoke it when done. */
  previewUrl: string;
}

/** Decodes, downscales and re-encodes a chosen file as a JPEG. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot process images.");
    context.imageSmoothingQuality = "high";
    // A white ground, so a transparent PNG does not print as a black box.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new Error("Could not read that image.");

    return { blob, width, height, previewUrl: URL.createObjectURL(blob) };
  } finally {
    bitmap.close();
  }
}

function randomId(): string {
  return crypto.randomUUID();
}

/** Uploads a prepared photo and returns its storage path. */
export async function uploadPhoto(
  kind: "households" | "people",
  blob: Blob,
): Promise<string> {
  const path = `${kind}/${randomId()}.jpg`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

/** Best-effort removal; a missing object is not worth interrupting a save for. */
export async function removePhoto(path: string | null | undefined): Promise<void> {
  if (!path) return;
  await supabase.storage.from(PHOTO_BUCKET).remove([path]);
}

// ---------------------------------------------------------------------------
// Reading photos back
// ---------------------------------------------------------------------------

const SIGNED_URL_TTL = 60 * 60; // one hour
const SIGN_BATCH = 100;
const signedUrls = new Map<string, { url: string; expires: number }>();

/**
 * A short-lived URL for showing a photo in the app.
 *
 * The bucket is private, so these are signed per administrator and expire.
 * They are cached in memory and re-issued a minute before expiry, and requests
 * are batched so a list of 200 faces costs one round trip rather than 200.
 */
export async function getPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const now = Date.now();
  const missing: string[] = [];

  for (const path of new Set(paths)) {
    const cached = signedUrls.get(path);
    if (cached && cached.expires > now) result.set(path, cached.url);
    else missing.push(path);
  }

  // Signing is one round trip per batch, but a whole-congregation request can
  // be hundreds of paths, which is a large POST body and a slow single call.
  const expires = now + (SIGNED_URL_TTL - 60) * 1000;
  for (let i = 0; i < missing.length; i += SIGN_BATCH) {
    const batch = missing.slice(i, i + SIGN_BATCH);
    const { data, error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(batch, SIGNED_URL_TTL);
    if (error) throw new Error(error.message);

    for (const item of data ?? []) {
      if (!item.signedUrl || !item.path) continue;
      signedUrls.set(item.path, { url: item.signedUrl, expires });
      result.set(item.path, item.signedUrl);
    }
  }

  return result;
}

export async function getPhotoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const urls = await getPhotoUrls([path]);
  return urls.get(path) ?? null;
}

/**
 * Raw bytes, for embedding into a PDF. Downloads straight from storage with
 * the administrator's own credentials - no signed URL round trip.
 */
export async function downloadPhoto(path: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}
