import { type MutableRefObject } from "react";
import { type TranscriptSource, type TranscriptStability } from "@/types";
import {
  commitRealtimeHandle,
  type RealtimeHandle,
} from "@/hooks/internal/systemAudioRealtime";

export type PendingCommitEcho = {
  partialText: string;
  timestamp: number;
};

type PendingCommitEchoRef = MutableRefObject<
  Partial<Record<TranscriptSource, PendingCommitEcho>>
>;

type CommitStreamsForAnswerTriggerOptions = {
  interviewerHandle: RealtimeHandle;
  userHandle: RealtimeHandle;
  minCommitAudioMs: number;
  latestPartialInterviewerRef: MutableRefObject<string>;
  latestPartialUserRef: MutableRefObject<string>;
  pendingCommitEchoRef: PendingCommitEchoRef;
  onCommitError: (source: TranscriptSource, error: unknown) => void;
  now?: () => number;
};

const commitHandleForAnswer = (
  handle: RealtimeHandle,
  source: TranscriptSource,
  minCommitAudioMs: number,
  onCommitError: (source: TranscriptSource, error: unknown) => void
): boolean => {
  return commitRealtimeHandle(handle, minCommitAudioMs, (error) => {
    onCommitError(source, error);
  });
};

export const commitRealtimeStreamsForAnswerTrigger = ({
  interviewerHandle,
  userHandle,
  minCommitAudioMs,
  latestPartialInterviewerRef,
  latestPartialUserRef,
  pendingCommitEchoRef,
  onCommitError,
  now = Date.now,
}: CommitStreamsForAnswerTriggerOptions): void => {
  if (
    commitHandleForAnswer(
      interviewerHandle,
      "interviewer",
      minCommitAudioMs,
      onCommitError
    )
  ) {
    const preview = latestPartialInterviewerRef.current.trim();
    if (preview) {
      pendingCommitEchoRef.current.interviewer = {
        partialText: preview,
        timestamp: now(),
      };
    }
  }

  if (commitHandleForAnswer(userHandle, "user", minCommitAudioMs, onCommitError)) {
    const preview = latestPartialUserRef.current.trim();
    if (preview) {
      pendingCommitEchoRef.current.user = {
        partialText: preview,
        timestamp: now(),
      };
    }
  }
};

type CommitLatestPartialsOptions = {
  latestPartialInterviewerRef: MutableRefObject<string>;
  latestPartialUserRef: MutableRefObject<string>;
  pendingCommitEchoRef: PendingCommitEchoRef;
  appendCommittedTranscript: (
    source: TranscriptSource,
    text: string,
    stability?: TranscriptStability
  ) => void;
  now?: () => number;
};

export const commitLatestPartialTranscripts = ({
  latestPartialInterviewerRef,
  latestPartialUserRef,
  pendingCommitEchoRef,
  appendCommittedTranscript,
  now = Date.now,
}: CommitLatestPartialsOptions): void => {
  const partialInterviewer = latestPartialInterviewerRef.current;
  if (partialInterviewer) {
    appendCommittedTranscript("interviewer", partialInterviewer, "optimistic");
    pendingCommitEchoRef.current.interviewer = {
      partialText: partialInterviewer,
      timestamp: now(),
    };
    latestPartialInterviewerRef.current = "";
  }

  const partialUser = latestPartialUserRef.current;
  if (partialUser) {
    appendCommittedTranscript("user", partialUser, "optimistic");
    pendingCommitEchoRef.current.user = {
      partialText: partialUser,
      timestamp: now(),
    };
    latestPartialUserRef.current = "";
  }
};
