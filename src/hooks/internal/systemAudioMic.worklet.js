const FRAME_SIZE = 1024;

class GhostframeMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = new Float32Array(0);
  }

  process(inputs) {
    const inputChannels = inputs[0];
    const channel = inputChannels?.[0];

    if (!channel || channel.length === 0) {
      return true;
    }

    const merged = new Float32Array(this.pending.length + channel.length);
    merged.set(this.pending, 0);
    merged.set(channel, this.pending.length);

    let offset = 0;
    while (merged.length - offset >= FRAME_SIZE) {
      const frame = merged.subarray(offset, offset + FRAME_SIZE);
      const pcm16 = new Int16Array(FRAME_SIZE);
      let energy = 0;

      for (let i = 0; i < FRAME_SIZE; i++) {
        const sample = Math.max(-1, Math.min(1, frame[i] ?? 0));
        energy += sample * sample;
        pcm16[i] =
          sample < 0
            ? Math.round(sample * 0x8000)
            : Math.round(sample * 0x7fff);
      }

      const rms = Math.sqrt(energy / FRAME_SIZE);
      this.port.postMessage(
        {
          type: "frame",
          pcm16: pcm16.buffer,
          rms,
        },
        [pcm16.buffer]
      );

      offset += FRAME_SIZE;
    }

    if (offset >= merged.length) {
      this.pending = new Float32Array(0);
      return true;
    }

    const remaining = merged.length - offset;
    const nextPending = new Float32Array(remaining);
    nextPending.set(merged.subarray(offset), 0);
    this.pending = nextPending;

    return true;
  }
}

registerProcessor("ghostframe-mic-processor", GhostframeMicProcessor);
