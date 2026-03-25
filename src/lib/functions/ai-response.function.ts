import {
  buildStreamingContentPaths,
  buildDynamicMessages,
  deepVariableReplacer,
  extractVariables,
  getByPath,
  hasTemplateVariables,
  getStreamingContent,
} from "./common.function";
import { Message, TYPE_PROVIDER } from "@/types";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import curl2Json from "@bany/curl-to-json";
import { getResponseSettings, RESPONSE_LENGTHS, LANGUAGES } from "@/lib";
import {
  AI_MODE_VARIABLE_KEYS,
  DEFAULT_AI_MODE,
  MARKDOWN_FORMATTING_INSTRUCTIONS,
} from "@/config/constants";

const curlJsonCache = new Map<string, ReturnType<typeof curl2Json>>();
const curlVariableCache = new Map<string, ReturnType<typeof extractVariables>>();
const RETRYABLE_API_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const API_REQUEST_MAX_ATTEMPTS = 3;
const API_REQUEST_RETRY_BASE_DELAY_MS = 180;
const API_REQUEST_RETRY_MAX_DELAY_MS = 2400;
let promptAssemblyWorker: Worker | null = null;
let promptAssemblyRequestSeq = 0;

type PromptAssemblyWorkerRequestPayload = {
  bodyObj: unknown;
  url: string;
  headers: Record<string, string>;
  history: Message[];
  userMessage: string;
  imagesBase64: string[];
  allVariables: Record<string, string>;
};

type PromptAssemblyWorkerRequest = {
  id: number;
  payload: PromptAssemblyWorkerRequestPayload;
};

type PromptAssemblyWorkerSuccess = {
  id: number;
  ok: true;
  payload: {
    bodyObj: unknown;
    url: string;
    headers: Record<string, string>;
  };
};

type PromptAssemblyWorkerFailure = {
  id: number;
  ok: false;
  error: string;
};

type PromptAssemblyWorkerResponse =
  | PromptAssemblyWorkerSuccess
  | PromptAssemblyWorkerFailure;

function shouldUsePromptAssemblyWorker(payload: {
  bodyObj: unknown;
  history: Message[];
  imagesBase64: string[];
}): boolean {
  if (payload.imagesBase64.length > 0) {
    return true;
  }

  if (payload.history.length >= 6) {
    return true;
  }

  if (!payload.bodyObj || typeof payload.bodyObj !== "object") {
    return false;
  }

  const body = payload.bodyObj as Record<string, unknown>;
  const messages = body.messages;
  if (Array.isArray(messages) && messages.length >= 6) {
    return true;
  }

  return false;
}

function getPromptAssemblyWorker(): Worker {
  if (promptAssemblyWorker) {
    return promptAssemblyWorker;
  }

  promptAssemblyWorker = new Worker(
    new URL("@/lib/workers/promptAssembly.worker.ts", import.meta.url),
    {
      type: "module",
    }
  );

  return promptAssemblyWorker;
}

async function assemblePromptPayloadInWorker(
  payload: PromptAssemblyWorkerRequestPayload,
  signal?: AbortSignal
): Promise<{ bodyObj: unknown; url: string; headers: Record<string, string> }> {
  if (signal?.aborted) {
    throw new DOMException("Operation aborted", "AbortError");
  }

  const worker = getPromptAssemblyWorker();
  const requestId = ++promptAssemblyRequestSeq;

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      worker.removeEventListener("message", onMessage as EventListener);
      worker.removeEventListener("error", onError as EventListener);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      fn();
    };

    const onMessage = (event: MessageEvent<PromptAssemblyWorkerResponse>) => {
      const data = event.data;
      if (!data || data.id !== requestId) {
        return;
      }

      if (data.ok) {
        finish(() => {
          resolve(data.payload);
        });
        return;
      }

      finish(() => {
        reject(new Error(data.error || "Prompt assembly worker failed"));
      });
    };

    const onError = (event: ErrorEvent) => {
      finish(() => {
        reject(new Error(event.message || "Prompt assembly worker crashed"));
      });
    };

    const onAbort = () => {
      finish(() => {
        reject(new DOMException("Operation aborted", "AbortError"));
      });
    };

    worker.addEventListener("message", onMessage as EventListener);
    worker.addEventListener("error", onError as EventListener);
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const request: PromptAssemblyWorkerRequest = {
      id: requestId,
      payload,
    };
    worker.postMessage(request);
  });
}

