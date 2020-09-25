import 'stream-browserify' // see https://github.com/ericgundrum/pouch-websocket-sync-example/commit/2a4437b013092cc7b2cd84cf1499172c84a963a3
import 'subworkers'
import url from 'url'
import ByteBuffer from 'bytebuffer'
import MumbleClient from 'mumble-client'
import WorkerBasedMumbleConnector from './worker-client'
import BufferQueueNode from 'web-audio-buffer-queue'
import getAudioContext from 'audio-context'
import ko from 'knockout'
import _dompurify from 'dompurify'
import keyboardjs from 'keyboardjs'
import { parse as urlParse } from 'psl'

import { ContinuousVoiceHandler, PushToTalkVoiceHandler, initVoice } from './voice'
import {initialize as localizationInitialize, translate} from './loc';

const dompurify = _dompurify(window)

function sanitize (html) {
  return dompurify.sanitize(html, {
    ALLOWED_TAGS: ['br', 'b', 'i', 'u', 'a', 'span', 'p']
  })
}

// GUI

function ConnectDialog () {
  var self = this
  self.address = ko.observable('')
  self.port = ko.observable('')
  self.tokenToAdd = ko.observable('')
  self.selectedTokens = ko.observableArray([])
  self.tokens = ko.observableArray([])
  self.username = ko.observable('')
  self.password = ko.observable('')
  self.channelName = ko.observable('')
  self.joinOnly = ko.observable(false)
  self.visible = ko.observable(true)
  self.show = self.visible.bind(self.visible, true)
  self.hide = self.visible.bind(self.visible, false)
  self.connect = function () {
    self.hide()
    ui.connect(self.username(), self.address(), self.port(), self.tokens(), self.password(), self.channelName())
  }

  self.addToken = function() {
    if ((self.tokenToAdd() != "") && (self.tokens.indexOf(self.tokenToAdd()) < 0)) {
      self.tokens.push(self.tokenToAdd())
    }
    self.tokenToAdd("")
  }

  self.removeSelectedTokens = function() {
      this.tokens.removeAll(this.selectedTokens())
      this.selectedTokens([])
  }
}

function ConnectErrorDialog (connectDialog) {
  var self = this
  self.type = ko.observable(0)
  self.reason = ko.observable('')
  self.username = connectDialog.username
  self.password = connectDialog.password
  self.joinOnly = connectDialog.joinOnly
  self.visible = ko.observable(false)
  self.show = self.visible.bind(self.visible, true)
  self.hide = self.visible.bind(self.visible, false)
  self.connect = () => {
    self.hide()
    connectDialog.connect()
  }
}

class ConnectionInfo {
  constructor (ui) {
    this._ui = ui
    this.visible = ko.observable(false)
    this.serverVersion = ko.observable()
    this.latencyMs = ko.observable(NaN)
    this.latencyDeviation = ko.observable(NaN)
    this.remoteHost = ko.observable()
    this.remotePort = ko.observable()
    this.maxBitrate = ko.observable(NaN)
    this.currentBitrate = ko.observable(NaN)
    this.maxBandwidth = ko.observable(NaN)
    this.currentBandwidth = ko.observable(NaN)
    this.codec = ko.observable()

    this.show = () => {
      this.update()
      this.visible(true)
    }
    this.hide = () => this.visible(false)
  }

  update () {
    let client = this._ui.client

    this.serverVersion(client.serverVersion)

    let dataStats = client.dataStats
    if (dataStats) {
      this.latencyMs(dataStats.mean)
      this.latencyDeviation(Math.sqrt(dataStats.variance))
    }
    this.remoteHost(this._ui.remoteHost())
    this.remotePort(this._ui.remotePort())

    let spp = this._ui.settings.samplesPerPacket
    let maxBitrate = client.getMaxBitrate(spp, false)
    let maxBandwidth = client.maxBandwidth
    let actualBitrate = client.getActualBitrate(spp, false)
    let actualBandwidth = MumbleClient.calcEnforcableBandwidth(actualBitrate, spp, false)
    this.maxBitrate(maxBitrate)
    this.currentBitrate(actualBitrate)
    this.maxBandwidth(maxBandwidth)
    this.currentBandwidth(actualBandwidth)
    this.codec('Opus') // only one supported for sending
  }
}

