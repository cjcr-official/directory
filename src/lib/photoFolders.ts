/**
 * The folders of the photo bucket, in one place.
 *
 * Saving a photograph names its folder from this list, and backing up and
 * restoring reads the same list - so a new kind of photograph cannot be saved
 * somewhere a backup does not look. scripts/backup-coverage-check.ts holds the
 * rest of the app to it.
 */
export const PHOTO_FOLDERS = ["households", "people", "covers"] as const;

export type PhotoFolder = (typeof PHOTO_FOLDERS)[number];
