/** Browser-safe helpers for editing your own display name and picture. */

/** Message the connected wallet signs to authorise a profile edit. */
export function profileEditMessage(target: string, nonce: string) {
  return [
    "Conviction — update profile",
    `Profile wallet: ${target.toLowerCase()}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export const MAX_AVATAR_BYTES = 200_000;
export const MAX_DISPLAY_NAME = 32;

/**
 * Downscale an image file to a square data URL small enough to store inline —
 * no storage bucket, no signed URLs, and it renders instantly everywhere.
 */
export async function fileToAvatarDataUrl(file: File, size = 256): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process that image.");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close?.();

  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/webp", quality);
    if (url.length <= MAX_AVATAR_BYTES) return url;
  }
  throw new Error("That image is too large — try a smaller one.");
}