class SettingsDialog {
  constructor (settings) {
    this.voiceMode = ko.observable(settings.voiceMode)
    this.pttKey = ko.observable(settings.pttKey)
    this.pttKeyDisplay = ko.observable(settings.pttKey)
    this.userCountInChannelName = ko.observable(settings.userCountInChannelName())
    // Need to wrap this in a pureComputed to make sure it's always numeric
    let audioBitrate = ko.observable(settings.audioBitrate)
    this.audioBitrate = ko.pureComputed({
      read: audioBitrate,
      write: (value) => audioBitrate(Number(value))
    })
    this.samplesPerPacket = ko.observable(settings.samplesPerPacket)
    this.msPerPacket = ko.pureComputed({
      read: () => this.samplesPerPacket() / 48,
      write: (value) => this.samplesPerPacket(value * 48)
    })
  }

  applyTo (settings) {
    settings.voiceMode = this.voiceMode()
    settings.pttKey = this.pttKey()
    settings.userCountInChannelName(this.userCountInChannelName())
    settings.audioBitrate = this.audioBitrate()
    settings.samplesPerPacket = this.samplesPerPacket()
  }

  end () {
    testVoiceHandler = null
  }

  recordPttKey () {
    var combo = []
    const keydown = e => {
      combo = e.pressedKeys
      let comboStr = combo.join(' + ')
      this.pttKeyDisplay('> ' + comboStr + ' <')
    }
    const keyup = () => {
      keyboardjs.unbind('', keydown, keyup)
      let comboStr = combo.join(' + ')
      if (comboStr) {
        this.pttKey(comboStr).pttKeyDisplay(comboStr)
      } else {
        this.pttKeyDisplay(this.pttKey())
      }
    }
    keyboardjs.bind('', keydown, keyup)
    this.pttKeyDisplay('> ? <')
  }

  totalBandwidth () {
    return MumbleClient.calcEnforcableBandwidth(
      this.audioBitrate(),
      this.samplesPerPacket(),
      true
    )
  }

  positionBandwidth () {
    return this.totalBandwidth() - MumbleClient.calcEnforcableBandwidth(
      this.audioBitrate(),
      this.samplesPerPacket(),
      false
    )
  }

  overheadBandwidth () {
    return MumbleClient.calcEnforcableBandwidth(
      0,
      this.samplesPerPacket(),
      false
    )
  }
}

class Settings {
  constructor (defaults) {
    const load = key => window.localStorage.getItem('mumble.' + key)
    this.voiceMode = load('voiceMode') || defaults.voiceMode
    this.pttKey = load('pttKey') || defaults.pttKey
    this.toolbarVertical = load('toolbarVertical') || defaults.toolbarVertical
    this.userCountInChannelName = ko.observable(load('userCountInChannelName') || defaults.userCountInChannelName)
    this.audioBitrate = Number(load('audioBitrate')) || defaults.audioBitrate
    this.samplesPerPacket = Number(load('samplesPerPacket')) || defaults.samplesPerPacket
  }

  save () {
    const save = (key, val) => window.localStorage.setItem('mumble.' + key, val)
    save('voiceMode', this.voiceMode)
    save('pttKey', this.pttKey)
    save('toolbarVertical', this.toolbarVertical)
    save('userCountInChannelName', this.userCountInChannelName())
    save('audioBitrate', this.audioBitrate)
    save('samplesPerPacket', this.samplesPerPacket)
  }
}

