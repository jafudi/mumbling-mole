import { Decoder as OpusDecoder } from "libopus.js";
import DecoderStream from "./decoder-stream";
import EncoderStream from "./encoder-stream";

export const celt = [
  0x8000000b, // CELT 0.7.1
];
export const opus = true;

export function getDuration(codec, buffer) {
  if (codec === "Opus") {
    return OpusDecoder.getNumberOfSamples(buffer, 48000) / 48;
  } else {
    return 10;
  }
}

export function createDecoderStream(user) {
  return new DecoderStream();
}

export function createEncoderStream(codec) {
  return new EncoderStream(codec);
}
