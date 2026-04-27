export type ViewportImageSource =
  | { kind: "html-image"; image: HTMLImageElement }
  | { kind: "image-bitmap"; image: ImageBitmap }
  | {
      kind: "pixels";
      pixels: Uint8ClampedArray | Uint8Array;
      width: number;
      height: number;
    };

export function createTextureFromSource(
  gl: WebGL2RenderingContext,
  source: ViewportImageSource,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Failed to create WebGL texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  configureClampedLinearTextureParameters(gl);
  uploadSourceToBoundTexture(gl, source);
  return texture;
}

function configureClampedLinearTextureParameters(
  gl: WebGL2RenderingContext,
): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function uploadSourceToBoundTexture(
  gl: WebGL2RenderingContext,
  source: ViewportImageSource,
): void {
  if (source.kind === "pixels") {
    uploadPixelsToBoundTexture(gl, source.pixels, source.width, source.height);
    return;
  }
  uploadDomImageToBoundTexture(gl, source.image);
}

function uploadPixelsToBoundTexture(
  gl: WebGL2RenderingContext,
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): void {
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels,
  );
}

function uploadDomImageToBoundTexture(
  gl: WebGL2RenderingContext,
  image: HTMLImageElement | ImageBitmap,
): void {
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
}

export function deleteTextureSafely(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture | null,
): void {
  if (!texture) return;
  gl.deleteTexture(texture);
}
