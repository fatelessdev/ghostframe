import { STORAGE_KEYS } from "@/config";
import {
  DEFAULT_RESPONSE_LENGTH,
  DEFAULT_LANGUAGE,
  DEFAULT_AUTO_SCROLL,
  DEFAULT_RESPONSE_PANEL_HEIGHT,
  DEFAULT_RESPONSE_PANEL_WIDTH,
  DEFAULT_RESPONSE_TEXT_SIZE,
} from "../response-settings.constants";

export interface ResponseSettings {
  responseLength: string;
  language: string;
  autoScroll: boolean;
  textSize: number;
  panelWidth: number;
  panelHeight: number;
}

export const DEFAULT_RESPONSE_SETTINGS: ResponseSettings = {
  responseLength: DEFAULT_RESPONSE_LENGTH,
  language: DEFAULT_LANGUAGE,
  autoScroll: DEFAULT_AUTO_SCROLL,
  textSize: DEFAULT_RESPONSE_TEXT_SIZE,
  panelWidth: DEFAULT_RESPONSE_PANEL_WIDTH,
  panelHeight: DEFAULT_RESPONSE_PANEL_HEIGHT,
};

const emitResponseSettingsChanged = (settings: ResponseSettings) => {
  window.dispatchEvent(
    new CustomEvent("responseSettingsChanged", {
      detail: settings,
    })
  );
};

/**
 * Get response settings from localStorage
 */
export const getResponseSettings = (): ResponseSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.RESPONSE_SETTINGS);
    if (!stored) {
      return DEFAULT_RESPONSE_SETTINGS;
    }

    const parsedSettings = JSON.parse(stored);

    return {
      responseLength:
        parsedSettings.responseLength ||
        DEFAULT_RESPONSE_SETTINGS.responseLength,
      language: parsedSettings.language || DEFAULT_RESPONSE_SETTINGS.language,
      autoScroll:
        parsedSettings.autoScroll !== undefined
          ? parsedSettings.autoScroll
          : DEFAULT_RESPONSE_SETTINGS.autoScroll,
      textSize:
        typeof parsedSettings.textSize === "number"
          ? parsedSettings.textSize
          : DEFAULT_RESPONSE_SETTINGS.textSize,
      panelWidth:
        typeof parsedSettings.panelWidth === "number"
          ? parsedSettings.panelWidth
          : DEFAULT_RESPONSE_SETTINGS.panelWidth,
      panelHeight:
        typeof parsedSettings.panelHeight === "number"
          ? parsedSettings.panelHeight
          : DEFAULT_RESPONSE_SETTINGS.panelHeight,
    };
  } catch (error) {
    console.error("Failed to get response settings:", error);
    return DEFAULT_RESPONSE_SETTINGS;
  }
};

/**
 * Save response settings to localStorage
 */
export const setResponseSettings = (settings: ResponseSettings): void => {
  try {
    localStorage.setItem(
      STORAGE_KEYS.RESPONSE_SETTINGS,
      JSON.stringify(settings)
    );
    emitResponseSettingsChanged(settings);
  } catch (error) {
    console.error("Failed to save response settings:", error);
  }
};

/**
 * Update response length
 */
export const updateResponseLength = (
  responseLength: string
): ResponseSettings => {
  const currentSettings = getResponseSettings();
  const newSettings = { ...currentSettings, responseLength };
  setResponseSettings(newSettings);
  return newSettings;
};

/**
 * Update language
 */
export const updateLanguage = (language: string): ResponseSettings => {
  const currentSettings = getResponseSettings();
  const newSettings = { ...currentSettings, language };
  setResponseSettings(newSettings);
  return newSettings;
};

/**
 * Update auto-scroll
 */
export const updateAutoScroll = (autoScroll: boolean): ResponseSettings => {
  const currentSettings = getResponseSettings();
  const newSettings = { ...currentSettings, autoScroll };
  setResponseSettings(newSettings);
  return newSettings;
};

/**
 * Update response text size.
 */
export const updateTextSize = (textSize: number): ResponseSettings => {
  const currentSettings = getResponseSettings();
  const newSettings = { ...currentSettings, textSize };
  setResponseSettings(newSettings);
  return newSettings;
};

/**
 * Update remembered response panel size.
 */
export const updateResponsePanelSize = (
  panelWidth: number,
  panelHeight: number
): ResponseSettings => {
  const currentSettings = getResponseSettings();
  const newSettings = {
    ...currentSettings,
    panelWidth,
    panelHeight,
  };
  setResponseSettings(newSettings);
  return newSettings;
};
