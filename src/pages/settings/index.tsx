import { useState, useRef, useEffect } from "react";
import { XIcon } from "lucide-react";
import {
  Theme,
  AlwaysOnTopToggle,
  AppIconToggle,
  AutostartToggle,
  DisguiseMode,
  SystemAudioInterviewSettings,
} from "./components";
import {
  AutoScrollToggle,
  HighContrastToggle,
  LanguageSelector,
  PanelSize,
  ResponseLength,
  TextSize,
} from "@/pages/responses/components";
import { ScreenshotConfigs } from "@/pages/screenshot/components";
import { AIProviders, STTProviders } from "@/pages/dev/components";
import { CursorSelection, ShortcutManager } from "@/pages/shortcuts/components";
import { AudioSelection } from "@/pages/audio/components";
import SystemPrompts from "@/pages/system-prompts";
import { useGlobalShortcuts, useSettings } from "@/hooks";

interface SettingsProps { onClose?: () => void; }

const Settings = ({ onClose }: SettingsProps) => {
  const [activeTab, setActiveTab] = useState<"general" | "responses" | "screenshot" | "ai" | "stt" | "audio" | "prompts" | "shortcuts">("general");
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const { registerResponseScrollUpCallback, registerResponseScrollDownCallback, unregisterResponseScrollUpCallback, unregisterResponseScrollDownCallback } = useGlobalShortcuts();

  useEffect(() => {
    const scrollAmount = 150;
    const scrollUp = () => scrollRef.current?.scrollBy({ top: -scrollAmount, behavior: "smooth" });  
    const scrollDown = () => scrollRef.current?.scrollBy({ top: scrollAmount, behavior: "smooth" }); 
    registerResponseScrollUpCallback(scrollUp);
    registerResponseScrollDownCallback(scrollDown);
    return () => { unregisterResponseScrollUpCallback(); unregisterResponseScrollDownCallback(); };  
  }, [registerResponseScrollUpCallback, registerResponseScrollDownCallback, unregisterResponseScrollUpCallback, unregisterResponseScrollDownCallback]);

  // Touchpad scrolling support
  useEffect(() => {
    const h = (e: WheelEvent) => {
      if (scrollRef.current) {
        scrollRef.current.scrollBy({ top: e.deltaY, left: 0 });
      }
    };
    window.addEventListener("wheel", h, { passive: true });
    return () => window.removeEventListener("wheel", h);
  }, []);

  const settings = useSettings();
  const getTabClasses = (tab: string) => "w-full text-left px-3 py-2 text-sm font-medium rounded-lg transition-all " + (activeTab === tab ? "bg-white/10 text-white shadow-sm" : "text-white/50 hover:text-white hover:bg-white/5");

  return (
    <div className="flex flex-row w-full h-full bg-black/60 text-white rounded-2xl overflow-hidden relative pointer-events-auto border border-white/10 shadow-2xl backdrop-blur-md">
      {/* Sidebar Navigation */}
      <div className="flex flex-col w-56 flex-shrink-0 border-r border-white/10 bg-black/20">
        <div className="flex items-center justify-between p-4 border-b border-white/10">    
          <h2 className="text-sm font-bold tracking-wide">Settings</h2>
          {onClose && (
            <button onClick={onClose} className="p-1 rounded-full text-white/50 hover:bg-white/10 hover:text-white transition-colors">
              <XIcon className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          <button className={getTabClasses("general")} onClick={() => setActiveTab("general")}>General</button>
          <button className={getTabClasses("responses")} onClick={() => setActiveTab("responses")}>Responses</button>
          <button className={getTabClasses("screenshot")} onClick={() => setActiveTab("screenshot")}>Screenshot</button>
          <button className={getTabClasses("ai")} onClick={() => setActiveTab("ai")}>AI Providers</button>     
          <button className={getTabClasses("stt")} onClick={() => setActiveTab("stt")}>Speech to Text</button>  
          <button className={getTabClasses("audio")} onClick={() => setActiveTab("audio")}>Audio Devices</button>
          <button className={getTabClasses("prompts")} onClick={() => setActiveTab("prompts")}>System Prompts</button>
          <button className={getTabClasses("shortcuts")} onClick={() => setActiveTab("shortcuts")}>Shortcuts</button>
        </div>
      </div>

      {/* Main Content Pane */}
      <div ref={scrollRef} className="flex-1 overflow-auto p-6 md:p-8 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent bg-black/30 [&_header]:hidden [&_.min-h-screen]:min-h-0 [&_.h-\[calc\(100vh-5rem\)\]]:!h-auto [&_.pr-6]:!pr-0 [&_.pt-4]:!pt-0 [&_.pb-12]:!pb-0">
        <div className="max-w-2xl mx-auto flex flex-col gap-8 pb-16">
          {activeTab === "general" && (
            <div className="flex flex-col gap-6">
              <Theme />
              <AutostartToggle />
              <AppIconToggle />
              <AlwaysOnTopToggle />
              <DisguiseMode />
              <SystemAudioInterviewSettings />
            </div>
          )}
          {activeTab === "responses" && (
            <div className="flex flex-col gap-8">
              <PanelSize />
              <TextSize />
              <HighContrastToggle />
              <ResponseLength />
              <LanguageSelector />
              <AutoScrollToggle />
            </div>
          )}
          {activeTab === "screenshot" && <ScreenshotConfigs {...settings} />}
          {activeTab === "ai" && <AIProviders {...settings} />}
          {activeTab === "stt" && <STTProviders {...settings} />}
          {activeTab === "audio" && <AudioSelection />}
          {activeTab === "prompts" && <div className="-mt-6"><SystemPrompts /></div>}
          {activeTab === "shortcuts" && (
            <div className="flex flex-col gap-8 -mt-6">
              <CursorSelection />
              <ShortcutManager />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default Settings;
