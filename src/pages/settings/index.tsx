import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  XIcon,
  PowerIcon,
  MessagesSquareIcon,
  MessageCircleIcon,
  Search,
  ArrowLeftIcon,
  Download,
  Trash2,
  SparklesIcon,
  UserIcon,
  SendIcon,
  Check,
  Loader2,
  MessageCircleReplyIcon,
} from "lucide-react";
import {
  Theme,
  AlwaysOnTopToggle,
  AppIconToggle,
  AutostartToggle,
  ContentProtectionToggle,
  DisguiseMode,
  ModelModeToggle,
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
  useChatCompletion,
} from "@/hooks";
import {
  Badge,
  Input,
  Card,
  Empty,
  Button,
  Header,
  Markdown,
  Textarea,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components";
import {
  ChatAudio,
  ChatScreenshot,
  ChatFiles,
  AudioRecorder,
} from "@/pages/chats/components";
import { getPlatform, getConversationById, getResponseSettings, toDateKey, formatDisplayDate, formatDisplayTime } from "@/lib";
import { ChatConversation } from "@/types";
import { useApp } from "@/contexts";

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
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
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

  useEffect(() => {
    document.documentElement.classList.remove("click-through-active");
    return () => {
      document.documentElement.classList.add("click-through-active");
    };
  }, []);

  // Group conversations by date for history tab
  const groupedConversations = conversations.conversations.reduce(
    (acc, doc) => {
      const dateKey = toDateKey(doc.updatedAt);
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(doc);
      return acc;
    },
    {} as Record<string, typeof conversations.conversations>
  );

  const sortedDates = Object.keys(groupedConversations).sort((a, b) =>
    a > b ? -1 : a < b ? 1 : 0
  );

  // Track last scroll time for smooth behavior when holding keys
  const lastScrollTimeRef = useRef<number>(0);

  useEffect(() => {
    const scrollAmount = 120; // Smaller step for smoother feel
    const scrollUp = () => {
      const now = Date.now();
      const timeSinceLastScroll = now - lastScrollTimeRef.current;
      const behavior = timeSinceLastScroll < 200 ? "instant" : "smooth";
      lastScrollTimeRef.current = now;
      scrollRef.current?.scrollBy({ top: -scrollAmount, behavior: behavior as ScrollBehavior });
    };
    const scrollDown = () => {
      const now = Date.now();
      const timeSinceLastScroll = now - lastScrollTimeRef.current;
      const behavior = timeSinceLastScroll < 200 ? "instant" : "smooth";
      lastScrollTimeRef.current = now;
      scrollRef.current?.scrollBy({ top: scrollAmount, behavior: behavior as ScrollBehavior });
    };
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

  // Reset conversation view when changing tabs
  useEffect(() => {
    if (activeTab !== "history") {
      setSelectedConversationId(null);
    }
  }, [activeTab]);

  const getTabClasses = (tab: string) =>
    "w-full text-left px-3 py-2 text-sm font-medium rounded-lg transition-all " +
    (activeTab === tab
      ? "bg-accent text-accent-foreground shadow-sm"
      : "text-muted-foreground hover:text-foreground hover:bg-accent/50");

  const handleOpenChat = (conversationId: string) => {
    setSelectedConversationId(conversationId);
  };

  const handleBackToList = () => {
    setSelectedConversationId(null);
  };

  return (
    <div className="flex flex-row w-full h-full bg-card text-card-foreground rounded-2xl overflow-hidden relative pointer-events-auto border border-border shadow-2xl" data-clickable-rect="true">
      {/* Sidebar Navigation */}
      <div className="flex flex-col w-56 flex-shrink-0 border-r border-border bg-muted/30">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-sm font-bold tracking-wide">Settings</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="Close settings"
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
          <div className="h-px bg-border my-2" />
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
        <div className="p-3 border-t border-border">
          <button
            onClick={() => invoke("exit_app")}
            className="w-full text-left px-3 py-2 text-sm font-medium rounded-lg transition-all text-destructive hover:text-destructive hover:bg-destructive/10 flex items-center gap-2"
          >
            <PowerIcon className="w-4 h-4" />
            Quit Application
          </button>
        </div>
      </div>

      {/* Main Content Pane */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto p-6 md:p-8 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent bg-background/50 [&_header]:hidden [&_.min-h-screen]:min-h-0 [&_.h-\[calc\(100vh-5rem\)\]]:!h-auto [&_.pr-6]:!pr-0 [&_.pt-4]:!pt-0 [&_.pb-12]:!pb-0"
      >
        <div className="max-w-2xl mx-auto flex flex-col gap-8 pb-16">
          {/* History Tab */}
          {activeTab === "history" && !selectedConversationId && (
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
                      className="pl-9 focus-visible:ring-0 focus-visible:ring-offset-0 bg-muted/50 border-border"
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
                        <p className="text-xs text-muted-foreground select-none font-medium">
                          {formatDisplayDate(dateKey)}
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
                                data-clickable-rect="true"
                                role="button"
                                tabIndex={0}
                                className="shadow-none select-none p-3 gap-0 group relative transition-all !bg-muted/50 hover:!bg-muted !border-border hover:!border-border/80 cursor-pointer"
                                onClick={() => handleOpenChat(doc.id)}
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                  ) {
                                    event.preventDefault();
                                    handleOpenChat(doc.id);
                                  }
                                }}
                              >
                                <div className="flex items-center justify-between">
                                  <p className="line-clamp-1 text-sm text-foreground mr-4">
                                    {doc.title}
                                  </p>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] border-border text-muted-foreground"
                                    >
                                      {doc.messages.length} msgs
                                    </Badge>
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] border-border text-muted-foreground"
                                    >
                                      {formatDisplayTime(doc.updatedAt)}
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

          {/* Conversation View */}
          {activeTab === "history" && selectedConversationId && (
            <ConversationView
              conversationId={selectedConversationId}
              onBack={handleBackToList}
              onDeleted={handleBackToList}
            />
          )}

          {/* General Tab */}
          {activeTab === "general" && (
            <div className="flex flex-col gap-6">
              <Theme />
              <ContentProtectionToggle />
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
          {activeTab === "ai" && (
            <div className="flex flex-col gap-6">
              <ModelModeToggle />
              <AIProviders {...settings} />
            </div>
          )}

          {/* Speech to Text Tab */}
          {activeTab === "stt" && <STTProviders {...settings} />}

          {/* Audio Devices Tab */}
          {activeTab === "audio" && (
            <div className="flex flex-col gap-6">
              <AudioSelection />
              <div className="text-xs text-blue-400 bg-blue-500/10 p-3 rounded-md space-y-2 border border-blue-400/20">
                <p>
                  <strong>⚠️ If selected devices don't work:</strong> Please
                  verify your default system audio settings. Go to{" "}
                  <strong>{osInstructions.mic}</strong> for microphone and{" "}
                  <strong>{osInstructions.audio}</strong> for speakers/headphones.
                  Ensure the correct devices are set as default in your operating
                  system.
                </p>
                <p className="text-blue-400/80">
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

// Conversation View Component - Full chat view with all features
interface ConversationViewProps {
  conversationId: string;
  onBack: () => void;
  onDeleted: () => void;
}

const ConversationView = ({
  conversationId,
  onBack,
  onDeleted,
}: ConversationViewProps) => {
  const { supportsImages } = useApp();
  const [messages, setMessages] = useState<ChatConversation | null>(null);
  const [textSize, setTextSize] = useState(14);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const {
    handleDeleteConfirm,
    confirmDelete,
    cancelDelete,
    deleteConfirm,
    handleAttachToOverlay,
    handleDownload,
    isDownloaded,
    isAttached,
  } = useHistory();

  const completion = useChatCompletion(conversationId, messages, setMessages);

  useEffect(() => {
    setTextSize(getResponseSettings().textSize);

    const handleSettingsChange = () => {
      setTextSize(getResponseSettings().textSize);
    };

    window.addEventListener("responseSettingsChanged", handleSettingsChange);
    return () => {
      window.removeEventListener("responseSettingsChanged", handleSettingsChange);
    };
  }, []);

  useEffect(() => {
    const getMessages = async () => {
      const conversation = await getConversationById(conversationId);
      setMessages(conversation || null);
    };
    getMessages();
  }, [conversationId]);

  useEffect(() => {
    if (messages?.messages.length) {
      setTimeout(() => {
        completion.messagesEndRef.current?.scrollIntoView({
          behavior: "smooth",
        });
      }, 100);
    }
  }, [messages?.messages.length]);

  const handleDelete = async () => {
    await confirmDelete();
    setDeleteConfirmOpen(false);
    onDeleted();
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent"
          aria-label="Go back"
        >
          <ArrowLeftIcon className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">
            {messages?.title || "Loading..."}
          </h3>
          <p className="text-xs text-muted-foreground">
            {messages?.messages.length || 0} messages
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleAttachToOverlay(conversationId)}
            disabled={isAttached}
            className="h-7 text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
            title="Open in Overlay"
            aria-label="Open in Overlay"
          >
            {isAttached ? (
              <Check className="w-3 h-3 text-green-500" />
            ) : (
              <MessageCircleReplyIcon className="w-3 h-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => handleDownload(messages, e)}
            disabled={isDownloaded}
            className="h-7 text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
            title="Download"
            aria-label="Download"
          >
            {isDownloaded ? (
              <Check className="w-3 h-3 text-green-500" />
            ) : (
              <Download className="w-3 h-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              handleDeleteConfirm(conversationId);
              setDeleteConfirmOpen(true);
            }}
            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            title="Delete"
            aria-label="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      {messages?.messages.length === 0 ? (
        <Empty
          isLoading={false}
          icon={MessageCircleIcon}
          title="No messages found"
          description="Start a new message to get started"
        />
      ) : (
        <div className="flex flex-col gap-4 pb-32">
          {messages?.messages.slice().map((message, index, array) => {
            const isUser = message.role === "user";
            const showDate =
              index === 0 ||
              toDateKey(message.timestamp) !==
                toDateKey(array[index - 1]?.timestamp);

            return (
              <div key={message.id}>
                {showDate && (
                  <Badge
                    variant="outline"
                    className="flex items-center justify-center my-4 w-fit mx-auto border-border text-muted-foreground"
                  >
                    {formatDisplayDate(message.timestamp)}
                  </Badge>
                )}

                <div
                  className={`flex gap-3 ${
                    isUser ? "justify-end" : "justify-start"
                  }`}
                >
                  {!isUser && (
                    <div className="flex-shrink-0">
                      <div className="size-7 rounded-full bg-primary/20 flex items-center justify-center">
                        <SparklesIcon className="size-3 text-primary" />
                      </div>
                    </div>
                  )}

                  <div
                    className={`flex flex-col gap-1 max-w-[80%] ${
                      isUser ? "items-end" : "items-start"
                    }`}
                  >
                    <Card
                      className={`p-3 transition-all shadow-none ${
                        isUser
                          ? "!bg-primary text-primary-foreground !border-primary rounded-tr-sm"
                          : "!bg-muted !border-border rounded-tl-sm"
                      }`}
                    >
                      <div
                        className="response-markdown prose prose-sm prose-invert max-w-none"
                        style={{ fontSize: `${textSize}px` }}
                      >
                        <Markdown>{message.content}</Markdown>
                      </div>
                    </Card>
                    <Badge
                      variant="outline"
                      className={`text-[10px] bg-transparent border-none text-muted-foreground/70 ${
                        isUser ? "-mr-1" : "-ml-1"
                      }`}
                    >
                      {formatDisplayTime(message.timestamp)}
                    </Badge>
                  </div>

                  {isUser && (
                    <div className="flex-shrink-0">
                      <div className="size-7 rounded-full bg-primary flex items-center justify-center">
                        <UserIcon className="size-3 text-primary-foreground" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={completion.messagesEndRef} />
        </div>
      )}

      {/* Input Footer */}
      <div className="absolute bottom-0 left-0 right-0 bg-background/80 backdrop-blur-md border-t border-border rounded-b-xl">
        {completion.error && (
          <div className="px-4 pt-3 pb-0">
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
              <strong>Error:</strong> {completion.error}
            </div>
          </div>
        )}

        <div className="relative flex items-start gap-2 p-4">
          <div className="flex-1 relative">
            {completion.isRecording ? (
              <AudioRecorder
                onTranscriptionComplete={(text) => {
                  completion.setIsRecording(false);
                  completion.submit(text);
                }}
                onCancel={() => completion.setIsRecording(false)}
              />
            ) : (
              <>
                <div className="absolute bottom-2 left-2 flex items-center gap-1 z-10">
                  <ChatFiles
                    attachedFiles={completion.attachedFiles}
                    handleFileSelect={completion.handleFileSelect}
                    removeFile={completion.removeFile}
                    onRemoveAllFiles={completion.onRemoveAllFiles}
                    isLoading={completion.isLoading}
                    isFilesPopoverOpen={completion.isFilesPopoverOpen}
                    setIsFilesPopoverOpen={completion.setIsFilesPopoverOpen}
                    disabled={!supportsImages}
                  />
                  <ChatAudio
                    micOpen={completion.micOpen}
                    setMicOpen={completion.setMicOpen}
                    isRecording={completion.isRecording}
                    setIsRecording={completion.setIsRecording}
                    disabled={false}
                  />
                  <ChatScreenshot
                    screenshotConfiguration={completion.screenshotConfiguration}
                    attachedFiles={completion.attachedFiles}
                    isLoading={completion.isLoading}
                    captureScreenshot={completion.captureScreenshot}
                    isScreenshotLoading={completion.isScreenshotLoading}
                    disabled={!supportsImages}
                  />
                </div>

                <Textarea
                  ref={completion.inputRef}
                  placeholder="Type a message..."
                  className="pr-12 pl-2 resize-none pb-12 pt-3 bg-muted/50 border-border text-foreground placeholder:text-muted-foreground"
                  rows={2}
                  value={completion.input}
                  onChange={(e) => completion.setInput(e.target.value)}
                  onKeyDown={completion.handleKeyPress}
                  onPaste={completion.handlePaste}
                  disabled={completion.isLoading}
                />
                <Button
                  size="icon"
                  className="size-8 rounded-lg absolute right-2 bottom-2"
                  title="Send message"
                  aria-label="Send message"
                  onClick={() => completion.submit()}
                  disabled={completion.isLoading || !completion.input.trim()}
                >
                  {completion.isLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <SendIcon className="size-4" />
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen && !!deleteConfirm} onOpenChange={(open) => {
        if (!open) {
          cancelDelete();
          setDeleteConfirmOpen(false);
        }
      }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Conversation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this conversation? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                cancelDelete();
                setDeleteConfirmOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

      <Dialog open={showDeleteConfirmDialog} onOpenChange={setShowDeleteConfirmDialog}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete All Chat History</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete all chat history? This action
              cannot be undone and will permanently remove all stored
              conversations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Settings;