class GlobalBindings {
  constructor (config) {
    this.config = config
    this.settings = new Settings(config.settings)
    this.connector = new WorkerBasedMumbleConnector()
    this.client = null
    this.connectDialog = new ConnectDialog()
    this.connectErrorDialog = new ConnectErrorDialog(this.connectDialog)
    this.connectionInfo = new ConnectionInfo(this)
    this.settingsDialog = ko.observable()
    this.log = ko.observableArray()
    this.remoteHost = ko.observable()
    this.remotePort = ko.observable()
    this.thisUser = ko.observable()
    this.root = ko.observable()
    this.messageBox = ko.observable('')
    this.toolbarHorizontal = ko.observable(!this.settings.toolbarVertical)
    this.selected = ko.observable()
    this.selfMute = ko.observable()
    this.selfDeaf = ko.observable()
    this.audioContext = getAudioContext({latencyHint: 'interactive', sampleRate: 48000})

    this.selfMute.subscribe(mute => {
      if (voiceHandler) {
        voiceHandler.setMute(mute)
      }
    })

    this.select = element => {
      this.selected(element)
    }

    this.openSettings = () => {
      this.settingsDialog(new SettingsDialog(this.settings))
    }

    this.applySettings = () => {
      const settingsDialog = this.settingsDialog()

      settingsDialog.applyTo(this.settings)

      this._updateVoiceHandler()

      this.settings.save()
      this.closeSettings()
    }

    this.closeSettings = () => {
      if (this.settingsDialog()) {
        this.settingsDialog().end()
      }
      this.settingsDialog(null)
    }

    this.getTimeString = () => {
      return '[' + new Date().toLocaleTimeString(navigator.language) + ']'
    }

    this.connect = (username, host, port, tokens = [], password, channelName = "") => {
      this.resetClient()

      this.remoteHost(host)
      this.remotePort(port)

      log(translate('logentry.connecting'), host)

      // Note: This call needs to be delayed until the user has interacted with
      // the page in some way (which at this point they have), see: https://goo.gl/7K7WLu
      this.audioContext.resume().then(() => {
        console.log('Playback resumed successfully');
      });
      this.connector.setSampleRate(this.audioContext.sampleRate)

      // TODO: token
      this.connector.connect(`wss://${host}:${port}`, {
        username: username,
        password: password,
        tokens: tokens
      }).done(client => {
        log(translate('logentry.connected'))

        this.client = client
        // Prepare for connection errors
        client.on('error', (err) => {
          log(translate('logentry.connection_error'), err)
          this.resetClient()
        })

        // Register all channels, recursively
        if(channelName.indexOf("/") != 0) {
          channelName = "/"+channelName;
        }
        const registerChannel = (channel, channelPath) => {
          this._newChannel(channel)
          if(channelPath === channelName) {
            client.self.setChannel(channel)
          }
          channel.children.forEach(ch => registerChannel(ch, channelPath+"/"+ch.name))
        }
        registerChannel(client.root, "")

        // Register all users
        client.users.forEach(user => this._newUser(user))

        // Register future channels
        client.on('newChannel', channel => this._newChannel(channel))
        // Register future users
        client.on('newUser', user => this._newUser(user))

        // Handle messages
        client.on('message', (sender, message, users, channels, trees) => {
          sender = sender || { __ui: 'Server' }
          ui.log.push({
            type: 'chat-message',
            user: sender.__ui,
            channel: channels.length > 0,
            message: sanitize(message)
          })
        })

        // Log permission denied error messages
        client.on('denied', (type) => {
          ui.log.push({
            type: 'generic',
            value: 'Permission denied : '+ type
          })
        })

        // Set own user and root channel
        this.thisUser(client.self.__ui)
        this.root(client.root.__ui)
        // Upate linked channels
        this._updateLinks()
        // Log welcome message
        if (client.welcomeMessage) {
          this.log.push({
            type: 'welcome-message',
            message: sanitize(client.welcomeMessage)
          })
        }

        // Startup audio input processing
        this._updateVoiceHandler()
        // Tell server our mute/deaf state (if necessary)
        if (this.selfDeaf()) {
          this.client.setSelfDeaf(true)
        } else if (this.selfMute()) {
          this.client.setSelfMute(true)
        }
      }, err => {
        if (err.$type && err.$type.name === 'Reject') {
          this.connectErrorDialog.type(err.type)
          this.connectErrorDialog.reason(err.reason)
          this.connectErrorDialog.show()
        } else {
          log(translate('logentry.connection_error'), err)
        }
      })
    }

    this._newUser = user => {
      const simpleProperties = {
        uniqueId: 'uid',
        username: 'name',
        mute: 'mute',
        deaf: 'deaf',
        suppress: 'suppress',
        selfMute: 'selfMute',
        selfDeaf: 'selfDeaf',
        texture: 'rawTexture',
        textureHash: 'textureHash'
      }
      var ui = user.__ui = {
        model: user,
        talking: ko.observable('off'),
        channel: ko.observable()
      }
      ui.texture = ko.pureComputed(() => {
        let raw = ui.rawTexture()
        if (!raw || raw.offset >= raw.limit) return null
        return 'data:image/*;base64,' + ByteBuffer.wrap(raw).toBase64()
      })
      ui.openContextMenu = (_, event) => openContextMenu(event, this.userContextMenu, ui)

      ui.toggleMute = () => {
        if (ui.selfMute()) {
          this.requestUnmute(ui)
        } else {
          this.requestMute(ui)
        }
      }
      ui.toggleDeaf = () => {
        if (ui.selfDeaf()) {
          this.requestUndeaf(ui)
        } else {
          this.requestDeaf(ui)
        }
      }
      Object.entries(simpleProperties).forEach(key => {
        ui[key[1]] = ko.observable(user[key[0]])
      })
      ui.state = ko.pureComputed(userToState, ui)
      if (user.channel) {
        ui.channel(user.channel.__ui)
        ui.channel().users.push(ui)
        ui.channel().users.sort(compareUsers)
      }

      user.on('update', (actor, properties) => {
        Object.entries(simpleProperties).forEach(key => {
          if (properties[key[0]] !== undefined) {
            ui[key[1]](properties[key[0]])
          }
        })
        if (properties.channel !== undefined) {
          if (ui.channel()) {
            ui.channel().users.remove(ui)
          }
          ui.channel(properties.channel.__ui)
          ui.channel().users.push(ui)
          ui.channel().users.sort(compareUsers)
          this._updateLinks()
        }
        if (properties.textureHash !== undefined) {
          ui.rawTexture(null)
        }
      }).on('remove', () => {
        if (ui.channel()) {
          ui.channel().users.remove(ui)
        }
      }).on('voice', stream => {
        console.log(`User ${user.username} started takling`)
        var userNode = new BufferQueueNode({
          audioContext: this.audioContext
        })
        userNode.connect(this.audioContext.destination)

        stream.on('data', data => {
          if (data.target === 'normal') {
            ui.talking('on')
          } else if (data.target === 'shout') {
            ui.talking('shout')
          } else if (data.target === 'whisper') {
            ui.talking('whisper')
          }
          userNode.write(data.buffer)
        }).on('end', () => {
          console.log(`User ${user.username} stopped takling`)
          ui.talking('off')
          userNode.end()
        })
      })
    }

    this._newChannel = channel => {
      const simpleProperties = {
        position: 'position',
        name: 'name',
        description: 'description'
      }
      var ui = channel.__ui = {
        model: channel,
        expanded: ko.observable(true),
        parent: ko.observable(),
        channels: ko.observableArray(),
        users: ko.observableArray(),
        linked: ko.observable(false)
      }
      ui.userCount = () => {
        return ui.channels().reduce((acc, c) => acc + c.userCount(), ui.users().length)
      }
      ui.openContextMenu = (_, event) => openContextMenu(event, this.channelContextMenu, ui)
      Object.entries(simpleProperties).forEach(key => {
        ui[key[1]] = ko.observable(channel[key[0]])
      })
      if (channel.parent) {
        ui.parent(channel.parent.__ui)
        ui.parent().channels.push(ui)
        ui.parent().channels.sort(compareChannels)
      }
      this._updateLinks()

      channel.on('update', properties => {
        Object.entries(simpleProperties).forEach(key => {
          if (properties[key[0]] !== undefined) {
            ui[key[1]](properties[key[0]])
          }
        })
        if (properties.parent !== undefined) {
          if (ui.parent()) {
            ui.parent().channel.remove(ui)
          }
          ui.parent(properties.parent.__ui)
          ui.parent().channels.push(ui)
          ui.parent().channels.sort(compareChannels)
        }
        if (properties.links !== undefined) {
          this._updateLinks()
        }
      }).on('remove', () => {
        if (ui.parent()) {
          ui.parent().channels.remove(ui)
        }
        this._updateLinks()
      })
    }

    this.resetClient = () => {
      if (this.client) {
        this.client.disconnect()
      }
      this.client = null
      this.selected(null).root(null).thisUser(null)
    }

    this.connected = () => this.thisUser() != null

    this._updateVoiceHandler = () => {
      if (!this.client) {
        return
      }
      if (voiceHandler) {
        voiceHandler.end()
        voiceHandler = null
      }
      let mode = this.settings.voiceMode
      if (mode === 'cont') {
        voiceHandler = new ContinuousVoiceHandler(this.client, this.settings)
      } else if (mode === 'ptt') {
        voiceHandler = new PushToTalkVoiceHandler(this.client, this.settings)
      } else {
        log(translate('logentry.unknown_voice_mode'), mode)
        return
      }
      voiceHandler.on('started_talking', () => {
        if (this.thisUser()) {
          this.thisUser().talking('on')
        }
      })
      voiceHandler.on('stopped_talking', () => {
        if (this.thisUser()) {
          this.thisUser().talking('off')
        }
      })
      if (this.selfMute()) {
        voiceHandler.setMute(true)
      }

      this.client.setAudioQuality(
        this.settings.audioBitrate,
        this.settings.samplesPerPacket
      )
    }

    this.messageBoxHint = ko.pureComputed(() => {
      if (!this.thisUser()) {
        return '' // Not yet connected
      }
      var target = this.selected()
      if (!target) {
        target = this.thisUser()
      }
      if (target === this.thisUser()) {
        target = target.channel()
      }
      if (target.users) { // Channel
        return translate('chat.channel_message_placeholder')
          .replace('%1', target.name())
      } else { // User
        return translate('chat.user_message_placeholder')
          .replace('%1', target.name())
      }
    })

    this.submitMessageBox = () => {
      this.sendMessage(this.selected(), this.messageBox())
      this.messageBox('')
    }

    this.sendMessage = (target, message) => {
      if (this.connected()) {
        // If no target is selected, choose our own user
        if (!target) {
          target = this.thisUser()
        }
        // If target is our own user, send to our channel
        if (target === this.thisUser()) {
          target = target.channel()
        }
        // Send message
        target.model.sendMessage(message)
        if (target.users) { // Channel
          this.log.push({
            type: 'chat-message-self',
            message: sanitize(message),
            channel: target
          })
        } else { // User
          this.log.push({
            type: 'chat-message-self',
            message: sanitize(message),
            user: target
          })
        }
      }
    }

    this.requestMute = user => {
      if (user === this.thisUser()) {
        this.selfMute(true)
      }
      if (this.connected()) {
        if (user === this.thisUser()) {
          this.client.setSelfMute(true)
        } else {
          user.model.setMute(true)
        }
      }
    }

    this.requestDeaf = user => {
      if (user === this.thisUser()) {
        this.selfMute(true)
        this.selfDeaf(true)
      }
      if (this.connected()) {
        if (user === this.thisUser()) {
          this.client.setSelfDeaf(true)
        } else {
          user.model.setDeaf(true)
        }
      }
    }

    this.requestUnmute = user => {
      if (user === this.thisUser()) {
        this.selfMute(false)
        this.selfDeaf(false)
      }
      if (this.connected()) {
        if (user === this.thisUser()) {
          this.client.setSelfMute(false)
        } else {
          user.model.setMute(false)
        }
      }
    }

    this.requestUndeaf = user => {
      if (user === this.thisUser()) {
        this.selfDeaf(false)
      }
      if (this.connected()) {
        if (user === this.thisUser()) {
          this.client.setSelfDeaf(false)
        } else {
          user.model.setDeaf(false)
        }
      }
    }

    this._updateLinks = () => {
      if (!this.thisUser()) {
        return
      }

      var allChannels = getAllChannels(this.root(), [])
      var ownChannel = this.thisUser().channel().model
      var allLinked = findLinks(ownChannel, [])
      allChannels.forEach(channel => {
        channel.linked(allLinked.indexOf(channel.model) !== -1)
      })

      function findLinks (channel, knownLinks) {
        knownLinks.push(channel)
        channel.links.forEach(next => {
          if (next && knownLinks.indexOf(next) === -1) {
            findLinks(next, knownLinks)
          }
        })
        allChannels.map(c => c.model).forEach(next => {
          if (next && knownLinks.indexOf(next) === -1 && next.links.indexOf(channel) !== -1) {
            findLinks(next, knownLinks)
          }
        })
        return knownLinks
      }

      function getAllChannels (channel, channels) {
        channels.push(channel)
        channel.channels().forEach(next => getAllChannels(next, channels))
        return channels
      }
    }

    this.openSourceCode = () => {
      var homepage = require('../package.json').homepage
      window.open(homepage, '_blank').focus()
    }
  }
}
var ui = new GlobalBindings(window.mumbleWebConfig)

