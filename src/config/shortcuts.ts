import { ShortcutAction } from "@/types";

export const DEFAULT_SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    id: "emergency_erase",
    name: "Quick Exit",
    description: "Close the app immediately without clearing saved data",
    defaultKey: {
      macos: "cmd+shift+e",
      windows: "ctrl+shift+e",
      linux: "ctrl+shift+e",
    },
  },
  {
    id: "toggle_dashboard",
    name: "Toggle Dashboard",
    description: "Open/Close the dashboard window",
    defaultKey: {
      macos: "cmd+shift+d",
      windows: "ctrl+shift+d",
      linux: "ctrl+shift+d",
    },
  },
  {
    id: "toggle_window",
    name: "Toggle Window",
    description: "Show/Hide the main window",
    defaultKey: {
      macos: "cmd+backslash",
      windows: "ctrl+backslash",
      linux: "ctrl+backslash",
    },
  },
  {
    id: "focus_input",
    name: "Refocus Input Box",
    description: "Bring app forward and place the cursor in the input area",
    defaultKey: {
      macos: "cmd+shift+i",
      windows: "ctrl+shift+i",
      linux: "ctrl+shift+i",
    },
  },
  {
    id: "move_window",
    name: "Move Window",
    description: "Move overlay with arrow keys (hold to move continuously)",
    defaultKey: {
      macos: "cmd",
      windows: "ctrl",
      linux: "ctrl",
    },
  },
  {
    id: "toggle_model_mode",
    name: "Toggle Model Mode",
    description: "Switch between Dumb and Pro models",
    defaultKey: {
      macos: "cmd+m",
      windows: "ctrl+m",
      linux: "ctrl+m",
    },
  },
  {
    id: "toggle_verbosity_mode",
    name: "Toggle Verbosity Mode",
    description: "Cycle response verbosity between short, verbose, and auto",
    defaultKey: {
      macos: "cmd+shift+s",
      windows: "ctrl+shift+s",
      linux: "ctrl+shift+s",
    },
  },
  {
    id: "system_audio",
    name: "System Audio",
    description: "Toggle system audio capture",
    defaultKey: {
      macos: "cmd+shift+m",
      windows: "ctrl+shift+m",
      linux: "ctrl+shift+m",
    },
  },
  {
    id: "answer_trigger",
    name: "Send Interview Context",
    description:
      "In System Audio mode, send current transcript and screenshots to AI",
    defaultKey: {
      macos: "cmd+enter",
      windows: "ctrl+enter",
      linux: "ctrl+enter",
    },
  },
  {
    id: "view_response",
    name: "Show Response View",
    description: "Switch interview shell to the response view",
    defaultKey: {
      macos: "alt+1",
      windows: "alt+1",
      linux: "alt+1",
    },
  },
  {
    id: "view_transcripts",
    name: "Show Transcripts View",
    description: "Switch interview shell to the transcripts view",
    defaultKey: {
      macos: "alt+2",
      windows: "alt+2",
      linux: "alt+2",
    },
  },
  {
    id: "view_settings",
    name: "Show Settings View",
    description: "Switch interview shell to the settings view",
    defaultKey: {
      macos: "alt+3",
      windows: "alt+3",
      linux: "alt+3",
    },
  },
  {
    id: "clear_active_panel",
    name: "Clear Active Panel",
    description: "Clear response or transcript data in the active view",
    defaultKey: {
      macos: "cmd+g",
      windows: "ctrl+g",
      linux: "ctrl+g",
    },
  },
  {
    id: "scroll_response_up",
    name: "Scroll Response Up",
    description: "Scroll the response view up",
    defaultKey: {
      macos: "cmd+shift+up",
      windows: "ctrl+shift+up",
      linux: "ctrl+shift+up",
    },
  },
  {
    id: "scroll_response_down",
    name: "Scroll Response Down",
    description: "Scroll the response view down",
    defaultKey: {
      macos: "cmd+shift+down",
      windows: "ctrl+shift+down",
      linux: "ctrl+shift+down",
    },
  },
  {
    id: "audio_recording",
    name: "Voice Input",
    description: "Start voice recording",
    defaultKey: {
      macos: "cmd+shift+a",
      windows: "ctrl+shift+a",
      linux: "ctrl+shift+a",
    },
  },
  {
    id: "screenshot",
    name: "Screenshot",
    description: "Capture screenshot",
    defaultKey: {
      macos: "cmd+h",
      windows: "ctrl+h",
      linux: "ctrl+h",
    },
  },
  {
    id: "toggle_compact_mode",
    name: "Toggle Compact Mode",
    description: "Toggle compact overlay density for less occlusion",
    defaultKey: {
      macos: "cmd+shift+c",
      windows: "ctrl+shift+c",
      linux: "ctrl+shift+c",
    },
  },
  {
    id: "prev_response",
    name: "Previous Response",
    description: "Navigate to previous AI response in history",
    defaultKey: {
      macos: "cmd+[",
      windows: "ctrl+[",
      linux: "ctrl+[",
    },
  },
  {
    id: "next_response",
    name: "Next Response",
    description: "Navigate to next AI response in history",
    defaultKey: {
      macos: "cmd+]",
      windows: "ctrl+]",
      linux: "ctrl+]",
    },
  },
  {
    id: "toggle_split_layout",
    name: "Toggle Split Layout",
    description: "Toggle split layout for code responses",
    defaultKey: {
      macos: "cmd+\\",
      windows: "ctrl+shift+\\",
      linux: "ctrl+shift+\\",
    },
  },
];
