import { useState, useRef, useEffect } from "react";
import {
  XIcon,
  PowerIcon,
  MessagesSquareIcon,
  MessageCircleIcon,
  Search,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
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
import {
  useGlobalShortcuts,
  useSettings,
  useHistory,
} from "@/hooks";
import { Badge, Input, Card, Empty, Button, Header } from "@/components";
import moment from "moment";
import { getPlatform } from "@/lib";

interface SettingsProps {
  onClose?: () => void;
}

type SettingsTab =
  | "history"
  | "general"
  | "responses"
  | "screenshot"
  | "ai"
  | "stt"
  | "audio"
  | "prompts"
  | "shortcuts";

const getOsInstructions = () => {
  const platform = getPlatform();
  switch (platform) {
    case "macos":
      return {
        mic: "System Preferences → Sound → Input",
        audio: "System Preferences → Sound → Output",
      };
    case "windows":
      return {
        mic: "Settings → System → Sound → Input",
        audio: "Settings → System → Sound → Output",
      };
    case "linux":
      return {
        mic: "Sound Settings → Input Devices",
        audio: "Sound Settings → Output Devices",
      };
    default:
      return {
        mic: "your system's sound settings",
        audio: "your system's sound settings",
      };
  }
};

const Settings = ({ onClose }: SettingsProps) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const scrollRef = useRef<HTMLDivElement>(null);
  const osInstructions = getOsInstructions();

  const {
    registerResponseScrollUpCallback,
    registerResponseScrollDownCallback,
    unregisterResponseScrollUpCallback,
    unregisterResponseScrollDownCallback,
  } = useGlobalShortcuts();

  const conversations = useHistory();
  const settings = useSettings();

  // Group conversations by date for history tab
  const groupedConversations = conversations.conversations.reduce(
    (acc, doc) => {
      const dateKey = moment(doc.updatedAt).format("YYYY-MM-DD");
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(doc);
      return acc;
    },
    {} as Record<string, typeof conversations.conversations>
  );

  const sortedDates = Object.keys(groupedConversations).sort((a, b) =>
    moment(b).diff(moment(a))
  );

  useEffect(() => {
    const scrollAmount = 150;
    const scrollUp = () =>
      scrollRef.current?.scrollBy({ top: -scrollAmount, behavior: "smooth" });
    const scrollDown = () =>
      scrollRef.current?.scrollBy({ top: scrollAmount, behavior: "smooth" });
    registerResponseScrollUpCallback(scrollUp);
    registerResponseScrollDownCallback(scrollDown);
    return () => {
      unregisterResponseScrollUpCallback();
      unregisterResponseScrollDownCallback();
    };
  }, [
    registerResponseScrollUpCallback,
    registerResponseScrollDownCallback,
    unregisterResponseScrollUpCallback,
    unregisterResponseScrollDownCallback,
  ]);

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

  const getTabClasses = (tab: string) =>
    "w-full text-left px-3 py-2 text-sm font-medium rounded-lg transition-all " +
    (activeTab === tab
      ? "bg-white/10 text-white shadow-sm"
      : "text-white/50 hover:text-white hover:bg-white/5");

  const handleOpenChat = (conversationId: string) => {
    invoke("open_dashboard", { path: `/chats/view/${conversationId}` });
  };

  return (
    <div className="flex flex-row w-full h-full bg-black/60 text-white rounded-2xl overflow-hidden relative pointer-events-auto border border-white/10 shadow-2xl backdrop-blur-md">
      {/* Sidebar Navigation */}
      <div className="flex flex-col w-56 flex-shrink-0 border-r border-white/10 bg-black/20">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-sm font-bold tracking-wide">Settings</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-full text-white/50 hover:bg-white/10 hover:text-white transition-colors"
            >
              <XIcon className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          <button
            className={getTabClasses("history")}
            onClick={() => setActiveTab("history")}
          >
            <span className="flex items-center gap-2">
              <MessagesSquareIcon className="w-4 h-4" />
              History
            </span>
          </button>
          <div className="h-px bg-white/10 my-2" />
          <button
            className={getTabClasses("general")}
            onClick={() => setActiveTab("general")}
          >
            General
          </button>
          <button
            className={getTabClasses("responses")}
            onClick={() => setActiveTab("responses")}
          >
            Responses
          </button>
          <button
            className={getTabClasses("screenshot")}
            onClick={() => setActiveTab("screenshot")}
          >
            Screenshot
          </button>
          <button
            className={getTabClasses("ai")}
            onClick={() => setActiveTab("ai")}
          >
            AI Providers
          </button>
          <button
            className={getTabClasses("stt")}
            onClick={() => setActiveTab("stt")}
          >
            Speech to Text
          </button>
          <button
            className={getTabClasses("audio")}
            onClick={() => setActiveTab("audio")}
          >
            Audio Devices
          </button>
          <button
            className={getTabClasses("prompts")}
            onClick={() => setActiveTab("prompts")}
          >
            System Prompts
          </button>
          <button
            className={getTabClasses("shortcuts")}
            onClick={() => setActiveTab("shortcuts")}
          >
            Shortcuts
          </button>
        </div>
        <div className="p-3 border-t border-white/10">
          <button
            onClick={() => invoke("exit_app")}
            className="w-full text-left px-3 py-2 text-sm font-medium rounded-lg transition-all text-red-400 hover:text-red-300 hover:bg-red-500/10 flex items-center gap-2"
          >
            <PowerIcon className="w-4 h-4" />
            Quit Application
          </button>
        </div>
      </div>

      {/* Main Content Pane */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto p-6 md:p-8 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent bg-black/30 [&_header]:hidden [&_.min-h-screen]:min-h-0 [&_.h-\[calc\(100vh-5rem\)\]]:!h-auto [&_.pr-6]:!pr-0 [&_.pt-4]:!pt-0 [&_.pb-12]:!pb-0"
      >
        <div className="max-w-2xl mx-auto flex flex-col gap-8 pb-16">
          {/* History Tab */}
          {activeTab === "history" && (
            <div className="flex flex-col gap-6">
              <Header
                title="Conversation History"
                description="View and manage your past conversations"
                isMainTitle
              />

              {conversations.conversations.length === 0 ? (
                <Empty
                  isLoading={conversations.isLoading}
                  icon={MessageCircleIcon}
                  title="No conversations found"
                  description="Start a new conversation to get started"
                />
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="relative w-full">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Search conversations..."
                      className="pl-9 focus-visible:ring-0 focus-visible:ring-offset-0 bg-white/5 border-white/10"
                      value={conversations.search}
                      onChange={(e) => conversations.setSearch(e.target.value)}
                    />
                  </div>

                  {/* Delete All Chats */}
                  <DeleteChatsInline
                    handleDeleteAllChatsConfirm={
                      settings.handleDeleteAllChatsConfirm
                    }
                    showDeleteConfirmDialog={settings.showDeleteConfirmDialog}
                    setShowDeleteConfirmDialog={
                      settings.setShowDeleteConfirmDialog
                    }
                  />

                  {sortedDates
                    .filter((dateKey) =>
                      conversations?.search?.length === 0
                        ? true
                        : groupedConversations?.[dateKey]?.some((doc) =>
                            doc?.title
                              .toLowerCase()
                              .includes(
                                conversations?.search?.toLowerCase() || ""
                              )
                          )
                    )
                    .map((dateKey) => (
                      <div key={dateKey} className="flex flex-col gap-2">
                        <p className="text-xs text-white/50 select-none font-medium">
                          {moment(dateKey).format("ddd, MMM D")}
                        </p>
                        <div className="grid grid-cols-1 gap-2">
                          {groupedConversations[dateKey]
                            .filter(
                              (doc) =>
                                conversations?.search?.length === 0 ||
                                doc?.title
                                  .toLowerCase()
                                  .includes(
                                    conversations?.search?.toLowerCase() || ""
                                  )
                            )
                            .map((doc) => (
                              <Card
                                key={doc.id}
                                className="shadow-none select-none p-3 gap-0 group relative transition-all !bg-white/5 hover:!bg-white/10 !border-white/10 hover:!border-white/20 cursor-pointer"
                                onClick={() => handleOpenChat(doc.id)}
                              >
                                <div className="flex items-center justify-between">
                                  <p className="line-clamp-1 text-sm text-white/90 mr-4">
                                    {doc.title}
                                  </p>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] border-white/20 text-white/60"
                                    >
                                      {doc.messages.length} msgs
                                    </Badge>
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] border-white/20 text-white/60"
                                    >
                                      {moment(doc.updatedAt).format("hh:mm A")}
                                    </Badge>
                                  </div>
                                </div>
                              </Card>
                            ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* General Tab */}
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

          {/* Responses Tab */}
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

          {/* Screenshot Tab */}
          {activeTab === "screenshot" && <ScreenshotConfigs {...settings} />}

          {/* AI Providers Tab */}
          {activeTab === "ai" && <AIProviders {...settings} />}

          {/* Speech to Text Tab */}
          {activeTab === "stt" && <STTProviders {...settings} />}

          {/* Audio Devices Tab */}
          {activeTab === "audio" && (
            <div className="flex flex-col gap-6">
              <AudioSelection />
              <div className="text-xs text-amber-400 bg-amber-500/10 p-3 rounded-md space-y-2 border border-amber-500/20">
                <p>
                  <strong>⚠️ If selected devices don't work:</strong> Please
                  verify your default system audio settings. Go to{" "}
                  <strong>{osInstructions.mic}</strong> for microphone and{" "}
                  <strong>{osInstructions.audio}</strong> for speakers/headphones.
                  Ensure the correct devices are set as default in your operating
                  system.
                </p>
                <p className="text-amber-400/80">
                  <strong>Note:</strong> If the selected device fails or is
                  unavailable, the app will automatically fall back to your
                  system's default audio devices.
                </p>
              </div>
            </div>
          )}

          {/* System Prompts Tab */}
          {activeTab === "prompts" && (
            <div className="-mt-6">
              <SystemPrompts />
            </div>
          )}

          {/* Shortcuts Tab */}
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

// Inline delete chats component for the history tab
interface DeleteChatsInlineProps {
  handleDeleteAllChatsConfirm: () => Promise<void>;
  showDeleteConfirmDialog: boolean;
  setShowDeleteConfirmDialog: React.Dispatch<React.SetStateAction<boolean>>;
}

const DeleteChatsInline = ({
  handleDeleteAllChatsConfirm,
  showDeleteConfirmDialog,
  setShowDeleteConfirmDialog,
}: DeleteChatsInlineProps) => {
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteAllChats = async () => {
    setIsDeleting(true);
    await handleDeleteAllChatsConfirm();
    setTimeout(() => {
      setIsDeleting(false);
    }, 2000);
  };

  return (
    <div className="space-y-2">
      {isDeleting && (
        <div className="p-2 bg-green-500/10 border border-green-500/20 rounded-md">
          <p className="text-xs text-green-400 font-medium">
            ✅ All chat history has been successfully deleted.
          </p>
        </div>
      )}

      <Button
        onClick={() => setShowDeleteConfirmDialog(true)}
        disabled={isDeleting}
        variant="destructive"
        size="sm"
        className="w-full"
        title="Delete all chat history"
      >
        {isDeleting ? "Deleting..." : "Delete All Chat History"}
      </Button>

      {showDeleteConfirmDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-white/10 rounded-lg p-6 max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-2 text-white">
              Delete All Chat History
            </h3>
            <p className="text-sm text-white/60 mb-4">
              Are you sure you want to delete all chat history? This action
              cannot be undone and will permanently remove all stored
              conversations.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteConfirmDialog(false)}
              >
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={deleteAllChats}>
                Delete All
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
