import Promise from 'promise'
import websocketStream from 'websocket-stream'
import MumbleClient from 'mumble-client'

function connect(address, options, callback) {
  return new Promise((resolve, reject) => {
    var ws = websocketStream(address, ['binary'])
      .on('error', reject)
      .on('connect', () => resolve(ws))
  }).then(ws => {
    return new MumbleClient(options).connectDataStream(ws)
  }).nodeify(callback)
}

export default connect
