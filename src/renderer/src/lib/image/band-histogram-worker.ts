import {
  computeBandHistogramWorkerResponseFromRequest,
  type BandHistogramWorkerRequest,
} from "@/lib/image/band-histogram-worker-protocol";

self.onmessage = (event: MessageEvent<BandHistogramWorkerRequest>): void => {
  const response = computeBandHistogramWorkerResponseFromRequest(event.data);
  self.postMessage(response);
};
