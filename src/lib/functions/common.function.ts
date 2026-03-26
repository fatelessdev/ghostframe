import { Message, type AIImagePayload } from "@/types";

const pathSegmentsCache = new Map<string, string[]>();
const jsonStringifyCache = new WeakMap<object, string>();
const templatePresenceCache = new WeakMap<object, boolean>();
const TEMPLATE_VARIABLE_PATTERN = /\{\{[A-Z_]+\}\}/;
const DEFAULT_IMAGE_MIME_TYPE = "image/png";

export type AIImageInput = string | AIImagePayload;

function fastStringify(value: unknown): string {
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }

  const cached = jsonStringifyCache.get(value as object);
  if (cached) {
    return cached;
  }

  const serialized = JSON.stringify(value);
  jsonStringifyCache.set(value as object, serialized);
  return serialized;
}

function getPathSegments(path: string): string[] {
  const cached = pathSegmentsCache.get(path);
  if (cached) {
    return cached;
  }

  const segments = path
    .replace(/\[/g, ".")
    .replace(/\]/g, "")
    .split(".");

  pathSegmentsCache.set(path, segments);
  return segments;
}

const normalizeImagePayload = (image: AIImageInput): AIImagePayload => {
  if (typeof image === "string") {
    return {
      base64: image,
      mimeType: DEFAULT_IMAGE_MIME_TYPE,
    };
  }

  return {
    ...image,
    mimeType: image.mimeType || DEFAULT_IMAGE_MIME_TYPE,
  };
};

export const normalizeAIImagePayloads = (images: AIImageInput[] = []): AIImagePayload[] => {
  return images
    .map(normalizeImagePayload)
    .filter((image) => typeof image.base64 === "string" && image.base64.length > 0);
};

const replaceDataUriMime = (value: string, mimeType: string): string => {
  if (!value.includes("data:image/") || !value.includes(";base64,")) {
    return value;
  }

  return value.replace(/data:image\/[^;]+;base64,/gi, `data:${mimeType};base64,`);
};

const applyImageMime = (node: unknown, mimeType: string): unknown => {
  if (typeof node === "string") {
    return replaceDataUriMime(node, mimeType);
  }

  if (Array.isArray(node)) {
    return node.map((item) => applyImageMime(item, mimeType));
  }

  if (node && typeof node === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (
        (key === "media_type" || key === "mime_type") &&
        typeof value === "string" &&
        value.startsWith("image/")
      ) {
        next[key] = mimeType;
        continue;
      }

      next[key] = applyImageMime(value, mimeType);
    }

    return next;
  }

  return node;
};

export function getByPath(obj: any, path: string): any {
  if (!path) return obj;
  return getPathSegments(path).reduce((o, k) => (o || {})[k], obj);
}

export function setByPath(obj: any, path: string, value: any): void {
  const keys = path.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i].replace(/\[(\d+)\]/g, ".$1");
    if (!current[key]) current[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    current = current[key];
  }
  current[keys[keys.length - 1].replace(/\[(\d+)\]/g, ".$1")] = value;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      const base64data = (reader.result as string)?.split(",")[1] ?? "";
      resolve(base64data);
    };
    reader.onerror = reject;
  });
}

export function extractVariables(
  curl: string,
  includeAll = false
): { key: string; value: string }[] {
  if (typeof curl !== "string") {
    return [];
  }

  const regex = /\{\{([A-Z_]+)\}\}/g;
  const matches = curl?.match(regex) || [];
  const variables = matches
    .map((match) => {
      if (typeof match === "string") {
        return match.slice(2, -2);
      }
      return "";
    })
    .filter((v) => v !== "");

  const uniqueVariables = [...new Set(variables)];

  const doNotInclude = includeAll
    ? []
    : ["SYSTEM_PROMPT", "TEXT", "IMAGE", "AUDIO"];

  const filteredVariables = uniqueVariables?.filter(
    (variable) => !doNotInclude?.includes(variable)
  );

  return filteredVariables.map((variable) => ({
    key: variable?.toLowerCase()?.replace(/_/g, "_") || "",
    value: variable,
  }));
}

/**
 * Recursively processes a user message template to replace placeholders for text and images.
 * @param template The user message template object.
 * @param userMessage The user's text message.
 * @param imagesBase64 An array of base64 encoded images.
 * @returns The processed user message object.
 */
