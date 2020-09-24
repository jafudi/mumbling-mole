import { Writable } from 'stream'
import MicrophoneStream from 'microphone-stream'
import getUserMedia from './getusermedia'
import keyboardjs from 'keyboardjs'
import DropStream from 'drop-stream'

class VoiceHandler extends Writable {
  constructor (client, settings) {
    super({ objectMode: true })
    this._client = client
    this._settings = settings
    this._outbound = null
    this._mute = false
  }

  setMute (mute) {
    this._mute = mute
    if (mute) {
      this._stopOutbound()
    }
  }

  _getOrCreateOutbound () {
    if (this._mute) {
      throw new Error('tried to send audio while self-muted')
    }
    if (!this._outbound) {
      if (!this._client) {
        this._outbound = DropStream.obj()
        this.emit('started_talking')
        return this._outbound
      }

      // Note: the samplesPerPacket argument is handled in worker.js and not passed on
      this._outbound = this._client.createVoiceStream(this._settings.samplesPerPacket)

      this.emit('started_talking')
    }
    return this._outbound
  }

  _stopOutbound () {
    if (this._outbound) {
      this.emit('stopped_talking')
      this._outbound.end()
      this._outbound = null
    }
  }

  _final (callback) {
    this._stopOutbound()
    callback()
  }
}

export class ContinuousVoiceHandler extends VoiceHandler {
  constructor (client, settings) {
    super(client, settings)
  }

  _write (data, _, callback) {
    if (this._mute) {
      callback()
    } else {
      this._getOrCreateOutbound().write(data, callback)
    }
  }
}

export class PushToTalkVoiceHandler extends VoiceHandler {
  constructor (client, settings) {
    super(client, settings)
    this._key = settings.pttKey
    this._pushed = false
    this._keydown_handler = () => this._pushed = true
    this._keyup_handler = () => {
      this._stopOutbound()
      this._pushed = false
    }
    keyboardjs.bind(this._key, this._keydown_handler, this._keyup_handler)
  }

  _write (data, _, callback) {
    if (this._pushed && !this._mute) {
      this._getOrCreateOutbound().write(data, callback)
    } else {
      callback()
    }
  }

  _final (callback) {
    super._final(e => {
      keyboardjs.unbind(this._key, this._keydown_handler, this._keyup_handler)
      callback(e)
    })
  }
}

var theUserMedia = null

export function initVoice (onData, onUserMediaError) {
  getUserMedia({ audio: true }, (err, userMedia) => {
    if (err) {
      onUserMediaError(err)
    } else {
      theUserMedia = userMedia
      var micStream = new MicrophoneStream(userMedia, { objectMode: true})
      micStream.on('data', data => {
        onData(Buffer.from(data.getChannelData(0).buffer))
      })
    }
  })
}