// Used only for debugging
window.mumbleUi = ui

function initializeUI () {
  var queryParams = url.parse(document.location.href, true).query
  queryParams = Object.assign({}, window.mumbleWebConfig.defaults, queryParams)
  var useJoinDialog = queryParams.joinDialog
  if (queryParams.address) {
    ui.connectDialog.address(queryParams.address)
  } else {
    useJoinDialog = false
  }
  if (queryParams.port) {
    ui.connectDialog.port(queryParams.port)
  } else {
    useJoinDialog = false
  }
  if (queryParams.token) {
    var tokens = queryParams.token
    if (!Array.isArray(tokens)) {
      tokens = [tokens]
    }
    ui.connectDialog.tokens(tokens)
  }
  if (queryParams.username) {
    ui.connectDialog.username(queryParams.username)
  } else {
    useJoinDialog = false
  }
  if (queryParams.password) {
    ui.connectDialog.password(queryParams.password)
  }
  if (queryParams.channelName) {
    ui.connectDialog.channelName(queryParams.channelName)
  }
  ui.connectDialog.joinOnly(useJoinDialog)
  ko.applyBindings(ui)
}

function log () {
  console.log.apply(console, arguments)
  var args = []
  for (var i = 0; i < arguments.length; i++) {
    args.push(arguments[i])
  }
  ui.log.push({
    type: 'generic',
    value: args.join(' ')
  })
}

