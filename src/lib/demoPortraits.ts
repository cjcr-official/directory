/**
 * Stand-in portraits for the sample directory, drawn on a canvas so the sample
 * needs no bundled images and no network.
 *
 * Deliberately abstract - they show how a photograph sits in the layout without
 * pretending to be anyone.
 */
export async function makeDemoPortrait(seed: number, width = 320, height = 400): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");

  const hue = (seed * 47) % 360;
  context.fillStyle = `hsl(${hue} 28% 86%)`;
  context.fillRect(0, 0, width, height);
  context.fillStyle = `hsl(${hue} 34% 58%)`;

  // Shoulders.
  context.beginPath();
  context.ellipse(width / 2, height * 1.02, width * 0.42, height * 0.72, 0, 0, Math.PI * 2);
  context.fill();

  // Head.
  context.beginPath();
  context.arc(width / 2, height * 0.36, width * 0.22, 0, Math.PI * 2);
  context.fill();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  if (!blob) throw new Error("Could not draw the sample portrait.");
  return blob;
}
