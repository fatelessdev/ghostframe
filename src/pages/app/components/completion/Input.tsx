import { Loader2, XIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  ScrollArea,
  Input as InputComponent,
  Markdown,
  Switch,
  CopyButton,
} from "@/components";
import { UseCompletionReturn } from "@/types";
import { MessageHistory } from "./MessageHistory";
import {
  DEFAULT_RESPONSE_SETTINGS,
  getResponseSettings,
  updateResponsePanelSize,
} from "@/lib/storage/response-settings.storage";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const MIN_PANEL_WIDTH = 480;
const MIN_PANEL_HEIGHT = 300;

export const Input = ({
  isPopoverOpen,
  isLoading,
  reset,
  input,
  setInput,
  handleKeyPress,
  handlePaste,
  currentConversationId,
  conversationHistory,
  startNewConversation,
  messageHistoryOpen,
  setMessageHistoryOpen,
  error,
  response,
  cancel,
  scrollAreaRef,
  inputRef,
  keepEngaged,
  setKeepEngaged,
}: UseCompletionReturn) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [responseSettings, setResponseSettings] = useState(() =>
    getResponseSettings()
  );

  useEffect(() => {
    const syncResponseSettings = () => {
      setResponseSettings(getResponseSettings());
    };

    const handleResponseSettingsChanged = (event: Event) => {
      const customEvent = event as CustomEvent<typeof DEFAULT_RESPONSE_SETTINGS>;
      if (customEvent.detail) {
        setResponseSettings(customEvent.detail);
        return;
      }
      syncResponseSettings();
    };

    window.addEventListener("storage", syncResponseSettings);
    window.addEventListener(
      "responseSettingsChanged",
      handleResponseSettingsChanged as EventListener
    );

    return () => {
      window.removeEventListener("storage", syncResponseSettings);
      window.removeEventListener(
        "responseSettingsChanged",
        handleResponseSettingsChanged as EventListener
      );
    };
  }, []);

  useEffect(() => {
    const element = panelRef.current;
    if (!element || !isPopoverOpen) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const nextWidth = Math.round(entry.contentRect.width);
      const nextHeight = Math.round(entry.contentRect.height);

      if (
        nextWidth === responseSettings.panelWidth &&
        nextHeight === responseSettings.panelHeight
      ) {
        return;
      }

      setResponseSettings((prev) => ({
        ...prev,
        panelWidth: nextWidth,
        panelHeight: nextHeight,
      }));
      updateResponsePanelSize(nextWidth, nextHeight);
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [isPopoverOpen, responseSettings.panelHeight, responseSettings.panelWidth]);

  useEffect(() => {
    if (!isPopoverOpen) {
      return;
    }

    const syncWindowSize = async () => {
      try {
        await invoke("set_window_height", {
          window: getCurrentWebviewWindow(),
          height: Math.max(MIN_PANEL_HEIGHT, responseSettings.panelHeight),
          width: Math.max(MIN_PANEL_WIDTH, responseSettings.panelWidth),
        });
      } catch (error) {
        console.error("Failed to sync response panel size:", error);
      }
    };

    void syncWindowSize();
  }, [isPopoverOpen, responseSettings.panelHeight, responseSettings.panelWidth]);

  return (
    <div className="relative flex-1">
      <Popover
        open={isPopoverOpen}
        onOpenChange={(open) => {
          if (!open && !isLoading && !keepEngaged) {
            reset();
          }
        }}
      >
        <PopoverTrigger asChild className="!border-none !bg-transparent">
          <div className="relative select-none">
            <InputComponent
              ref={inputRef}
              placeholder="Ask me anything..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              onPaste={handlePaste}
              disabled={isLoading}
              className={`${
                currentConversationId && conversationHistory.length > 0
                  ? "pr-14"
                  : "pr-2"
              }`}
            />

            {/* Conversation thread indicator */}
            {currentConversationId &&
              conversationHistory.length > 0 &&
              !isLoading && (
                <div className="absolute select-none right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <MessageHistory
                    conversationHistory={conversationHistory}
                    currentConversationId={currentConversationId}
                    onStartNewConversation={startNewConversation}
                    messageHistoryOpen={messageHistoryOpen}
                    setMessageHistoryOpen={setMessageHistoryOpen}
                  />
                </div>
              )}

            {/* Loading indicator */}
            {isLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 animate-pulse">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </PopoverTrigger>

        {/* Response Panel */}
        <PopoverContent
          ref={panelRef}
          align="end"
          side="bottom"
          className="p-0 border shadow-lg overflow-hidden min-w-[480px] min-h-[300px] max-h-[calc(100vh-5rem)]"
          sideOffset={8}
          style={{
            width: `${Math.max(MIN_PANEL_WIDTH, responseSettings.panelWidth)}px`,
            height: `${Math.max(MIN_PANEL_HEIGHT, responseSettings.panelHeight)}px`,
            resize: "both",
          }}
        >
          <div className="flex h-full min-h-0 flex-col bg-background">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30 shrink-0">
              <div className="flex flex-row gap-2 items-center">
                <h3 className="font-semibold text-xs select-none">
                  {keepEngaged ? "Conversation Mode" : "AI Response"}
                </h3>
                <div className="text-[10px] text-muted-foreground/70">
                  (Use arrow keys to scroll)
                </div>
                <div className="text-[10px] text-muted-foreground/70 hidden sm:block">
                  Drag bottom-right corner to resize
                </div>
              </div>
              <div className="flex items-center gap-2 select-none">
                <div className="flex flex-row items-center gap-2 mr-2">
                  <p className="text-[10px]">{`Toggle ${
                    keepEngaged ? "AI response" : "conversation mode"
                  }`}</p>
                  <span className="text-[10px] text-muted-foreground/60 bg-muted/30 px-1 py-0 rounded border border-input/50">
                    {navigator.platform.toLowerCase().includes("mac")
                      ? "⌘"
                      : "Ctrl"}{" "}
                    + K
                  </span>
                  <Switch
                    checked={keepEngaged}
                    onCheckedChange={(checked) => {
                      setKeepEngaged(checked);
                      // Focus input after toggle
                      setTimeout(() => {
                        inputRef?.current?.focus();
                      }, 100);
                    }}
                  />
                </div>
                <CopyButton content={response} />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    if (isLoading) {
                      cancel();
                    } else if (keepEngaged) {
                      // When keepEngaged is on, close everything and start new conversation
                      setKeepEngaged(false);
                      startNewConversation();
                    } else {
                      reset();
                    }
                  }}
                  className="cursor-pointer"
                  title={
                    isLoading
                      ? "Cancel loading"
                      : keepEngaged
                      ? "Close and start new conversation"
                      : "Clear conversation"
                  }
                >
                  <XIcon />
                </Button>
              </div>
            </div>

            <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0">
              <div className="p-4" style={{ fontSize: `${responseSettings.textSize}px` }}>
                {error && (
                  <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
                    <strong>Error:</strong> {error}
                  </div>
                )}
                {isLoading && (
                  <div className="flex items-center gap-2 my-4 text-muted-foreground animate-pulse select-none">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Generating response...</span>
                  </div>
                )}
                {response && <Markdown>{response}</Markdown>}

                {/* Conversation History - Separate scroll, no auto-scroll */}
                {keepEngaged && conversationHistory.length > 1 && (
                  <div className="space-y-3 pt-3">
                    {conversationHistory
                      .sort((a, b) => b?.timestamp - a?.timestamp)
                      .map((message, index) => {
                        if (!isLoading && index === 0) {
                          return null;
                        }
                        return (
                          <div
                            key={message.id}
                            className={`p-3 rounded-lg text-sm ${
                              message.role === "user"
                                ? "bg-primary/10 border-l-4 border-primary"
                                : "bg-muted/50"
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-medium text-muted-foreground uppercase">
                                {message.role === "user" ? "You" : "AI"}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(message.timestamp).toLocaleTimeString(
                                  [],
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )}
                              </span>
                            </div>
                            <Markdown>{message.content}</Markdown>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
