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

// CT-225: progress posts stream out mid-computation (postMessage queues to the
// main thread immediately even while this worker keeps running), so the busy
// bar advances within a band instead of only between bands.
self.onmessage = (event: MessageEvent<SpatialFilterWorkerRequest>): void => {
  const request = event.data;
  postSpatialFilterWorkerResponse(
    computeSpatialFilterWorkerResponse(request, reusableGrid, (fraction) =>
      self.postMessage({ requestId: request.requestId, kind: "progress", fraction }),
    ),
  );
};

function postSpatialFilterWorkerResponse(response: SpatialFilterWorkerResponse): void {
  if (response.kind === "filtered") {
    self.postMessage(response, { transfer: [response.values.buffer] });
    return;
  }
  self.postMessage(response);
}
