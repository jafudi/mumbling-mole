import 'subworkers'
import { Transform } from 'stream'
import createPool from 'reuse-pool'
import toArrayBuffer from 'to-arraybuffer'
import DecodeWorker from './decode-worker'


const pool = createPool(function () {
  return new DecodeWorker()
})
// Prepare first worker
pool.recycle(pool.get())

class DecoderStream extends Transform {
  constructor() {
    super({ objectMode: true })

    this._worker = pool.get()
    this._worker.onmessage = msg => {
      this._onMessage(msg.data)
    }
  }

  _onMessage(data) {
    if (data.action === 'decoded') {
      this.push({
        target: data.target,
        pcm: new Float32Array(data.buffer),
        numberOfChannels: data.numberOfChannels,
        position: data.position
      })
    } else if (data.action === 'reset') {
      this._finalCallback()
    } else {
      throw new Error('unexpected message:' + data)
    }
  }

  _transform(chunk, encoding, callback) {
    if (chunk.frame) {
      const buffer = toArrayBuffer(chunk.frame)
      this._worker.postMessage({
        action: 'decode' + chunk.codec,
        buffer: buffer,
        target: chunk.target,
        position: chunk.position
      }, [buffer])
    } else {
      this._worker.postMessage({
        action: 'decode' + chunk.codec,
        buffer: null,
        target: chunk.target,
        position: chunk.position
      })
    }
    callback()
  }

  _final(callback) {
    this._worker.postMessage({ id: this._id++, action: 'reset' })
    this._finalCallback = () => {
      pool.recycle(this._worker)
      this._worker = null
      callback()
    }
  }
}

export default DecoderStream
