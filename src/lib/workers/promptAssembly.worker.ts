import {
  buildDynamicMessagesFastPath,
  deepVariableReplacer,
  hasTemplateVariables,
} from "@/lib/functions/common.function";
import type { AIImagePayload, Message } from "@/types";

type WorkerRequest = {
  id: number;
  payload: {
    bodyObj: unknown;
    url: string;
    headers: Record<string, string>;
    requestMethod: string;
    enableStreaming: boolean;
    history: Message[];
    userMessage: string;
    imagesBase64: AIImagePayload[];
    allVariables: Record<string, string>;
  };
};

type WorkerResponse = {
  id: number;
  ok: true;
  payload: {
    requestBody?: string;
    url: string;
    headers: Record<string, string>;
  };
};

type WorkerError = {
  id: number;
  ok: false;
  error: string;
};

const normalizeHeaders = (headers: unknown): Record<string, string> => {
  if (!headers || typeof headers !== "object") {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    normalized[key] = typeof value === "string" ? value : String(value ?? "");
  }

  return normalized;
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, payload } = event.data;

  try {
    const baseBody = payload.bodyObj;
    let bodyObj = baseBody;
    if (bodyObj && typeof bodyObj === "object") {
      const mutableBody = bodyObj as Record<string, unknown>;
      const messagesKey = Object.keys(mutableBody).find((key) =>
        ["messages", "contents", "conversation", "history"].includes(key)
      );

      if (messagesKey && Array.isArray(mutableBody[messagesKey])) {
        const messagesTemplate = mutableBody[messagesKey] as any[];
        const templateHasTextPlaceholder = messagesTemplate.some((templateItem) => {
          return hasTemplateVariables(templateItem) &&
            JSON.stringify(templateItem).includes("{{TEXT}}");
        });

        if (templateHasTextPlaceholder) {
          mutableBody[messagesKey] = buildDynamicMessagesFastPath(
            messagesTemplate,
            payload.history,
            payload.userMessage,
            payload.imagesBase64
          );
        } else {
          mutableBody[messagesKey] = [
            ...payload.history,
            {
              role: "user",
              content: payload.userMessage,
            },
          ];
        }
      }

      bodyObj = mutableBody;
    }

    if (hasTemplateVariables(bodyObj)) {
      bodyObj = deepVariableReplacer(bodyObj, payload.allVariables);
    }

    if (
      payload.enableStreaming &&
      bodyObj &&
      typeof bodyObj === "object" &&
      payload.requestMethod !== "GET"
    ) {
      const mutableBody = bodyObj as Record<string, unknown>;
      const streamKey = Object.keys(mutableBody).find(
        (key) => key.toLowerCase() === "stream"
      );
      if (streamKey) {
        mutableBody[streamKey] = true;
      } else {
        mutableBody.stream = true;
      }
    }

    const requestBody =
      payload.requestMethod === "GET" ? undefined : JSON.stringify(bodyObj);

    const url = hasTemplateVariables(payload.url)
      ? deepVariableReplacer(payload.url, payload.allVariables)
      : payload.url;

    const headersWithVars = normalizeHeaders(payload.headers);
    const headers = hasTemplateVariables(headersWithVars)
      ? (deepVariableReplacer(headersWithVars, payload.allVariables) as Record<
          string,
          string
        >)
      : headersWithVars;

    const response: WorkerResponse = {
      id,
      ok: true,
      payload: {
        requestBody,
        url,
        headers,
      },
    };

    self.postMessage(response);
  } catch (error) {
    const errorResponse: WorkerError = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : "Prompt assembly worker error",
    };
    self.postMessage(errorResponse);
  }
};
