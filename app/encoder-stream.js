import 'subworkers'
import { Transform } from 'stream'
import createPool from 'reuse-pool'
import EncodeWorker from './encode-worker'

const pool = createPool(function () {
  return new EncodeWorker()
})
// Prepare first worker
pool.recycle(pool.get())

class EncoderStream extends Transform {
  constructor (codec) {
    super({ objectMode: true })

    this._codec = codec

    this._worker = pool.get()
    this._worker.onmessage = msg => {
      this._onMessage(msg.data)
    }
  }

  _onMessage (data) {
    if (data.reset) {
      pool.recycle(this._worker)
      this._finalCallback()
    } else {
      this.push({
        target: data.target,
        codec: this._codec,
        frame: Buffer.from(data.buffer, data.byteOffset, data.byteLength),
        position: data.position
      })
    }
  }

  _transform (chunk, encoding, callback) {
    var buffer = chunk.pcm.slice().buffer
    this._worker.postMessage({
      action: 'encode' + this._codec,
      target: chunk.target,
      buffer: buffer,
      numberOfChannels: chunk.numberOfChannels,
      bitrate: chunk.bitrate,
      position: chunk.position
    }, [buffer])
    callback()
  }

  _final (callback) {
    this._worker.postMessage({ action: 'reset' })
    this._finalCallback = callback
  }
}

export default EncoderStream
