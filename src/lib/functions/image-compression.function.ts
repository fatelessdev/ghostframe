import imageCompression from "browser-image-compression";
import type { AIImagePayload } from "@/types";

const dataUrlToBlob = (dataUrl: string): Blob => {
  const [header, content] = dataUrl.split(",");
  const mimeMatch = header.match(/data:([^;]+);base64/);
  const mimeType = mimeMatch?.[1] || "image/png";
  const binary = atob(content || "");
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
};

const blobToDataUrl = async (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve((reader.result as string) || "");
    };
    reader.onerror = () => {
      reject(new Error("Failed to convert compressed image blob to data URL"));
    };
    reader.readAsDataURL(blob);
  });
};

const estimateBase64Bytes = (base64: string): number => {
  if (!base64) {
    return 0;
  }

  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
};

const blobToPayload = async (blob: Blob): Promise<AIImagePayload> => {
  const dataUrl = await blobToDataUrl(blob);
  const base64 = dataUrl.split(",")[1] || "";

  const dimensions = await new Promise<{ width: number; height: number }>(
    (resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        reject(new Error("Failed to read compressed image dimensions"));
      };
      img.src = dataUrl;
    }
  );

  return {
    base64,
    mimeType: blob.type || "image/jpeg",
    width: dimensions.width,
    height: dimensions.height,
    bytes: blob.size,
  };
};

export const compressImagePayloadInWorker = async (
  image: AIImagePayload,
  options?: {
    maxSizeMB?: number;
    maxWidthOrHeight?: number;
    initialQuality?: number;
    outputMimeType?: string;
    minReductionRatio?: number;
  }
): Promise<AIImagePayload> => {
  const maxSizeMB = options?.maxSizeMB ?? 0.32;
  const maxWidthOrHeight = options?.maxWidthOrHeight ?? 1600;
  const initialQuality = options?.initialQuality ?? 0.82;
  const outputMimeType = options?.outputMimeType ?? "image/jpeg";
  const minReductionRatio = Math.max(0, options?.minReductionRatio ?? 0);

  const sourceMime = image.mimeType || "image/png";
  const sourceDataUrl = `data:${sourceMime};base64,${image.base64}`;
  const sourceBlob = dataUrlToBlob(sourceDataUrl);
  const sourceBytes =
    image.bytes ?? sourceBlob.size ?? estimateBase64Bytes(image.base64);
  const sourceMaxDimension = Math.max(image.width ?? 0, image.height ?? 0);

  if (
    sourceBytes <= maxSizeMB * 1024 * 1024 &&
    (sourceMaxDimension === 0 || sourceMaxDimension <= maxWidthOrHeight)
  ) {
    return image;
  }

  const sourceFile = new File([sourceBlob], `screenshot.${sourceMime.includes("jpeg") ? "jpg" : "png"}`,
    {
      type: sourceMime,
      lastModified: Date.now(),
    }
  );

  const compressedBlob = await imageCompression(sourceFile, {
    maxSizeMB,
    maxWidthOrHeight,
    useWebWorker: true,
    initialQuality,
    fileType: outputMimeType,
    alwaysKeepResolution: false,
  });

  const compressedPayload = await blobToPayload(compressedBlob);
  if (!compressedPayload.base64) {
    return image;
  }

  if (compressedPayload.base64.length >= image.base64.length) {
    return image;
  }

  const compressedBytes = compressedPayload.bytes ?? estimateBase64Bytes(compressedPayload.base64);
  if (sourceBytes > 0 && minReductionRatio > 0) {
    const reductionRatio = (sourceBytes - compressedBytes) / sourceBytes;
    if (reductionRatio < minReductionRatio) {
      return image;
    }
  }

  return compressedPayload;
};
