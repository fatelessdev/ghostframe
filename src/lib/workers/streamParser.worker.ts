import {
  buildStreamingContentPaths,
  getStreamingContent,
} from "@/lib/functions/common.function";

type WorkerRequest = {
  id: number;
  payload: {
    textChunk: string;
    buffer: string;
    responseContentPath: string;
    flush: boolean;
  };
};

type WorkerResponse = {
  id: number;
  ok: true;
  payload: {
    deltas: string[];
    nextBuffer: string;
  };
};

type WorkerError = {
  id: number;
  ok: false;
  error: string;
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, payload } = event.data;

  try {
    const text = `${payload.buffer || ""}${payload.textChunk || ""}`;
    const lines = text.split("\n");
    const nextBuffer = payload.flush ? "" : lines.pop() || "";
    const streamingContentPaths = buildStreamingContentPaths(payload.responseContentPath);

    const deltas: string[] = [];
    for (const line of lines) {
      if (!line.startsWith("data:")) {
        continue;
      }

      const trimmed = line.substring(5).trim();
      if (!trimmed || trimmed === "[DONE]") {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed);
        const delta = getStreamingContent(
          parsed,
          payload.responseContentPath,
          streamingContentPaths
        );
        if (delta) {
          deltas.push(delta);
        }
      } catch {
        // Ignore parsing errors for partial JSON chunks
      }
    }

    const response: WorkerResponse = {
      id,
      ok: true,
      payload: {
        deltas,
        nextBuffer,
      },
    };

    self.postMessage(response);
  } catch (error) {
    const errorResponse: WorkerError = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : "Stream parser worker error",
    };

    self.postMessage(errorResponse);
  }
};