function isAbortRequestError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) {
    return true;
  }

  return error instanceof Error && error.name === "AbortError";
}

function getHeaderValue(headers: unknown, key: string): string | null {
  if (!headers) {
    return null;
  }

  const normalizedKey = key.toLowerCase();

  if (typeof (headers as Headers).get === "function") {
    const value = (headers as Headers).get(normalizedKey);
    return typeof value === "string" ? value : null;
  }

  if (typeof headers === "object") {
    for (const [headerKey, headerValue] of Object.entries(headers)) {
      if (headerKey.toLowerCase() !== normalizedKey) {
        continue;
      }

      if (Array.isArray(headerValue)) {
        const first = headerValue.find((item) => typeof item === "string");
        return typeof first === "string" ? first : null;
      }

      return typeof headerValue === "string" ? headerValue : null;
    }
  }

  return null;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }

  const retryAt = Date.parse(trimmed);
  if (!Number.isNaN(retryAt)) {
    return Math.max(0, retryAt - Date.now());
  }

  return null;
}

function getRetryDelayMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) {
    return Math.min(API_REQUEST_RETRY_MAX_DELAY_MS, Math.max(0, retryAfterMs));
  }

  const backoff = API_REQUEST_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  const jitterAmplitude = Math.round(backoff * 0.3);
  const jitter = Math.round((Math.random() * 2 - 1) * jitterAmplitude);
  return Math.min(
    API_REQUEST_RETRY_MAX_DELAY_MS,
    Math.max(80, Math.round(backoff + jitter))
  );
}

async function waitForRetryDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let timeoutId = 0;

    const settle = () => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener("abort", settle);
      }
      resolve();
    };

    timeoutId = window.setTimeout(settle, ms);

    if (signal) {
      signal.addEventListener("abort", settle);
    }
  });
}

function getCachedCurlJson(curl: string) {
  const cached = curlJsonCache.get(curl);
  if (cached) {
    return cached;
  }

  const parsed = curl2Json(curl);
  curlJsonCache.set(curl, parsed);
  return parsed;
}

function getCachedExtractedVariables(curl: string) {
  const cached = curlVariableCache.get(curl);
  if (cached) {
    return cached;
  }

  const extracted = extractVariables(curl);
  curlVariableCache.set(curl, extracted);
  return extracted;
}

function cloneCurlPayload<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function resolveAIProviderVariables(
  variables: Record<string, string>,
  aiMode: "D" | "P"
): Record<string, string> {
  const resolvedVariables = { ...variables };
  const dumbModel = variables[AI_MODE_VARIABLE_KEYS.DUMB_MODEL]?.trim();
  const proModel = variables[AI_MODE_VARIABLE_KEYS.PRO_MODEL]?.trim();
  const defaultModel = variables.model?.trim();

  const activeModel =
    aiMode === "P"
      ? proModel || dumbModel || defaultModel
      : dumbModel || defaultModel || proModel;

  if (activeModel) {
    resolvedVariables.model = activeModel;
  }

  return resolvedVariables;
}

function buildEnhancedSystemPrompt(baseSystemPrompt?: string): string {
  const responseSettings = getResponseSettings();
  const prompts: string[] = [];

  if (baseSystemPrompt) {
    prompts.push(baseSystemPrompt);
  }

  const lengthOption = RESPONSE_LENGTHS.find(
    (l) => l.id === responseSettings.responseLength
  );
  if (lengthOption?.prompt?.trim()) {
    prompts.push(lengthOption.prompt);
  }

  const languageOption = LANGUAGES.find(
    (l) => l.id === responseSettings.language
  );
  if (languageOption?.prompt?.trim()) {
    prompts.push(languageOption.prompt);
  }

  prompts.push(MARKDOWN_FORMATTING_INSTRUCTIONS);

  return prompts.join(" ");
}