function compareChannels (c1, c2) {
  if (c1.position() === c2.position()) {
    return c1.name() === c2.name() ? 0 : c1.name() < c2.name() ? -1 : 1
  }
  return c1.position() - c2.position()
}

function compareUsers (u1, u2) {
  return u1.name() === u2.name() ? 0 : u1.name() < u2.name() ? -1 : 1
}

function userToState () {
  var flags = []
  if (this.uid()) {
    flags.push('Authenticated')
  }
  if (this.mute()) {
    flags.push('Muted (server)')
  }
  if (this.deaf()) {
    flags.push('Deafened (server)')
  }
  if (this.selfMute()) {
    flags.push('Muted (self)')
  }
  if (this.selfDeaf()) {
    flags.push('Deafened (self)')
  }
  return flags.join(', ')
}

var voiceHandler
var testVoiceHandler

/**
 * @author svartoyg
 */
function translatePiece(selector, kind, parameters, key) {
  let element = document.querySelector(selector);
  if (element !== null) {
    const translation = translate(key);
    switch (kind) {
      default:
        console.warn('unhandled dom translation kind "' + kind + '"');
        break;
      case 'textcontent':
        element.textContent = translation;
        break;
      case 'attribute':
        element.setAttribute(parameters.name || 'value', translation);
        break;
    }
  } else {
    console.warn(`translation selector "${selector}" for "${key}" did not match any element`)
  }
}

