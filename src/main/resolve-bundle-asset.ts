import { dirname, isAbsolute, resolve } from "node:path";

import {
  readFileMetadataForOpenedImagePath,
  type OpenedImageFileMetadataEntry,
} from "./opened-image-file-metadata";

// CT-236: the reply for a project bundle asset is METADATA ONLY. The old
// project:read-bundle-asset handler returned the whole asset (and its ENVI
// binary sidecar) as one structured-clone reply, which caps out near 2 GiB
// (see src/shared/chunked-opened-image-read-protocol.ts). The renderer now
// resolves the asset to a path here and streams its bytes through the chunked
// opened-image read protocol, which also handles the 16 GiB openable guard,
// ENVI .bin sidecar discovery, and content hashing.

export interface ResolveBundleAssetRequest {
  readonly projectFilePath: string;
  readonly relativePath: string;
}

export type ResolveBundleAssetResult =
  | { kind: "missing"; relativePath: string }
  | { kind: "found"; file: OpenedImageFileMetadataEntry };

export function resolveBundleAssetAbsolutePath(
  projectFilePath: string,
  relativePath: string,
): string {
  if (isAbsolute(relativePath)) return relativePath;
  return resolve(dirname(projectFilePath), relativePath);
}

export async function resolveBundleAssetToFileMetadata(
  request: ResolveBundleAssetRequest,
): Promise<ResolveBundleAssetResult> {
  const absolutePath = resolveBundleAssetAbsolutePath(
    request.projectFilePath,
    request.relativePath,
  );
  try {
    return { kind: "found", file: await readFileMetadataForOpenedImagePath(absolutePath) };
  } catch {
    return { kind: "missing", relativePath: request.relativePath };
  }
}