export async function* fetchAIResponse(params: {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  systemPrompt?: string;
  history?: Message[];
  userMessage: string;
  imagesBase64?: string[];
  signal?: AbortSignal;
  aiMode?: "D" | "P";
  onRequestDispatched?: (attempt: number) => void;
}): AsyncIterable<string> {
  try {
    const {
      provider,
      selectedProvider,
      systemPrompt,
      history = [],
      userMessage,
      imagesBase64 = [],
      signal,
      aiMode = DEFAULT_AI_MODE,
      onRequestDispatched,
    } = params;

    if (signal?.aborted) {
      return;
    }

    const enhancedSystemPrompt = buildEnhancedSystemPrompt(systemPrompt);

    if (!provider) {
      throw new Error(`Provider not provided`);
    }
    if (!selectedProvider) {
      throw new Error(`Selected provider not provided`);
    }

    let curlJson;
    try {
      curlJson = getCachedCurlJson(provider.curl);
    } catch (error) {
      throw new Error(
        `Failed to parse curl: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    const resolvedProviderVariables = resolveAIProviderVariables(
      selectedProvider.variables || {},
      aiMode
    );

    const extractedVariables = getCachedExtractedVariables(provider.curl);
    const requiredVars = extractedVariables.filter(
      ({ key }) => key !== "SYSTEM_PROMPT" && key !== "TEXT" && key !== "IMAGE"
    );
    for (const { key } of requiredVars) {
      if (
        !resolvedProviderVariables[key] ||
        resolvedProviderVariables[key].trim() === ""
      ) {
        throw new Error(
          `Missing required variable: ${key}. Please configure it in settings.`
        );
      }
    }

    if (!userMessage) {
      throw new Error("User message is required");
    }
    if (imagesBase64.length > 0 && !provider.curl.includes("{{IMAGE}}")) {
      throw new Error(
        `Provider ${provider?.id ?? "unknown"} does not support image input`
      );
    }

    const allVariables = {
      ...Object.fromEntries(
        Object.entries(resolvedProviderVariables).map(([key, value]) => [
          key.toUpperCase(),
          value,
        ])
      ),
      SYSTEM_PROMPT: enhancedSystemPrompt || "",
    };

    const baseBody = curlJson.data ? cloneCurlPayload(curlJson.data) : {};
    let bodyObj: any;
    let url: string;
    let headers: Record<string, string>;

    if (
      shouldUsePromptAssemblyWorker({
        bodyObj: baseBody,
        history,
        imagesBase64,
      })
    ) {
      try {
        const assembled = await assemblePromptPayloadInWorker(
          {
            bodyObj: baseBody,
            url: curlJson.url || "",
            headers: (curlJson.header || {}) as Record<string, string>,
            history,
            userMessage,
            imagesBase64,
            allVariables,
          },
          signal
        );
        bodyObj = assembled.bodyObj;
        url = assembled.url;
        headers = assembled.headers;
      } catch (workerError) {
        if (isAbortRequestError(workerError, signal)) {
          return;
        }

        bodyObj = baseBody;
        const messagesKey = Object.keys(bodyObj).find((key) =>
          ["messages", "contents", "conversation", "history"].includes(key)
        );

        if (messagesKey && Array.isArray(bodyObj[messagesKey])) {
          const finalMessages = buildDynamicMessages(
            bodyObj[messagesKey],
            history,
            userMessage,
            imagesBase64
          );
          bodyObj[messagesKey] = finalMessages;
        }

        if (hasTemplateVariables(bodyObj)) {
          bodyObj = deepVariableReplacer(bodyObj, allVariables);
        }

        const rawUrl = curlJson.url || "";
        url = hasTemplateVariables(rawUrl)
          ? deepVariableReplacer(rawUrl, allVariables)
          : rawUrl;

        const rawHeaders = (curlJson.header || {}) as Record<string, string>;
        headers = hasTemplateVariables(rawHeaders)
          ? deepVariableReplacer(rawHeaders, allVariables)
          : rawHeaders;
      }
    } else {
      bodyObj = baseBody;
      const messagesKey = Object.keys(bodyObj).find((key) =>
        ["messages", "contents", "conversation", "history"].includes(key)
      );

      if (messagesKey && Array.isArray(bodyObj[messagesKey])) {
        const finalMessages = buildDynamicMessages(
          bodyObj[messagesKey],
          history,
          userMessage,
          imagesBase64
        );
        bodyObj[messagesKey] = finalMessages;
      }

      if (hasTemplateVariables(bodyObj)) {
        bodyObj = deepVariableReplacer(bodyObj, allVariables);
      }

      const rawUrl = curlJson.url || "";
      url = hasTemplateVariables(rawUrl)
        ? deepVariableReplacer(rawUrl, allVariables)
        : rawUrl;

      const rawHeaders = (curlJson.header || {}) as Record<string, string>;
      headers = hasTemplateVariables(rawHeaders)
        ? deepVariableReplacer(rawHeaders, allVariables)
        : rawHeaders;
    }

    headers["Content-Type"] = "application/json";

    if (provider?.streaming) {
      if (typeof bodyObj === "object" && bodyObj !== null) {
        const streamKey = Object.keys(bodyObj).find(
          (k) => k.toLowerCase() === "stream"
        );
        if (streamKey) {
          bodyObj[streamKey] = true;
        } else {
          bodyObj.stream = true;
        }
      }
    }

    const fetchFunction = url?.includes("http") ? fetch : tauriFetch;

    const requestMethod = (curlJson.method || "POST").toUpperCase();
    const requestBody =
      requestMethod === "GET" ? undefined : JSON.stringify(bodyObj);
    let response;

    for (let attempt = 1; attempt <= API_REQUEST_MAX_ATTEMPTS; attempt++) {
      if (signal?.aborted) {
        return;
      }

      try {
        if (onRequestDispatched) {
          try {
            onRequestDispatched(attempt);
          } catch {}
        }

        response = await fetchFunction(url, {
          method: requestMethod,
          headers,
          body: requestBody,
          signal,
        });
      } catch (fetchError) {
        if (isAbortRequestError(fetchError, signal)) {
          return;
        }

        if (attempt >= API_REQUEST_MAX_ATTEMPTS) {
          throw new Error(`Network error during API request: ${
            fetchError instanceof Error ? fetchError.message : "Unknown error"
          }`);
        }

        await waitForRetryDelay(getRetryDelayMs(attempt, null), signal);
        continue;
      }

      if (response.ok) {
        break;
      }

      const statusCode = Number(response.status) || 0;
      const shouldRetryStatus =
        RETRYABLE_API_STATUS_CODES.has(statusCode) &&
        attempt < API_REQUEST_MAX_ATTEMPTS;

      if (shouldRetryStatus) {
        const retryAfterMs = parseRetryAfterMs(
          getHeaderValue(response.headers, "retry-after")
        );
        await waitForRetryDelay(getRetryDelayMs(attempt, retryAfterMs), signal);
        continue;
      }

      let errorText = "";
      try {
        errorText = await response.text();
      } catch {}
      throw new Error(`API request failed: ${response.status} ${response.statusText}${
        errorText ? ` - ${errorText}` : ""
      }`);
    }

    if (!response || !response.ok) {
      throw new Error("API request failed before receiving a successful response.");
    }

    const responseContentPath = provider.responseContentPath || "";

    if (!provider?.streaming) {
      let json;
      try {
        json = await response.json();
      } catch (parseError) {
        throw new Error(`Failed to parse non-streaming response: ${
          parseError instanceof Error ? parseError.message : "Unknown error"
        }`);
      }
      const content = getByPath(json, responseContentPath) || "";
      yield content;
      return;
    }

    if (!response.body) {
      throw new Error("Streaming not supported or response body missing");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const streamingContentPaths = buildStreamingContentPaths(responseContentPath);

    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        return;
      }

      let readResult;
      try {
        readResult = await reader.read();
      } catch (readError) {
        if (
          signal?.aborted ||
          (readError instanceof Error && readError.name === "AbortError")
        ) {
          return;
        }
        throw new Error(`Error reading stream: ${
          readError instanceof Error ? readError.message : "Unknown error"
        }`);
      }
      const { done, value } = readResult;
      if (done) break;

      if (signal?.aborted) {
        reader.cancel();
        return;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const trimmed = line.substring(5).trim();
          if (!trimmed || trimmed === "[DONE]") continue;
          try {
            const parsed = JSON.parse(trimmed);
            const delta = getStreamingContent(
              parsed,
              responseContentPath,
              streamingContentPaths
            );
            if (delta) {
              yield delta;
            }
          } catch (e) {
            // Ignore parsing errors for partial JSON chunks
          }
        }
      }
    }
  } catch (error) {
    throw new Error(
      `Error in fetchAIResponse: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
