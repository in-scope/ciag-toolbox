import type { ViewportImageSource } from "@/lib/webgl/texture";

export async function decodeImageBytesToViewportSource(
  bytes: Uint8Array,
): Promise<ViewportImageSource> {
  const blob = new Blob([copyBytesToOwnArrayBuffer(bytes)]);
  const bitmap = await createImageBitmap(blob);
  return { kind: "image-bitmap", image: bitmap };
}

function copyBytesToOwnArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
