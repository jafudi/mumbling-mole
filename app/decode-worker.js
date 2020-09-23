import { Decoder as OpusDecoder } from 'libopus.js'
import { Decoder as Celt7Decoder } from 'libcelt7.js'

const MUMBLE_SAMPLE_RATE = 48000

  var opusDecoder, celt7Decoder
  self.addEventListener('message', e => {
    const data = e.data
    if (data.action === 'reset') {
      if (opusDecoder) {
        opusDecoder.destroy()
        opusDecoder = null
      }
      if (celt7Decoder) {
        celt7Decoder.destroy()
        celt7Decoder = null
      }
      self.postMessage({
        action: 'reset'
      })
    } else if (data.action === 'decodeOpus') {
      if (!opusDecoder) {
        opusDecoder = new OpusDecoder({
          unsafe: true,
          channels: 1, // TODO
          rate: MUMBLE_SAMPLE_RATE
        })
      }
      const input = data.buffer ? Buffer.from(data.buffer) : null
      const decoded = opusDecoder.decodeFloat32(input)
      self.postMessage({
        action: 'decoded',
        buffer: decoded.buffer,
        target: data.target,
        position: data.position
      }, [decoded.buffer])
    } else if (data.action === 'decodeCELT_Alpha') {
      if (!celt7Decoder) {
        celt7Decoder = new Celt7Decoder({
          unsafe: true,
          channels: 1,
          frameSize: MUMBLE_SAMPLE_RATE / 100,
          rate: MUMBLE_SAMPLE_RATE
        })
      }
      const input = data.buffer ? Buffer.from(data.buffer) : null
      const decoded = celt7Decoder.decodeFloat32(input)
      self.postMessage({
        action: 'decoded',
        buffer: decoded.buffer,
        target: data.target,
        position: data.position
      }, [decoded.buffer])
    }
  })

 export default null