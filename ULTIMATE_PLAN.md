# Pluely Technical Gap Analysis & Improvement Report
## Methodology
I performed a deep-dive analysis of **Pluely** (Tauri v2 + React 19 + Rust) and **6 reference projects**:
| Project | Stack | Key Differentiator |
|---|---|---|
| **Cheating Daddy** | Electron + Lit | Gemini Live real-time audio, emergency erase, hybrid transcription+response split |
| **Ghostframe** | Electron 30 + React | Anti-analysis service, process randomizer, spectral VAD, auto-screenshot-on-interaction |
| **Ghostframe1** | Electron 37 + React 19 + shadcn/ui | Periodic screenshot capture, TEXT-only Gemini modality, smart code clipboard, content protection toggle UI, transcription normalization, named action bindings |
| **Glass (Pickle)** | Electron + Lit + Express | WASM AEC, dual STT sessions for speaker separation, multi-window layout manager |
| **Natively** | Electron + React + Rust (N-API) | Rust native audio with WebRTC VAD, epoch summarization, JIT RAG, process disguise with fake icons |
| **OpenCluely** | Electron | Screen-sharing detection, split code layout, aggressive always-on-top re-enforcement, multi-monitor tracking |

### Ghostframe vs Ghostframe1 -- Key Differences
Ghostframe1 is a ground-up rewrite of Ghostframe on a newer stack (Electron 37, React 19, Vite 7, Tailwind v4, shadcn/ui). It is leaner (3 providers vs 9) but has several **superior implementation patterns**:

| Aspect | Ghostframe (original) | Ghostframe1 (rewrite) | Winner |
|---|---|---|---|
| Gemini response modality | `["AUDIO"]` (generates audio, discards it) | `["TEXT"]` (text-only, lower latency) | **Ghostframe1** |
| Screenshot capture | On-interaction only (3s cooldown) | On-interaction (2s cooldown) + **periodic 1s during recording** | **Ghostframe1** |
| Clipboard copy | Copies full markdown text | **Extracts code from fenced blocks**, copies just code | **Ghostframe1** |
| Content protection | Always-on in production (no UI) | **Toggle with Shield/Eye icon** + color-coded status | **Ghostframe1** |
| Transcription display | Raw text (may include garbled chars) | **ASCII-normalized** (strips diacritics/non-ASCII) | **Ghostframe1** |
| Shortcut system | Fixed key bindings | **Named action bindings** (answerTrigger, modeToggle, etc.) | **Ghostframe1** |
| Settings persistence | localStorage only | **electron-store (main) + localStorage (renderer)** -- survives renderer crashes | **Ghostframe1** |
| VAD | Custom spectral VAD (DFT, spectral centroid/flatness, ZCR) | None (relies on Gemini's native VAD) | **Ghostframe** |
| Provider count | 9 providers (Gemini, OpenAI, Claude, Grok, Mistral, Cohere, Groq, Perplexity, Ollama) | 3 providers (Gemini, OpenAI, Claude) | **Ghostframe** |
| Conversation system | Full ConversationManager + ConversationService + streaming | Simplified, max 10 entries | **Ghostframe** |
| AudioWorklet buffer | Fixed allocation | **Dynamic doubling** on overflow -- fewer reallocations | **Ghostframe1** |
| Automation browser data | Uses real Chrome profile | **Separate ~/ghostframe-browser-data** -- no contamination | **Ghostframe1** |
---
Phase 1: Feature Porting
1. STEALTH & ANTI-TRACKING
2. PERFORMANCE & LATENCY
2.1 Gemini Live Real-Time Audio (Bypass STT Entirely)
Source: Cheating Daddy (src/utils/gemini.js), Ghostframe (AIService.ts), Ghostframe1 (AIService.ts)
Pluely status: Missing. Pluely does VAD -> WAV -> batch STT -> AI. This is the single biggest latency source.
What it does: Streams raw PCM audio chunks directly to Gemini via WebSocket. Gemini handles transcription + response generation in one pipeline. Eliminates the separate STT step entirely.
How Cheating Daddy implements it:
session.sendRealtimeInput({
  audio: { data: base64PCM, mimeType: 'audio/pcm;rate=24000' }
});
// Gemini returns inputTranscription (speaker-diarized) + generates response
The transcription comes back via inputTranscription events with speakerId labels (1=Interviewer, 2=Candidate). Response generation is then optionally offloaded to Groq for speed.
Latency improvement: Eliminates the 1-3 second STT batch processing delay. Audio goes in, transcription + response come out in a single pipeline.
**Ghostframe1 optimization -- TEXT-only response modality**: Ghostframe1 sets `responseModalities: ["TEXT"]` instead of Ghostframe's `["AUDIO"]`. The original Ghostframe requests audio output from Gemini and then discards the audio, wasting bandwidth and adding latency. Ghostframe1 requests text-only, which is faster since Gemini skips audio synthesis entirely. This is a critical config optimization.
Implementation in Pluely: Add a Gemini Live provider option. In the frontend, when Gemini Live is selected, pipe raw PCM chunks (already available from the Rust audio capture) directly via WebSocket instead of accumulating -> WAV -> STT -> AI. The Rust backend already emits speech-realtime-chunk events with PCM16 base64 -- wire these directly to Gemini. **Use `responseModalities: ["TEXT"]`** (not AUDIO) for lower latency.
---
2.2 Speaker Diarization (Gemini Live)
Note: When using Gemini Live, enable speaker diarization in the session config (minSpeakers: 2, maxSpeakers: 2).
---
2.7 Acoustic Echo Cancellation (AEC)
Source: Glass (src/ui/listen/audioCore/aec.js)
Pluely status: Missing.
What it does: WASM-compiled Speex AEC running in the renderer. Processes 160-sample frames. Prevents the system audio (interviewer's voice playing through speakers) from being picked up by the microphone and re-transcribed, which causes duplicate/garbled transcriptions.
Why it matters: Without AEC, if you're using speakers (no headphones), the microphone picks up the interviewer's voice from the speakers, creating echo artifacts in the mic transcription. This corrupts the AI context.
Implementation in Pluely: Compile Speex AEC to WASM or integrate it in the Rust backend. Apply it to the microphone audio stream before STT processing, using the system audio stream as the reference signal.
---
3. UI/UX FOR LOW COGNITIVE LOAD
3.3 Compact Overlay Modes
Source: Cheating Daddy (850x400 live mode), OpenCluely (520x28 bar + separate response window)
Pluely status: Expands to 600x600 which is very large.
Cheating Daddy approach: The live assistant view shrinks to 850x400 and positions at the top-center of the screen. Input is a 32px pill at the bottom. Response fills the remaining space.
OpenCluely approach: The main bar is only 520x28px -- a thin horizontal strip. The AI response opens in a separate 840x480 window below it with a configurable gap. The bar contains: camera button, mic button, skill indicator, language dropdown, status dot. That's it.
Why it matters: A 600x600 overlay is massive. It covers the interview question, the IDE, the video call. The goal is to show the answer while hiding as little of the underlying content as possible.
Recommendation for Pluely: Reduce the expanded overlay height. Keep the input bar at 54px. Response popover should max at 300-350px height with scrolling. Total overlay: 600x~400px max. Or adopt the split-window approach (thin bar + separate response panel that can be positioned independently).
3.5 Response Navigation (Prev/Next)
Source: Cheating Daddy (prev/next buttons with "1 of 5" counter, Ctrl+[/Ctrl+])
Pluely status: Missing.
What it does: When multiple questions are asked during a session, each AI response is stored. You can navigate back to previous answers using keyboard shortcuts or buttons.
Why it matters: Interviewers often revisit earlier questions ("Going back to what you said about X..."). Being able to instantly recall the AI's earlier answer for that topic is critical.
Implementation in Pluely: Store responses in an array in useCompletion.ts. Add prev/next navigation with Ctrl+[/Ctrl+] shortcuts.
---
3.6 Split Layout for Code Responses
Source: OpenCluely (llm-response.html)
Pluely status: Missing. Code is inline with text.
What it does: When the AI response contains code blocks, the window splits 50/50: text explanation on the left, code on the right. When no code is detected, full-width text layout.
Why it matters: During coding interviews, you need to see both the explanation and the code simultaneously without scrolling. A split layout eliminates vertical scrolling for code-heavy answers.
---
3.7 Keyboard-Driven Response Scrolling
Source: Cheating Daddy (Ctrl+Shift+Up/Down)
Pluely status: Missing.
What it does: Global keyboard shortcuts that scroll the response content up/down without requiring mouse interaction or window focus.
Why it matters: Moving the mouse to the overlay to scroll is: (a) visible to the interviewer via webcam, (b) takes your hand off the keyboard, (c) may require clicking (focus stealing). Keyboard scrolling is invisible to observers.
4. QUALITY OF LIFE

4.2 Custom Context Injection (Resume/JD)
Source: Cheating Daddy (onboarding textarea), Natively (knowledge orchestrator)
Pluely status: Missing.
What it does: User pastes their resume and the job description during setup. This context is injected between delimiters in every prompt, so the AI knows the user's background and tailors answers accordingly.
Why it matters: Without your resume context, the AI generates generic answers. With it, the AI references YOUR specific experience, projects, and skills -- making answers sound authentic and personalized.
Implementation in Pluely: Add a "Context" section in Dashboard settings with two textareas: "Your Resume" and "Job Description / Additional Context". Inject into system prompt via {{USER_CONTEXT}} variable.
---
4.4 Verbosity Toggle on Input Bar
Source: Ghostframe (Short/Verbose toggle button directly on the input bar)
Pluely status: Has D/P mode toggle (dumb/pro model), but no verbosity control.
What it does: A small button right on the input bar that switches between "Short" (1-3 sentences) and "Verbose" (4-8 sentences with structure). No need to open settings.
Why it matters: Sometimes you need a one-liner ("What's the time complexity of quicksort?" -> "O(n log n) average"). Sometimes you need a detailed explanation. Being able to toggle this with one click, without leaving the overlay, is essential.
Implementation in Pluely: Add a toggle button between the D/P toggle and the send button. Append the verbosity instruction to the system prompt dynamically.
---
4.5 Intelligent Transcription Filtering
Source: OpenCluely (LLM-based filtering)
Pluely status: Missing. All transcription is sent to AI.
What it does: Before generating a response, the LLM classifies the transcription as either "casual conversation" (greetings, small talk) or "skill-relevant question" (technical questions, interview questions). Casual chat gets a brief acknowledgment or is ignored. Only relevant questions trigger full response generation.
Why it matters: Without filtering, every "How are you?" and "Can you hear me?" triggers a full AI response, wasting tokens and cluttering the response area with irrelevant answers. Filtering ensures you only see answers to actual interview questions.
---
4.7 Session Auto-Reconnection with Context Replay
Source: Cheating Daddy (gemini.js), Ghostframe (AIService.ts)
Pluely status: Missing.
What it does: When a Gemini Live WebSocket session times out (10-15 minute limit), auto-reconnects (up to 3 attempts, 2-second delay) and replays the last 20 conversation turns as text to restore context.
Why it matters: Gemini Live sessions have hard time limits. Without auto-reconnection, the app silently stops working mid-interview and the user doesn't notice until their next question gets no answer.
---
Phase 2: Novel Recommendations
2.5 Epoch Summarization (Prevent Context Overflow)
Source: Natively (SessionTracker.ts)
Pluely status: Missing. Conversation history grows unbounded or is hard-truncated.
What it does: When transcript exceeds 1800 entries, the oldest 500 are summarized by the LLM into bullet points. This preserves early meeting context (the job description discussion, introductions) instead of hard-truncating it.
Why it matters: In a 60-minute interview, hard truncation loses the context from the first 30 minutes -- which often contains the most important background. Summarization retains it in compressed form.
Implementation in Pluely: Add a background task in useSystemAudio.ts that monitors transcript length. When threshold is exceeded, send the oldest N entries to the LLM with a "summarize these into bullet points" prompt, replace them with the summary, and continue.
---
4.1 Profile/Preset System with Specialized Prompts
Source: ALL reference projects (Cheating Daddy: 6 profiles, Ghostframe: 6 profiles, Glass: presets, Natively: 6 modes)
Pluely status: Has custom system prompts, but no pre-built interview-specific profiles.
What they do: Pre-configured profiles with specialized prompts:
| Profile | Prompt Style |
|---|---|
| Interview | "Provide the exact words to say. No coaching, no 'you should' statements. Just the answer." |
| Exam | "Provide the correct answer choice and a brief justification. Direct exam answers only." |
| Sales | "Value propositions, objection handling, persuasive responses" |
| Meeting | "Clear communication, action items, professional language" |
| Coding | "Direct code solution with brief explanation. Specify language." |
| Negotiation | "Strategic, win-win positioning, salary/offer-specific" |
Cheating Daddy's prompt structure:
Each profile has: intro (persona), formatRequirements (short/concise, markdown, bold key points), searchUsage (when to use Google Search), content (examples), outputInstructions (speech pacing, length).
Why it matters: A generic "you are a helpful assistant" prompt generates academic, verbose answers. An interview-specific prompt generates "say exactly this" teleprompter text. The difference is the difference between useful and useless during a live interview.
Implementation in Pluely: Add 6 pre-built system prompts in src/config/ with the structured prompt format. Allow one-click selection in the main overlay (a small mode indicator like OpenCluely's "DSA" badge).
---
4.6 Multi-Monitor Window Tracking
Source: OpenCluely (window.manager.js)
Pluely status: Missing.
What it does: Tracks cursor position every 2 seconds. When cursor moves to a different monitor, the overlay automatically follows and repositions on that display.
Why it matters: Many developers use multi-monitor setups. The interview might be on monitor 1 (video call) while the IDE is on monitor 2. The overlay should follow wherever the active work is happening.
---
1.4 Anti-Analysis / Anti-Debugging
Source: Ghostframe (AntiAnalysisService.ts:1-127)
Pluely status: Missing entirely
What they do:
- Random startup delay (1-4 seconds): Evades timing-based sandbox detection
- Process argv truncation: process.argv.length = 2 -- removes debug flags from inspection
- Debugger detection: Checks v8debug, process.debugPort, timing-based detection (loop 1000 iterations, flag if >10ms = debugger attached)
- Memory protection env vars: Windows: WER_DISABLE=1, SUPPRESS_CRASHES=1; macOS: OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES, DISABLE_CORE_DUMPS=1
- Decoy processes: Spawns ping localhost for normal-looking process tree
- Fake environment variables: Sets SYSTEM_MONITOR_ID, AUDIO_SERVICE_PORT to look like a system service
Why it matters: Proctoring tools (e.g., ExamSoft, ProctorU, HonorLock) inspect running processes, debug ports, and process trees. These countermeasures make Pluely look like a legitimate system service.
Implementation in Pluely: Most of this goes into src-tauri/src/lib.rs at startup. Rust has direct access to env vars (std::env::set_var), process args, and can spawn decoy processes. Core dump disabling is straightforward with setrlimit on Unix.
These are high-value features missing from ALL analyzed projects that are critical for the actual end-user scenario.
N1. Gaze-Optimized Overlay Positioning (Near-Webcam Anchoring)
Problem: Every project positions the overlay at the top-center of screen. But the webcam is at the top-center of the monitor bezel. When you read text that's 50-100px below the top of the screen, your eyes visibly look downward on camera. Interviewers notice "they're reading something."
Solution: Position the overlay at the absolute top edge of the screen, with text rendered top-to-bottom starting at pixel 0. On external monitors where the webcam might be centered on top, offer a "webcam position" setting (top-left, top-center, top-right) and anchor the overlay directly below it. The key insight: the overlay should be as close to the camera lens as physically possible so that reading text appears identical to looking at the camera.
Implementation: Add a "webcam position" selector in settings. Calculate overlay X position to align with the selected webcam position. Use y: 0 (already done) but ensure the response text starts at the very first pixel of the overlay, not after a header bar.
---
N2. Teleprompter Auto-Scroll Mode
Problem: All projects show AI responses as static text that the user must scroll manually (via mouse or keyboard). During an interview, manually scrolling while speaking looks unnatural.
Solution: A teleprompter mode that auto-scrolls the response text at a configurable words-per-minute rate (default ~150 WPM, typical speaking speed). The text scrolls upward like a professional teleprompter. The user's eyes stay fixed at a single point on screen -- the "reading line" -- while text flows through it.
Controls: +/- to adjust scroll speed. Space to pause/resume. The current "reading line" is subtly highlighted (slightly brighter text, surrounding text fades).
Implementation: CSS transform: translateY() animation on the response container, driven by a requestAnimationFrame loop. Speed controlled by a variable updated via keyboard shortcuts. Highlight the line closest to a fixed Y position (e.g., 40% from top of container).
---
N3. Predictive Response Generation (Start Before Speaker Finishes)
Problem: All projects wait for the speaker to finish talking (silence detection) before sending the transcript to the AI. This adds 1-3 seconds of pure waiting time.
Solution: Use interim/partial transcription results to start generating a response speculatively. When the first 60-70% of the sentence is transcribed ("What is the time complexity of..."), start generating. If the final transcription changes the meaning, abort and regenerate. If it matches the prediction (which it will >80% of the time for structured interview questions), the answer appears almost instantly after the speaker finishes.
Implementation: With streaming STT (Deepgram WebSocket), interim results arrive every ~200ms. After 3+ consecutive words without change (stabilized prefix), send the prefix to the AI with a prompt like "The question being asked appears to be: interim text. Provide a complete answer." Use AbortController to cancel if the final transcription diverges significantly (edit distance > 30% of interim length).
---
N4. Answer Chunking with Speaking Pace Markers
Problem: AI responses are walls of text. During an interview, you can't read and speak a wall of text naturally. You need to know where to pause, which points to emphasize, and how to pace yourself.
Solution: Post-process AI responses into speakable chunks. Each chunk is 1-2 sentences (8-15 seconds of speaking). Chunks are separated by subtle visual dividers. The current chunk is highlighted, previous chunks are dimmed. Advance to next chunk via a single key press (e.g., Space or Down).
Bonus: Add estimated speaking duration per chunk (e.g., "~12s") so the user knows how long each segment takes to say aloud.
Implementation: Split the response on sentence boundaries. Group into chunks of ~30-40 words. Render each chunk as a separate <div> with transition animations. Track "current chunk index" in state, advance on keypress.
---
N5. Time-Buying Quick Actions
Problem: When a hard question is asked, the AI takes 2-5 seconds to respond. Those seconds of silence during an interview are noticeable and awkward.
Solution: A set of one-key "stalling" actions that buy time:
- F1: Copy "That's a great question, let me think about that for a moment..." to clipboard (or TTS)
- F2: Copy "Could you clarify what you mean by last noun phrase from transcript?"
- F3: Copy "I'd like to approach this from a couple of angles..."
These are context-aware -- they extract the last keyword/topic from the transcript and inject it into the stalling phrase so it sounds natural and specific.
Implementation: Extract the last noun phrase from the most recent transcript using simple regex or the AI itself (fast model). Template substitution into pre-written stalling phrases. Display as a small overlay or copy to clipboard.
---
N6. Latency Budget Dashboard
Problem: Users have no visibility into why a response is slow. Is it the STT? The AI? The network?
Solution: A compact latency indicator in the overlay showing:
- STT: 340ms | AI TTFT: 180ms | Total: 520ms
- Color-coded: green <1s, yellow 1-3s, red >3s
- Historical average displayed in settings
This lets users identify bottlenecks and switch providers accordingly.
Implementation: Timestamp each pipeline stage in useSystemAudio.ts and useCompletion.ts. Display a small 12px latency badge in the overlay header, collapsible to just a colored dot in normal use.
---
N7. One-Handed Shortcut Layout
Problem: All projects spread shortcuts across both hands (Ctrl+Shift+M, Ctrl+\, etc.). During an interview, your right hand should rest naturally (on mouse or in view of webcam). All interaction should be left-hand-only.
Solution: Remap all critical shortcuts to the left side of the keyboard:
- Ctrl+Q: Toggle visibility
- Ctrl+W: Toggle system audio
- Ctrl+E: Screenshot
- Ctrl+1/2/3/4: Quick actions (stalling phrases)
- Ctrl+A/S/D: Scroll up / pause scroll / scroll down
- Ctrl+Tab: Next response
Implementation: Add a "one-handed mode" toggle in shortcut settings that remaps all bindings to left-hand keys. Store as a preset in customizable.storage.ts.
---
N8. Network Pre-flight & Provider Auto-Switch
Problem: If your connection to OpenAI is slow (>2s TTFT) but Groq is fast (<300ms), you'd want to switch. No project does this automatically.
Solution: On app startup and every 5 minutes, ping all configured providers with a trivial request ("Say 'ok'"). Measure TTFT. Auto-sort provider fallback order by latency. Show a network quality badge.
If the primary provider's latency exceeds a threshold (configurable, default 3s), automatically switch to the fastest available provider for the next request.
Implementation: Background task in useEffect that runs latency probes. Store results in state. Use as the sort key for the fallback chain from recommendation 2.4.
---
N9. Confidence / Accuracy Indicator for Transcription
Problem: Sometimes STT garbles the question. The AI then answers the wrong question. The user has no way to know the transcription was inaccurate.
Solution: Display a confidence score from the STT provider (most providers return this). Color-code the transcript: green (>90%), yellow (70-90%), red (<70%). On red confidence, auto-prompt: "The transcription may be inaccurate. Here's what I heard: transcript. If this is wrong, please rephrase."
Implementation: Extract the confidence field from STT responses (Deepgram returns confidence per word, Whisper returns avg_logprob). Display as a small colored dot next to the rolling transcript.
---
N10. Interview Prep Mode (Pre-Interview Warmup)
Problem: All projects are purely reactive -- they only work during the live interview. No project helps you prepare beforehand.
Solution: A "Prep Mode" that:
1. Takes the job description as input
2. Generates 15-20 likely interview questions (behavioral + technical)
3. Simulates the interview with TTS (text-to-speech) asking questions aloud
4. Times your verbal response
5. Provides AI feedback on your answer
6. Stores Q&A pairs for quick recall during the actual interview
During the real interview, if a question matches a prepped question (fuzzy match), the prepped answer is shown instantly (zero latency -- it was pre-generated).
Implementation: New "Prep" tab in Dashboard. Uses LLM to generate questions from JD. TTS via Web Speech API or ElevenLabs. Fuzzy matching via Levenshtein distance or embedding similarity against the live transcript.
---
Priority Matrix
| Priority | Feature | Impact | Effort |
|---|---|---|---|
| P0 - Critical | Gemini Live real-time audio w/ TEXT modality (2.1) | Eliminates 1-3s STT latency | High |
| P0 - Critical | Profile/preset system (4.1) | Transforms answer quality | Low |
| P0 - Critical | Click-through mode (1.6, 3.4) | Eliminates show/hide friction | Low |
| P1 - High | Gaze-optimized positioning (N1) | Prevents "looking away" detection | Low |
| P1 - High | Speaker diarization (2.2) | AI answers correct questions | Medium |
| P1 - High | Teleprompter mode (N2) | Eliminates manual scrolling | Medium |
| P1 - High | Smart fallback chain (2.4) | Prevents dead-air from API failure | Medium |
| P1 - High | Resume/JD context (4.2) | Personalizes all answers | Low |
| P1 - High | Keyboard response scrolling (3.7) | Invisible to webcam | Low |
| P1 - High | Time-buying quick actions (N5) | Covers AI generation delay | Low |
| P2 - Medium | Compact overlay (3.3) | Less screen coverage | Medium |
| P2 - Medium | Verbosity toggle (4.4) | Adapts to question complexity | Low |
| P2 - Medium | Anti-analysis (1.4) | Defeats proctoring tools | Medium |
| P2 - Medium | Epoch summarization (2.5) | Long interview context | Medium |
| P2 - Medium | Predictive generation (N3) | Near-zero perceived latency | High |
| P2 - Medium | Answer chunking (N4) | Natural delivery pacing | Medium |
| P3 - Low | One-handed shortcuts (N7) | Ergonomic improvement | Low |
| P3 - Low | Latency dashboard (N6) | Diagnostic aid | Low |
| P3 - Low | Network pre-flight (N8) | Automatic optimization | Medium |
| P3 - Low | Confidence indicator (N9) | Prevents wrong-answer responses | Low |
| P3 - Low | Interview prep mode (N10) | Pre-interview advantage | High |
| P3 - Low | AEC (2.7) | Speaker-only audio quality | High |
| P3 - Low | Split code layout (3.6) | Better for coding interviews | Medium |
| P3 - Low | Local Whisper STT (4.8) | Zero network trace | High |
| P3 - Low | Multi-monitor tracking (4.6) | Multi-display support | Medium |
---

## Summary

**6 reference projects** analyzed: Cheating Daddy, Ghostframe, Ghostframe1, Glass, Natively, OpenCluely.

Phase 1 identified actionable features to port. Remaining to port, categorized as:
- **Stealth**: Anti-analysis, click-through mode
- **Performance**: Gemini Live real-time audio (with TEXT modality optimization), speaker diarization (Gemini Live config pending), cascading provider fallback, epoch summarization, acoustic echo cancellation
- **UI/UX**: compact overlay, click-through view mode, response navigation, split code layout, keyboard scrolling, high contrast mode
- **QoL**: Profile/preset system, resume/JD context injection, verbosity toggle, intelligent transcript filtering, multi-monitor tracking, session auto-reconnection, local offline pipeline

Phase 2 proposed **10 novel features** missing from all projects:
- N1: Gaze-optimized webcam-anchored positioning
- N2: Teleprompter auto-scroll mode
- N3: Predictive response generation (start before speaker finishes)
- N4: Answer chunking with speaking pace markers
- N5: Time-buying quick actions (stalling phrases)
- N6: Latency budget dashboard
- N7: One-handed shortcut layout
- N8: Network pre-flight & auto provider switch
- N9: Transcription confidence indicator
- N10: Interview prep mode with pre-generated Q&A

**Total: 27 features** across 4 categories, prioritized by impact and effort.
