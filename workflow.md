# Ghostframe Interview Workflow

This explains what happens from the moment you speak until the AI response appears.

## 1) Audio capture starts

- The app captures two streams in parallel:
  - `Interviewer` stream from system audio capture (whatever is playing to your selected output device).
  - `User` stream from your selected microphone.
- In your intended setup, this should be:
  - Output device = headphones.
  - Input device = laptop mic.

## 2) Realtime transcription pipeline (ElevenLabs)

- Both streams are sent to separate ElevenLabs realtime sessions:
  - one session labeled `interviewer`
  - one session labeled `user`
- As chunks arrive, ElevenLabs emits:
  - partial transcript events (shown as `interim`)
  - committed transcript events (eventually shown as `final`)
- The app keeps transcript segments with metadata (`source`, `isLive`, `stability`, `timestamp`).

## 3) Interim -> pending -> final state updates

- `interim`: live partial text while speech is still being recognized.
- `pending` (optimistic): when speech pauses and interim text is promoted so UI does not get stuck waiting.
- `final`: committed transcript from realtime engine.
- When final text arrives, the app tries to patch/replace the latest pending or recent same-speaker segment instead of blindly appending.

## 4) Answer trigger and prompt assembly

- When you trigger answer generation (shortcut/button):
  - both realtime streams are committed,
  - a transcript snapshot is locked at trigger time,
  - prompt is assembled from committed lines in this format:
    - `Interviewer: "..."`
    - `User: "..."`
  - optional typed instruction is appended.
- This prevents late transcript drift from mutating the already-dispatched request.

## 5) Optional screenshots path

- If screenshots are captured, each image is compressed before sending.
- Compression settings include:
  - max size target (`maxSizeMB`)
  - max dimension (`maxWidthOrHeight`)
  - initial quality
  - output MIME forced to `image/webp`
- Why `webp`:
  - smaller payloads than typical PNG/JPEG for UI screenshots,
  - faster request upload,
  - lower token/context pressure for multimodal payloads,
  - better chance to stay under provider/request body limits.
- If compression fails, app falls back to original captured image.

## 6) AI request assembly and send

- Provider curl template is parsed and hydrated with variables.
- Conversation history is compacted before request assembly to reduce payload size.
- If payload is heavy, prompt assembly can be offloaded to a worker thread.
- Request metadata is recorded (method, body chars, host/path, worker usage).

## 7) Streaming response

- AI response is streamed chunk-by-chunk.
- Chunks are buffered and flushed via `requestAnimationFrame` to reduce UI thread churn.
- On completion:
  - assistant message is stored,
  - latency + stream metrics are logged,
  - UI response panel shows the final text.

## 8) Logging and diagnostics

- Each answer attempt writes a structured `system_audio_latency` log entry.
- Logged data includes:
  - timing breakdown (trigger -> prompt -> dispatch -> first chunk -> done)
  - request size metadata
  - queue/drop/reconnect counters
  - transcript summary counts
  - selected input/output device metadata

## 9) Practical operating guidance

- For interview use, keep this stable setup:
  - headphones for output
  - laptop mic for input
- This minimizes acoustic loopback and keeps speaker/user role separation consistent.