export function processUserMessageTemplate(
  template: any,
  userMessage: string,
  imagesBase64: AIImageInput[] = []
): any {
  const normalizedImages = normalizeAIImagePayloads(imagesBase64);

  if (!fastStringify(template).includes("{{IMAGE}}")) {
    return deepVariableReplacer(template, { TEXT: userMessage });
  }

  const escapeForJson = (value: string) =>
    JSON.stringify(value ?? "").slice(1, -1);

  const templateStr = JSON.stringify(template).replace(
    /\{\{TEXT\}\}/g,
    escapeForJson(userMessage)
  );
  const result = JSON.parse(templateStr);

  const imageReplacer = (node: any): any => {
    if (Array.isArray(node)) {
      const imageTemplateIndex = node.findIndex((item) => {
        return fastStringify(item).includes("{{IMAGE}}");
      });

      if (imageTemplateIndex > -1) {
        const imageTemplate = node[imageTemplateIndex];
        const imageParts =
          normalizedImages.length > 0
            ? normalizedImages.map((image) => {
                const partStr = JSON.stringify(imageTemplate).replace(
                  /\{\{IMAGE\}\}/g,
                  image.base64
                );
                return applyImageMime(JSON.parse(partStr), image.mimeType);
              })
            : [];

        const finalArray = [
          ...node.slice(0, imageTemplateIndex),
          ...imageParts,
          ...node.slice(imageTemplateIndex + 1),
        ];
        return finalArray.map(imageReplacer);
      }
      return node.map(imageReplacer);
    } else if (node && typeof node === "object") {
      const newNode: { [key: string]: any } = {};
      for (const key in node) {
        newNode[key] = imageReplacer(node[key]);
      }
      return newNode;
    }
    return node;
  };

  return imageReplacer(result);
}

export function processUserMessageTemplateFastPath(
  template: any,
  userMessage: string,
  imagesBase64: AIImageInput[] = []
): any {
  const normalizedImages = normalizeAIImagePayloads(imagesBase64);
  const templateString = fastStringify(template);
  const hasText = templateString.includes("{{TEXT}}");
  const hasImage = templateString.includes("{{IMAGE}}");

  if (!hasImage) {
    if (!hasText) {
      return template;
    }

    return deepVariableReplacer(template, { TEXT: userMessage });
  }

  if (!Array.isArray(template)) {
    return processUserMessageTemplate(template, userMessage, imagesBase64);
  }

  const cloned = template.map((item) => deepVariableReplacer(item, { TEXT: userMessage }));
  const imageTemplateIndex = cloned.findIndex((item) => {
    return hasTemplateVariables(item) && fastStringify(item).includes("{{IMAGE}}");
  });

  if (imageTemplateIndex === -1) {
    return cloned;
  }

  const imageTemplate = cloned[imageTemplateIndex];
  const before = cloned.slice(0, imageTemplateIndex);
  const after = cloned.slice(imageTemplateIndex + 1);

  const imageParts = normalizedImages.map((image) => {
    const withData = deepVariableReplacer(imageTemplate, { IMAGE: image.base64 });
    return applyImageMime(withData, image.mimeType);
  });

  return [...before, ...imageParts, ...after];
}

/**
 * Builds a dynamic messages array from a template, incorporating history and the current user message.
 * @param messagesTemplate The message template array from the cURL configuration.
 * @param history An array of previous messages in the conversation.
 * @param userMessage The user's current text message.
 * @param imagesBase64 An array of base64 encoded images for the current message.
 * @returns The fully constructed messages array.
 */
export function buildDynamicMessages(
  messagesTemplate: any[],
  history: Message[],
  userMessage: string,
  imagesBase64: AIImageInput[] = []
): any[] {
  const userMessageTemplateIndex = messagesTemplate.findIndex((m) => {
    return fastStringify(m).includes("{{TEXT}}");
  });

  if (userMessageTemplateIndex === -1) {
    return [...history, { role: "user", content: userMessage }]; // Fallback
  }

  const prefixMessages = messagesTemplate.slice(0, userMessageTemplateIndex);
  const suffixMessages = messagesTemplate.slice(userMessageTemplateIndex + 1);
  const userMessageTemplate = messagesTemplate[userMessageTemplateIndex];

  const newUserMessage = processUserMessageTemplate(
    userMessageTemplate,
    userMessage,
    imagesBase64
  );

  return [...prefixMessages, ...history, newUserMessage, ...suffixMessages];
}