/**
 * @author svartoyg
 */
function translateEverything() {
  translatePiece('#connect-dialog_title', 'textcontent', {}, 'connectdialog.title');
  translatePiece('#connect-dialog_input_address', 'textcontent', {}, 'connectdialog.address');
  translatePiece('#connect-dialog_input_port', 'textcontent', {}, 'connectdialog.port');
  translatePiece('#connect-dialog_input_username', 'textcontent', {}, 'connectdialog.username');
  translatePiece('#connect-dialog_input_password', 'textcontent', {}, 'connectdialog.password');
  translatePiece('#connect-dialog_controls_cancel', 'attribute', {'name': 'value'}, 'connectdialog.cancel');
  translatePiece('#connect-dialog_controls_connect', 'attribute', {'name': 'value'}, 'connectdialog.connect');
  translatePiece('.connect-dialog.error-dialog .dialog-header', 'textcontent', {}, 'connectdialog.error.title');
  translatePiece('.connect-dialog.error-dialog .reason .refused', 'textcontent', {}, 'connectdialog.error.reason.refused');
  translatePiece('.connect-dialog.error-dialog .reason .version', 'textcontent', {}, 'connectdialog.error.reason.version');
  translatePiece('.connect-dialog.error-dialog .reason .username', 'textcontent', {}, 'connectdialog.error.reason.username');
  translatePiece('.connect-dialog.error-dialog .reason .userpassword', 'textcontent', {}, 'connectdialog.error.reason.userpassword');
  translatePiece('.connect-dialog.error-dialog .reason .serverpassword', 'textcontent', {}, 'connectdialog.error.reason.serverpassword');
  translatePiece('.connect-dialog.error-dialog .reason .username-in-use', 'textcontent', {}, 'connectdialog.error.reason.username_in_use');
  translatePiece('.connect-dialog.error-dialog .reason .full', 'textcontent', {}, 'connectdialog.error.reason.full');
  translatePiece('.connect-dialog.error-dialog .reason .clientcert', 'textcontent', {}, 'connectdialog.error.reason.clientcert');
  translatePiece('.connect-dialog.error-dialog .reason .server', 'textcontent', {}, 'connectdialog.error.reason.server');
  translatePiece('.connect-dialog.error-dialog .alternate-username', 'textcontent', {}, 'connectdialog.username');
  translatePiece('.connect-dialog.error-dialog .alternate-password', 'textcontent', {}, 'connectdialog.password');
  translatePiece('.connect-dialog.error-dialog .dialog-submit', 'attribute', {'name': 'value'}, 'connectdialog.error.retry');
  translatePiece('.connect-dialog.error-dialog .dialog-close', 'attribute', {'name': 'value'}, 'connectdialog.error.cancel');

  translatePiece('.join-dialog .dialog-header', 'textcontent', {}, 'joindialog.title');
  translatePiece('.join-dialog .dialog-submit', 'attribute', {'name': 'value'}, 'joindialog.connect');

  translatePiece('#connection-info_title', 'textcontent', {}, 'connectinfo.title');
  translatePiece('#connection-info_server', 'textcontent', {}, 'connectinfo.server');
  translatePiece('#connection-info_webapp', 'textcontent', {}, 'connectinfo.webapp');
  translatePiece('#connection-info_native', 'textcontent', {}, 'connectinfo.native');

  translatePiece('#settings-dialog_title', 'textcontent', {}, 'settingsdialog.title');
  translatePiece('#settings-dialog_transmission', 'textcontent', {}, 'settingsdialog.transmission');
  translatePiece('#settings-dialog_cont', 'textcontent', {}, 'settingsdialog.cont');
  translatePiece('#settings-dialog_ptt', 'textcontent', {}, 'settingsdialog.ptt');
  translatePiece('#settings-dialog_ptt_key', 'textcontent', {}, 'settingsdialog.ptt_key');
  translatePiece('#settings-dialog_audio_quality', 'textcontent', {}, 'settingsdialog.audio_quality');
  translatePiece('#settings-dialog_packet', 'textcontent', {}, 'settingsdialog.packet');
  translatePiece('#settings-dialog_close', 'attribute', {'name': 'value'}, 'settingsdialog.close');
  translatePiece('#settings-dialog_submit', 'attribute', {'name': 'value'}, 'settingsdialog.submit');
}

async function main() {
  var subdomain = require('psl').parse(window.location.hostname).subdomain;
  document.title = subdomain;
  await localizationInitialize(navigator.language);
  translateEverything();
  initializeUI();
  initVoice(data => {
    if (testVoiceHandler) {
      testVoiceHandler.write(data)
    }
    if (!ui.client) {
      if (voiceHandler) {
        voiceHandler.end()
      }
      voiceHandler = null
    } else if (voiceHandler) {
      voiceHandler.write(data)
    }
  }, err => {
    log(translate('logentry.mic_init_error'), err)
  })
}

window.onload = main

