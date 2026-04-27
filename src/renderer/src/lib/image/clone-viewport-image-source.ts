import type { ViewportImageSource } from "@/lib/webgl/texture";

export async function cloneViewportImageSource(
  source: ViewportImageSource,
): Promise<ViewportImageSource> {
  if (source.kind === "pixels") return clonePixelsSource(source);
  return cloneDomImageSource(source.image);
}

function clonePixelsSource(source: {
  pixels: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}): ViewportImageSource {
  const pixelsCopy = new Uint8ClampedArray(source.pixels);
  return { kind: "pixels", pixels: pixelsCopy, width: source.width, height: source.height };
}

async function cloneDomImageSource(
  image: HTMLImageElement | ImageBitmap,
): Promise<ViewportImageSource> {
  const independentBitmap = await createImageBitmap(image);
  return { kind: "image-bitmap", image: independentBitmap };
}