export function buildDynamicMessagesFastPath(
  messagesTemplate: any[],
  history: Message[],
  userMessage: string,
  imagesBase64: AIImageInput[] = []
): any[] {
  const userMessageTemplateIndex = messagesTemplate.findIndex((m) => {
    return fastStringify(m).includes("{{TEXT}}");
  });

  if (userMessageTemplateIndex === -1) {
    return [...history, { role: "user", content: userMessage }];
  }

  const prefixMessages = messagesTemplate.slice(0, userMessageTemplateIndex);
  const suffixMessages = messagesTemplate.slice(userMessageTemplateIndex + 1);
  const userMessageTemplate = messagesTemplate[userMessageTemplateIndex];

  const newUserMessage = processUserMessageTemplateFastPath(
    userMessageTemplate,
    userMessage,
    imagesBase64
  );

  return [...prefixMessages, ...history, newUserMessage, ...suffixMessages];
}

/**
 * Recursively walks through an object and replaces variable placeholders.
 * @param node The object or value to process.
 * @param variables A key-value map of variables to replace.
 * @returns The processed object.
 */
export function deepVariableReplacer(
  node: any,
  variables: Record<string, string>
): any {
  const replacements = Object.entries(variables).map(([key, value]) => {
    return {
      placeholder: `{{${key}}}`,
      value,
    };
  });

  const replaceNode = (current: any): any => {
    if (typeof current === "string") {
      if (!current.includes("{{")) {
        return current;
      }

      let result = current;
      for (const replacement of replacements) {
        if (!result.includes(replacement.placeholder)) {
          continue;
        }

        result = result.split(replacement.placeholder).join(replacement.value);
      }
      return result;
    }

    if (Array.isArray(current)) {
      if (!hasTemplateVariables(current)) {
        return current;
      }

      return current.map((item) => {
        if (!hasTemplateVariables(item)) {
          return item;
        }

        return replaceNode(item);
      });
    }

    if (current && typeof current === "object") {
      if (!hasTemplateVariables(current)) {
        return current;
      }

      const newNode: { [key: string]: any } = {};
      for (const key in current) {
        const value = current[key];
        if (!hasTemplateVariables(value)) {
          newNode[key] = value;
          continue;
        }

        newNode[key] = replaceNode(value);
      }
      return newNode;
    }

    return current;
  };

  return replaceNode(node);
}

export function hasTemplateVariables(node: unknown): boolean {
  if (typeof node === "string") {
    if (!node.includes("{{")) {
      return false;
    }

    return TEMPLATE_VARIABLE_PATTERN.test(node);
  }

  if (Array.isArray(node)) {
    const cached = templatePresenceCache.get(node);
    if (typeof cached === "boolean") {
      return cached;
    }

    for (const value of node) {
      if (hasTemplateVariables(value)) {
        templatePresenceCache.set(node, true);
        return true;
      }
    }

    templatePresenceCache.set(node, false);
    return false;
  }

  if (node && typeof node === "object") {
    const objectNode = node as Record<string, unknown>;
    const cached = templatePresenceCache.get(objectNode);
    if (typeof cached === "boolean") {
      return cached;
    }

    for (const value of Object.values(objectNode)) {
      if (hasTemplateVariables(value)) {
        templatePresenceCache.set(objectNode, true);
        return true;
      }
    }

    templatePresenceCache.set(objectNode, false);
  }

  return false;
}

export function buildStreamingContentPaths(defaultPath: string): string[] {
  const possiblePaths: string[] = [];

  const pushPath = (path: string) => {
    if (!path || possiblePaths.includes(path)) {
      return;
    }

    possiblePaths.push(path);
  };

  pushPath(defaultPath.replace(".message.", ".delta."));
  pushPath("choices[0].delta.content");
  pushPath("candidates[0].content.parts[0].text");
  pushPath("delta.text");
  pushPath("text");
  pushPath(defaultPath);

  return possiblePaths;
}

/**
 * Extracts content from a streaming API response chunk by trying a series of common JSON paths.
 * This makes the system more resilient to variations in streaming formats.
 * @param chunk The parsed JSON object from a stream line.
 * @param defaultPath The default, non-streaming content path for the provider.
 * @returns The extracted text content, or null if not found.
 */
export function getStreamingContent(
  chunk: any,
  defaultPath: string,
  precomputedPaths?: readonly string[]
): string | null {
  const possiblePaths = precomputedPaths ?? buildStreamingContentPaths(defaultPath);

  for (const path of possiblePaths) {
    // Skip empty or null paths
    if (!path) continue;

    const content = getByPath(chunk, path);

    // We only care about non-empty string content.
    // Some paths might resolve to objects (e.g., `choices[0].delta`), so we check the type.
    if (typeof content === "string" && content) {
      return content;
    }
  }

  // Return null if no content is found after trying all paths.
  return null;
}
