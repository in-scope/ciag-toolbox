import { createReusableSpatialFilterGrid } from "./spatial-frequency-filter";
import {
  computeSpatialFilterWorkerResponse,
  type SpatialFilterWorkerRequest,
  type SpatialFilterWorkerResponse,
} from "./spatial-filter-worker-protocol";

// CT-219a: one worker instance filters one raster's bands sequentially,
// reusing a single padded grid across them. The client terminates the worker
// after the batch, which is what releases the grid memory.

const reusableGrid = createReusableSpatialFilterGrid();

self.onmessage = (event: MessageEvent<SpatialFilterWorkerRequest>): void => {
  postSpatialFilterWorkerResponse(computeSpatialFilterWorkerResponse(event.data, reusableGrid));
};

function postSpatialFilterWorkerResponse(response: SpatialFilterWorkerResponse): void {
  if (response.kind === "filtered") {
    self.postMessage(response, { transfer: [response.values.buffer] });
    return;
  }
  self.postMessage(response);
}
