import "subworkers";
import { Decoder as OpusDecoder } from "libopus.js";

const MUMBLE_SAMPLE_RATE = 48000;

var opusDecoder;
self.addEventListener("message", (e) => {
  const data = e.data;
  if (data.action === "reset") {
    if (opusDecoder) {
      opusDecoder.destroy();
      opusDecoder = null;
    }
    self.postMessage({
      action: "reset",
    });
  } else if (data.action === "decodeOpus") {
    if (!opusDecoder) {
      opusDecoder = new OpusDecoder({
        unsafe: true,
        channels: 1, // TODO
        rate: MUMBLE_SAMPLE_RATE,
      });
    }
    const input = data.buffer ? Buffer.from(data.buffer) : null;
    const decoded = opusDecoder.decodeFloat32(input);
    self.postMessage(
      {
        action: "decoded",
        buffer: decoded.buffer,
        target: data.target,
        position: data.position,
      },
      [decoded.buffer]
    );
  }
});

export default null;
