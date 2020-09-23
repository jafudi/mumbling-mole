import 'subworkers'
import { Encoder as OpusEncoder, libopus } from 'libopus.js'
import { Encoder as Celt7Encoder } from 'libcelt7.js'
import toArrayBuffer from 'to-arraybuffer'

const MUMBLE_SAMPLE_RATE = 48000

  var opusEncoder, celt7Encoder
  var bitrate
  self.addEventListener('message', e => {
    const data = e.data
    if (data.action === 'reset') {
      if (opusEncoder) {
        opusEncoder.destroy()
        opusEncoder = null
      }
      if (celt7Encoder) {
        celt7Encoder.destroy()
        celt7Encoder = null
      }
      bitrate = null
      self.postMessage({reset: true})
    } else if (data.action === 'encodeOpus') {
      if (!opusEncoder) {
        opusEncoder = new OpusEncoder({
          unsafe: true, // for performance and setting sample rate
          channels: data.numberOfChannels,
          rate: MUMBLE_SAMPLE_RATE
        })
      }
      if (data.bitrate !== bitrate) {
        bitrate = data.bitrate
        // Directly accessing libopus like this requires unsafe:true above!
        const OPUS_SET_BITRATE = 4002 // from opus_defines.h
        const OPUS_AUTO = -1000 // from opus_defines.h
        let enc = opusEncoder._state
        let val = libopus._malloc(4) // space for varargs array (single entry)
        try {
          libopus.HEAP32[val >> 2] = bitrate || OPUS_AUTO // store bitrate in varargs array
          let ret = libopus._opus_encoder_ctl(enc, OPUS_SET_BITRATE, val)
          if (ret !== 0) {
            throw new Error(libopus.Pointer_stringify(libopus._opus_strerror(ret)))
          }
        } finally {
          libopus._free(val)
        }
      }
      const encoded = opusEncoder.encode(new Float32Array(data.buffer))
      const buffer = toArrayBuffer(encoded)
      self.postMessage({
        target: data.target,
        buffer: buffer,
        position: data.position
      }, [buffer])
    } else if (data.action === 'encodeCELT_Alpha') {
      if (!celt7Encoder) {
        celt7Encoder = new Celt7Encoder({
          unsafe: true,
          channels: data.numberOfChannels,
          frameSize: MUMBLE_SAMPLE_RATE / 100,
          rate: MUMBLE_SAMPLE_RATE
        })
      }
      const encoded = celt7Encoder.encode(new Float32Array(data.buffer), 960)
      const buffer = toArrayBuffer(encoded)
      self.postMessage({
        target: data.target,
        buffer: buffer,
        position: data.position
      }, [buffer])
    }
  })

 export default null