import "stream-browserify"; // see https://github.com/ericgundrum/pouch-websocket-sync-example/commit/2a4437b013092cc7b2cd84cf1499172c84a963a3
import "subworkers"; // polyfill for https://bugs.chromium.org/p/chromium/issues/detail?id=31666
import url from "url";
import MumbleClient from "mumble-client";
import WorkerBasedMumbleConnector from "./worker-client";
import BufferQueueNode from "web-audio-buffer-queue";
import ko from "knockout";
import _dompurify from "dompurify";
import keyboardjs from "keyboardjs";
import ByteBuffer from "bytebuffer";
import mumbleConnect from "mumble-client-websocket";
import anchorme from "anchorme";
import getAudioContext from "audio-context";

import {
  ContinuousVoiceHandler,
  PushToTalkVoiceHandler,
  initVoice,
  enumMicrophones,
} from "./voice";

import {
  initialize as localizationInitialize,
  translateEverything,
  translate,
} from "./localize";

function GuacamoleFrame() {
  var self = this;
  self.guacSource = ko.observable("/guacamole/");
  self.visible = ko.observable(false);
  self.show = self.visible.bind(self.visible, true);
  self.hide = self.visible.bind(self.visible, false);
}

const dompurify = _dompurify(window);

// from: https://gist.github.com/haliphax/5379454
ko.extenders.scrollFollow = function (target, selector) {
  target.subscribe(function (chat) {
    const el = document.querySelector(selector);

    // the scroll bar is all the way down, so we know they want to follow the text
    if (el.scrollTop == el.scrollHeight - el.clientHeight) {
      // have to push our code outside of this thread since the text hasn't updated yet
      setTimeout(function () {
        el.scrollTop = el.scrollHeight - el.clientHeight;
      }, 0);
    } else {
      // send notification
      const last = chat[chat.length - 1];
      if (
        Notification.permission == "granted" &&
        last.type != "chat-message-self"
      ) {
        let sender = "Mumble Server";
        if (last.user && last.user.name) sender = last.user.name();
        new Notification(sender, {
          body: dompurify.sanitize(last.message, { ALLOWED_TAGS: [] }),
        });
      }
    }
  });

  return target;
};

function sanitize(html) {
  return dompurify.sanitize(html, {
    ALLOWED_TAGS: ["br", "b", "i", "u", "a", "span", "p", "img", "center"],
  });
}

const anchormeOptions = {
  // force target _blank attribute
  attributes: {
    target: "_blank",
  },
  // force https protocol except email
  protocol: function (s) {
    if (anchorme.validate.email(s)) {
      return "mailto:";
    } else {
      return "https://";
    }
  },
};

function ConnectDialog() {
  var self = this;
  self.address = ko.observable("");
  self.port = ko.observable("");
  self.username = ko.observable("");
  self.password = ko.observable("");
  self.visible = ko.observable(true);
  self.show = self.visible.bind(self.visible, true);
  self.hide = self.visible.bind(self.visible, false);
  self.connect = function () {
    self.hide();
    if (ui.detectWebRTC) {
      ui.webrtc = true;
    }
    ui.connect(self.address(), self.port(), self.username(), self.password());
  };
}

function ConnectErrorDialog(connectDialog) {
  var self = this;
  self.type = ko.observable(0);
  self.reason = ko.observable("");
  self.username = connectDialog.username;
  self.password = connectDialog.password;
  self.visible = ko.observable(false);
  self.show = self.visible.bind(self.visible, true);
  self.hide = self.visible.bind(self.visible, false);
  self.connect = () => {
    self.hide();
    connectDialog.connect();
  };
}

class ConnectionInfo {
  constructor(ui) {
    this._ui = ui;
    this.visible = ko.observable(false);
    this.serverVersion = ko.observable();
    this.latencyMs = ko.observable(NaN);
    this.latencyDeviation = ko.observable(NaN);
    this.remoteHost = ko.observable();
    this.remotePort = ko.observable();
    this.maxBitrate = ko.observable(NaN);
    this.currentBitrate = ko.observable(NaN);
    this.maxBandwidth = ko.observable(NaN);
    this.currentBandwidth = ko.observable(NaN);
    this.codec = ko.observable();

    this.show = () => {
      this.update();
      this.visible(true);
    };
    this.hide = () => this.visible(false);
  }

  update() {
    let client = this._ui.client;

    this.serverVersion(client.serverVersion);

    let dataStats = client.dataStats;
    if (dataStats) {
      this.latencyMs(dataStats.mean);
      this.latencyDeviation(Math.sqrt(dataStats.variance));
    }
    this.remoteHost(this._ui.remoteHost());
    this.remotePort(this._ui.remotePort());

    let spp = this._ui.settings.samplesPerPacket;
    let maxBitrate = client.getMaxBitrate(spp, false);
    let maxBandwidth = client.maxBandwidth;
    let actualBitrate = client.getActualBitrate(spp, false);
    let actualBandwidth = MumbleClient.calcEnforcableBandwidth(
      actualBitrate,
      spp,
      false
    );
    this.maxBitrate(maxBitrate);
    this.currentBitrate(actualBitrate);
    this.maxBandwidth(maxBandwidth);
    this.currentBandwidth(actualBandwidth);
    this.codec("Opus"); // only one supported for sending
  }
}

class SettingsDialog {
  constructor(settings) {
    this.voiceMode = ko.observable(settings.voiceMode);
    this.pttKey = ko.observable(settings.pttKey);
    this.pttKeyDisplay = ko.observable(settings.pttKey);
    this.userCountInChannelName = ko.observable(
      settings.userCountInChannelName()
    );
    // Need to wrap this in a pureComputed to make sure it's always numeric
    let audioBitrate = ko.observable(settings.audioBitrate);
    this.audioBitrate = ko.pureComputed({
      read: audioBitrate,
      write: (value) => audioBitrate(Number(value)),
    });
    this.samplesPerPacket = ko.observable(settings.samplesPerPacket);
    this.msPerPacket = ko.pureComputed({
      read: () => this.samplesPerPacket() / 48,
      write: (value) => this.samplesPerPacket(value * 48),
    });
  }

  applyTo(settings) {
    settings.voiceMode = this.voiceMode();
    settings.pttKey = this.pttKey();
    settings.userCountInChannelName(this.userCountInChannelName());
    settings.audioBitrate = this.audioBitrate();
    settings.samplesPerPacket = this.samplesPerPacket();
  }

  end() {
    testVoiceHandler = null;
  }

  recordPttKey() {
    var combo = [];
    const keydown = (e) => {
      combo = e.pressedKeys;
      let comboStr = combo.join(" + ");
      this.pttKeyDisplay("> " + comboStr + " <");
    };
    const keyup = () => {
      keyboardjs.unbind("", keydown, keyup);
      let comboStr = combo.join(" + ");
      if (comboStr) {
        this.pttKey(comboStr).pttKeyDisplay(comboStr);
      } else {
        this.pttKeyDisplay(this.pttKey());
      }
    };
    keyboardjs.bind("", keydown, keyup);
    this.pttKeyDisplay("> ? <");
  }

  totalBandwidth() {
    return MumbleClient.calcEnforcableBandwidth(
      this.audioBitrate(),
      this.samplesPerPacket(),
      true
    );
  }

  positionBandwidth() {
    return (
      this.totalBandwidth() -
      MumbleClient.calcEnforcableBandwidth(
        this.audioBitrate(),
        this.samplesPerPacket(),
        false
      )
    );
  }

  overheadBandwidth() {
    return MumbleClient.calcEnforcableBandwidth(
      0,
      this.samplesPerPacket(),
      false
    );
  }
}

class Settings {
  constructor(defaults) {
    const load = (key) => window.localStorage.getItem("mumble." + key);
    this.voiceMode = load("voiceMode") || defaults.voiceMode;
    this.pttKey = load("pttKey") || defaults.pttKey;
    this.toolbarVertical = load("toolbarVertical") || defaults.toolbarVertical;
    this.userCountInChannelName = ko.observable(
      load("userCountInChannelName") || defaults.userCountInChannelName
    );
    this.audioBitrate = Number(load("audioBitrate")) || defaults.audioBitrate;
    this.samplesPerPacket =
      Number(load("samplesPerPacket")) || defaults.samplesPerPacket;
  }

  save() {
    const save = (key, val) =>
      window.localStorage.setItem("mumble." + key, val);
    save("voiceMode", this.voiceMode);
    save("pttKey", this.pttKey);
    save("toolbarVertical", this.toolbarVertical);
    save("userCountInChannelName", this.userCountInChannelName());
    save("audioBitrate", this.audioBitrate);
    save("samplesPerPacket", this.samplesPerPacket);
  }
}

class GlobalBindings {
  constructor(config) {
    this.config = config;
    this.settings = new Settings(config.settings);
    this.client = null;
    this.netlifyIdentity = require("netlify-identity-widget");
    this.connectDialog = new ConnectDialog();
    this.connectErrorDialog = new ConnectErrorDialog(this.connectDialog);
    this.connectionInfo = new ConnectionInfo(this);
    this.guacamoleFrame = new GuacamoleFrame();
    this.settingsDialog = ko.observable();
    this.detectWebRTC = true;
    this.webrtc = true;
    this.fallbackConnector = new WorkerBasedMumbleConnector();
    this.webrtcConnector = { connect: mumbleConnect };
    this.log = ko.observableArray();
    this.remoteHost = ko.observable();
    this.remotePort = ko.observable();
    this.thisUser = ko.observable();
    this.root = ko.observable();
    this.messageBox = ko.observable("");
    this.toolbarHorizontal = ko.observable(!this.settings.toolbarVertical);
    this.selected = ko.observable();
    this.selfMute = ko.observable(this.config.defaults.startMute);
    this.selfDeaf = ko.observable(this.config.defaults.startDeaf);
    this.audioContext = getAudioContext({ latencyHint: "interactive" });
    this.avatarView = ko.observable();

    this.selfMute.subscribe((mute) => {
      if (voiceHandler) {
        voiceHandler.setMute(mute);
      }
    });

    this.submitOnEnter = function (data, e) {
      if (e.which == 13 && !e.shiftKey) {
        this.submitMessageBox();
        return false;
      }
      return true;
    };

    this.select = (element) => {
      this.selected(element);
    };

    this.openSettings = () => {
      this.settingsDialog(new SettingsDialog(this.settings));
    };

    this.applySettings = () => {
      const settingsDialog = this.settingsDialog();

      settingsDialog.applyTo(this.settings);

      this._updateVoiceHandler();

      this.settings.save();
      this.closeSettings();
    };

    this.closeSettings = () => {
      if (this.settingsDialog()) {
        this.settingsDialog().end();
      }
      this.settingsDialog(null);
    };

    this.getTimeString = () => {
      return "[" + new Date().toLocaleTimeString(navigator.language) + "]";
    };

    this.connect = (
      host,
      port,
      username,
      password,
      tokens = [],
      channelName = ""
    ) => {
      var user_roles = this.netlifyIdentity.currentUser().app_metadata.roles;
      if (
        user_roles !== undefined &&
        (user_roles.includes("listen") || user_roles.includes("speak"))
      ) {
        if (this.audioContext.sampleRate == 48000) {
          initVoice(
            (data) => {
              if (testVoiceHandler) {
                testVoiceHandler.write(data);
              }
              if (!ui.client) {
                if (voiceHandler) {
                  voiceHandler.end();
                }
                voiceHandler = null;
              } else if (voiceHandler) {
                voiceHandler.write(data);
              }
            },
            (err) => {
              log(translate("logentry.mic_init_error"), err);
            }
          );

          // if browser support Notification request permission
          if ("Notification" in window) Notification.requestPermission();

          this.resetClient();

          this.remoteHost(host);
          this.remotePort(port);

          log(translate("logentry.connecting"), host);

          this.audioContext.resume();

          if (!this._delayedMicNode) {
            this._micNode = this.audioContext.createMediaStreamSource(
              this._micStream
            );
            this._delayNode = this.audioContext.createDelay();
            this._delayNode.delayTime.value = 0.15;
            this._delayedMicNode =
              this.audioContext.createMediaStreamDestination();
          }

          // TODO: token
          (this.webrtc ? this.webrtcConnector : this.fallbackConnector)
            .connect(`wss://${host}:${port}`, {
              username: username,
              password: password,
              webrtc: this.webrtc
                ? {
                    enabled: true,
                    required: true,
                    mic: this._delayedMicNode.stream,
                    audioContext: ctx,
                  }
                : {
                    enabled: false,
                  },
              tokens: tokens,
            })
            .done(
              (client) => {
                log(translate("logentry.connected"));

                this.client = client;
                // Prepare for connection errors
                client.on("error", (err) => {
                  log(translate("logentry.connection_error"), err);
                  this.resetClient();
                });

                // Register all channels, recursively
                if (channelName.indexOf("/") != 0) {
                  channelName = "/" + channelName;
                }
                const registerChannel = (channel, channelPath) => {
                  this._newChannel(channel);
                  if (channelPath === channelName) {
                    client.self.setChannel(channel);
                  }
                  channel.children.forEach((ch) =>
                    registerChannel(ch, channelPath + "/" + ch.name)
                  );
                };
                registerChannel(client.root, "");

                // Register all users
                client.users.forEach((user) => this._newUser(user));

                // Register future channels
                client.on("newChannel", (channel) => this._newChannel(channel));
                // Register future users
                client.on("newUser", (user) => this._newUser(user));

                // Handle messages
                client.on(
                  "message",
                  (sender, message, users, channels, trees) => {
                    sender = sender || { __ui: "Server" };
                    ui.log.push({
                      type: "chat-message",
                      user: sender.__ui,
                      channel: channels.length > 0,
                      message: anchorme({
                        input: sanitize(message),
                        options: anchormeOptions,
                      }),
                    });
                  }
                );

                // Log permission denied error messages
                client.on("denied", (type) => {
                  ui.log.push({
                    type: "generic",
                    value: "Permission denied : " + type,
                  });
                });

                // Set own user and root channel
                this.thisUser(client.self.__ui);
                this.root(client.root.__ui);
                // Upate linked channels
                this._updateLinks();
                // Log welcome message
                if (client.welcomeMessage) {
                  this.log.push({
                    type: "welcome-message",
                    message: sanitize(client.welcomeMessage),
                  });
                }

                // Startup audio input processing
                this._updateVoiceHandler();
                // Tell server our mute/deaf state (if necessary)
                if (this.selfDeaf()) {
                  this.client.setSelfDeaf(true);
                } else if (this.selfMute()) {
                  this.client.setSelfMute(true);
                }
              },
              (err) => {
                if (err.$type && err.$type.name === "Reject") {
                  this.connectErrorDialog.type(err.type);
                  this.connectErrorDialog.reason(err.reason);
                  this.connectErrorDialog.show();
                } else if (
                  err === "server_does_not_support_webrtc" &&
                  this.detectWebRTC &&
                  this.webrtc
                ) {
                  log(translate("logentry.connection_fallback_mode"));
                  this.webrtc = false;
                  this.connect(
                    username,
                    host,
                    port,
                    tokens,
                    password,
                    channelName
                  );
                } else {
                  log(translate("logentry.connection_error"), err);
                }
              }
            );
        } else {
          alert(
            "Please set the sample rate of your audio devices to 48 kHz on system level in order to proceed."
          );
        }
      } else {
        alert(
          "You do not have permission to connect to the server. Please contact the administrator."
        );
      }
    };

    this._newUser = (user) => {
      const simpleProperties = {
        uniqueId: "uid",
        username: "name",
        mute: "mute",
        deaf: "deaf",
        suppress: "suppress",
        selfMute: "selfMute",
        selfDeaf: "selfDeaf",
        texture: "rawTexture",
        textureHash: "textureHash",
        comment: "comment",
      };
      var ui = (user.__ui = {
        model: user,
        talking: ko.observable("off"),
        channel: ko.observable(),
      });
      ui.texture = ko.pureComputed(() => {
        let raw = ui.rawTexture();
        if (!raw || raw.offset >= raw.limit) return null;
        return "data:image/*;base64," + ByteBuffer.wrap(raw).toBase64();
      });
      ui.show_avatar = () => {
        let setting = this.settings.showAvatars();
        switch (setting) {
          case "always":
            break;
          case "own_channel":
            if (this.thisUser().channel() !== ui.channel()) return false;
            break;
          case "linked_channel":
            if (!ui.channel().linked()) return false;
            break;
          case "never":
          default:
            return false;
        }
        if (!ui.texture()) {
          if (ui.textureHash()) {
            // The user has an avatar set but it's of sufficient size to not be
            // included by default, so we need to fetch it explicitly now.
            // mumble-client should make sure we only send one request per hash
            user.requestTexture();
          }
          return false;
        }
        return true;
      };
      ui.openContextMenu = (_, event) =>
        openContextMenu(event, this.userContextMenu, ui);
      ui.canChangeMute = () => {
        return false; // TODO check for perms and implement
      };
      ui.canChangeDeafen = () => {
        return false; // TODO check for perms and implement
      };
      ui.canChangePrioritySpeaker = () => {
        return false; // TODO check for perms and implement
      };
      ui.canLocalMute = () => {
        return false; // TODO implement local mute
        // return this.thisUser() !== ui
      };
      ui.canIgnoreMessages = () => {
        return false; // TODO implement ignore messages
        // return this.thisUser() !== ui
      };
      ui.canChangeComment = () => {
        return false; // TODO implement changing of comments
        // return this.thisUser() === ui // TODO check for perms
      };
      ui.canChangeAvatar = () => {
        return this.thisUser() === ui; // TODO check for perms
      };
      ui.toggleMute = () => {
        if (ui.selfMute()) {
          this.requestUnmute(ui);
        } else {
          this.requestMute(ui);
        }
      };
      ui.toggleDeaf = () => {
        if (ui.selfDeaf()) {
          this.requestUndeaf(ui);
        } else {
          this.requestDeaf(ui);
        }
      };
      ui.viewAvatar = () => {
        this.avatarView(ui.texture());
      };
      ui.changeAvatar = () => {
        let input = document.createElement("input");
        input.type = "file";
        input.addEventListener("change", () => {
          let reader = new window.FileReader();
          reader.onload = () => {
            this.client.setSelfTexture(reader.result);
          };
          reader.readAsArrayBuffer(input.files[0]);
        });
        input.click();
      };
      ui.removeAvatar = () => {
        user.clearTexture();
      };
      Object.entries(simpleProperties).forEach((key) => {
        ui[key[1]] = ko.observable(user[key[0]]);
      });
      ui.state = ko.pureComputed(userToState, ui);
      if (user.channel) {
        ui.channel(user.channel.__ui);
        ui.channel().users.push(ui);
        ui.channel().users.sort(compareUsers);
      }

      user
        .on("update", (actor, properties) => {
          Object.entries(simpleProperties).forEach((key) => {
            if (properties[key[0]] !== undefined) {
              ui[key[1]](properties[key[0]]);
            }
          });
          if (properties.channel !== undefined) {
            if (ui.channel()) {
              ui.channel().users.remove(ui);
            }
            ui.channel(properties.channel.__ui);
            ui.channel().users.push(ui);
            ui.channel().users.sort(compareUsers);
            this._updateLinks();
          }
          if (properties.textureHash !== undefined) {
            // Invalidate avatar texture when its hash has changed
            // If the avatar is still visible, this will trigger a fetch of the new one.
            ui.rawTexture(null);
          }
        })
        .on("remove", () => {
          if (ui.channel()) {
            ui.channel().users.remove(ui);
          }
        })
        .on("voice", (stream) => {
          console.log(`User ${user.username} started takling`);
          let userNode;
          if (!this.webrtc) {
            userNode = new BufferQueueNode({
              audioContext: audioContext(),
            });
            userNode.connect(audioContext().destination);
          }
          if (stream.target === "normal") {
            ui.talking("on");
          } else if (stream.target === "shout") {
            ui.talking("shout");
          } else if (stream.target === "whisper") {
            ui.talking("whisper");
          }
          stream
            .on("data", (data) => {
              if (this.webrtc) {
                // mumble-client is in WebRTC mode, no pcm data should arrive this way
              } else {
                userNode.write(data.buffer);
              }
            })
            .on("end", () => {
              console.log(`User ${user.username} stopped takling`);
              ui.talking("off");
              if (!this.webrtc) {
                userNode.end();
              }
            });
        });
    };

    this._newChannel = (channel) => {
      const simpleProperties = {
        position: "position",
        name: "name",
        description: "description",
      };
      var ui = (channel.__ui = {
        model: channel,
        expanded: ko.observable(true),
        parent: ko.observable(),
        channels: ko.observableArray(),
        users: ko.observableArray(),
        linked: ko.observable(false),
      });
      ui.userCount = () => {
        return ui
          .channels()
          .reduce((acc, c) => acc + c.userCount(), ui.users().length);
      };
      ui.openContextMenu = (_, event) =>
        openContextMenu(event, this.channelContextMenu, ui);
      ui.canJoin = () => {
        return true; // TODO check for perms
      };
      ui.canAdd = () => {
        return true; // TODO check for perms
      };
      ui.canEdit = () => {
        return false; // TODO check for perms and implement
      };
      ui.canRemove = () => {
        return true; // TODO check for perms
      };
      ui.canLink = () => {
        return false; // TODO check for perms and implement
      };
      ui.canUnlink = () => {
        return false; // TODO check for perms and implement
      };
      ui.canSendMessage = () => {
        return false; // TODO check for perms and implement
      };
      Object.entries(simpleProperties).forEach((key) => {
        ui[key[1]] = ko.observable(channel[key[0]]);
      });
      if (channel.parent) {
        ui.parent(channel.parent.__ui);
        ui.parent().channels.push(ui);
        ui.parent().channels.sort(compareChannels);
      }
      this._updateLinks();

      channel
        .on("update", (properties) => {
          Object.entries(simpleProperties).forEach((key) => {
            if (properties[key[0]] !== undefined) {
              ui[key[1]](properties[key[0]]);
            }
          });
          if (properties.parent !== undefined) {
            if (ui.parent()) {
              ui.parent().channel.remove(ui);
            }
            ui.parent(properties.parent.__ui);
            ui.parent().channels.push(ui);
            ui.parent().channels.sort(compareChannels);
          }
          if (properties.links !== undefined) {
            this._updateLinks();
          }
        })
        .on("remove", () => {
          if (ui.parent()) {
            ui.parent().channels.remove(ui);
          }
          this._updateLinks();
        });
    };

    this.resetClient = () => {
      if (this.client) {
        this.client.disconnect();
      }
      this.client = null;
      this.selected(null).root(null).thisUser(null);
    };

    this.connected = () => this.thisUser() != null;

    this._updateVoiceHandler = () => {
      if (!this.client) {
        return;
      }
      if (voiceHandler) {
        voiceHandler.end();
        voiceHandler = null;
      }
      let mode = this.settings.voiceMode;
      if (mode === "cont") {
        voiceHandler = new ContinuousVoiceHandler(this.client, this.settings);
      } else if (mode === "ptt") {
        voiceHandler = new PushToTalkVoiceHandler(this.client, this.settings);
      } else {
        log(translate("logentry.unknown_voice_mode"), mode);
        return;
      }
      voiceHandler.on("started_talking", () => {
        if (this.thisUser()) {
          this.thisUser().talking("on");
        }
      });
      voiceHandler.on("stopped_talking", () => {
        if (this.thisUser()) {
          this.thisUser().talking("off");
        }
      });
      if (this.selfMute()) {
        voiceHandler.setMute(true);
      }

      this._micNode.disconnect();
      this._delayNode.disconnect();
      this._micNode.connect(this._delayedMicNode);

      this.client.setAudioQuality(
        this.settings.audioBitrate,
        this.settings.samplesPerPacket
      );
    };

    this.messageBoxHint = ko.pureComputed(() => {
      if (!this.thisUser()) {
        return ""; // Not yet connected
      }
      var target = this.selected();
      if (!target) {
        target = this.thisUser();
      }
      if (target === this.thisUser()) {
        target = target.channel();
      }
      if (target.users) {
        // Channel
        return translate("chat.channel_message_placeholder").replace(
          "%1",
          target.name()
        );
      } else {
        // User
        return translate("chat.user_message_placeholder").replace(
          "%1",
          target.name()
        );
      }
    });

    this.submitMessageBox = () => {
      this.sendMessage(this.selected(), this.messageBox());
      this.messageBox("");
    };

    this.mailToDesktop = ko.observable(
      "mailto:mail@" +
        window.location.hostname +
        "?subject=Send%20attachment%20to%20desktop"
    );

    this.sendMessage = (target, message) => {
      if (this.connected()) {
        // If no target is selected, choose our own user
        if (!target) {
          target = this.thisUser();
        }
        // If target is our own user, send to our channel
        if (target === this.thisUser()) {
          target = target.channel();
        }
        // Avoid blank message
        if (sanitize(message).trim().length == 0) return;
        // Support multiline
        message = message.replace(/\n\n+/g, "\n\n");
        message = message.replace(/\n/g, "<br>");
        // Send message
        target.model.sendMessage(anchorme(message));
        if (target.users) {
          // Channel
          this.log.push({
            type: "chat-message-self",
            message: anchorme({
              input: sanitize(message),
              options: anchormeOptions,
            }),
            channel: target,
          });
        } else {
          // User
          this.log.push({
            type: "chat-message-self",
            message: anchorme({
              input: sanitize(message),
              options: anchormeOptions,
            }),
            user: target,
          });
        }
      }
    };

    this.requestMute = (user) => {
      if (user === this.thisUser()) {
        this.selfMute(true);
      }
      if (this.connected()) {
        if (user === this.thisUser()) {
          this.client.setSelfMute(true);
        } else {
          user.model.setMute(true);
        }
      }
    };

    this.requestDeaf = (user) => {
      if (user === this.thisUser()) {
        this.selfMute(true);
        this.selfDeaf(true);
      }
      if (this.connected()) {
        if (user === this.thisUser()) {
          this.client.setSelfDeaf(true);
        } else {
          user.model.setDeaf(true);
        }
      }
    };

    this.requestUnmute = (user) => {
      if (user === this.thisUser()) {
        this.selfMute(false);
        this.selfDeaf(false);
      }
      if (this.connected()) {
        if (user === this.thisUser()) {
          this.client.setSelfMute(false);
        } else {
          user.model.setMute(false);
        }
      }
    };

    this.requestUndeaf = (user) => {
      if (user === this.thisUser()) {
        this.selfDeaf(false);
      }
      if (this.connected()) {
        if (user === this.thisUser()) {
          this.client.setSelfDeaf(false);
        } else {
          user.model.setDeaf(false);
        }
      }
    };

    this._updateLinks = () => {
      if (!this.thisUser()) {
        return;
      }

      var allChannels = getAllChannels(this.root(), []);
      var ownChannel = this.thisUser().channel().model;
      var allLinked = findLinks(ownChannel, []);
      allChannels.forEach((channel) => {
        channel.linked(allLinked.indexOf(channel.model) !== -1);
      });

      function findLinks(channel, knownLinks) {
        knownLinks.push(channel);
        channel.links.forEach((next) => {
          if (next && knownLinks.indexOf(next) === -1) {
            findLinks(next, knownLinks);
          }
        });
        allChannels
          .map((c) => c.model)
          .forEach((next) => {
            if (
              next &&
              knownLinks.indexOf(next) === -1 &&
              next.links.indexOf(channel) !== -1
            ) {
              findLinks(next, knownLinks);
            }
          });
        return knownLinks;
      }

      function getAllChannels(channel, channels) {
        channels.push(channel);
        channel.channels().forEach((next) => getAllChannels(next, channels));
        return channels;
      }
    };

    this.openSourceCode = () => {
      var homepage = require("../package.json").homepage;
      window.open(homepage, "_blank").focus();
    };
  }
}
var ui = new GlobalBindings(window.mumbleWebConfig);

// Used only for debugging
window.mumbleUi = ui;

function initializeUI() {
  ui.netlifyIdentity.init({
    APIUrl: "https://flexpair.com/.netlify/identity", // Absolute url to endpoint.
    locale: navigator.language.substring(0, 2),
  });

  var user = ui.netlifyIdentity.currentUser();

  ui.netlifyIdentity.on("login", (user) => {
    console.log("login", user);
    ui.connectDialog.username(
      user.user_metadata.full_name.replace(/[\s]+/g, "_")
    );
    ui.netlifyIdentity.close();
  });

  ui.netlifyIdentity.on("close", () => {
    if (!ui.connectDialog.username()) {
      ui.netlifyIdentity.open("login"); // open the modal to the login tab
    }
  });

  if (user == null) {
    ui.netlifyIdentity.open("signup"); // open the modal to the signup tab
  } else {
    ui.connectDialog.username(
      user.user_metadata.full_name.replace(/[\s]+/g, "_")
    );
  }
  var queryParams = url.parse(document.location.href, true).query;
  queryParams = Object.assign({}, window.mumbleWebConfig.defaults, queryParams);
  if (queryParams.address) {
    ui.connectDialog.address(queryParams.address);
  }
  if (queryParams.port) {
    ui.connectDialog.port(queryParams.port);
  }
  if (queryParams.password) {
    ui.connectDialog.password(queryParams.password);
  }
  if (queryParams.webrtc !== "auto") {
    ui.detectWebRTC = false;
    if (queryParams.webrtc == "false") {
      ui.webrtc = false;
    }
  }
  if (queryParams.avatarurl) {
    // Download the avatar and upload it to the mumble server when connected
    let url = queryParams.avatarurl;
    console.log("Fetching avatar from", url);
    let req = new window.XMLHttpRequest();
    req.open("GET", url, true);
    req.responseType = "arraybuffer";
    req.onload = () => {
      let upload = (avatar) => {
        if (req.response) {
          console.log("Uploading user avatar to server");
          ui.client.setSelfTexture(req.response);
        }
      };
      // On any future connections
      ui.thisUser.subscribe((thisUser) => {
        if (thisUser) {
          upload();
        }
      });
      // And the current one (if already connected)
      if (ui.thisUser()) {
        upload();
      }
    };
    req.send();
  }
  ko.applyBindings(ui);
}

function log() {
  console.log.apply(console, arguments);
  var args = [];
  for (var i = 0; i < arguments.length; i++) {
    args.push(arguments[i]);
  }
  ui.log.push({
    type: "generic",
    value: args.join(" "),
  });
}

function compareChannels(c1, c2) {
  if (c1.position() === c2.position()) {
    return c1.name() === c2.name() ? 0 : c1.name() < c2.name() ? -1 : 1;
  }
  return c1.position() - c2.position();
}

function compareUsers(u1, u2) {
  return u1.name() === u2.name() ? 0 : u1.name() < u2.name() ? -1 : 1;
}

function userToState() {
  var flags = [];
  // TODO: Friend
  if (this.uid()) {
    flags.push("Authenticated");
  }
  if (this.mute()) {
    flags.push("Muted (server)");
  }
  if (this.deaf()) {
    flags.push("Deafened (server)");
  }
  if (this.selfMute()) {
    flags.push("Muted (self)");
  }
  if (this.selfDeaf()) {
    flags.push("Deafened (self)");
  }
  return flags.join(", ");
}

var voiceHandler;
var testVoiceHandler;

async function main() {
  document.title = window.location.hostname;
  await localizationInitialize(navigator.language);
  translateEverything();

  try {
    const userMedia = await initVoice((data) => {
      if (testVoiceHandler) {
        testVoiceHandler.write(data);
      }
      if (!ui.client) {
        if (voiceHandler) {
          voiceHandler.end();
        }
        voiceHandler = null;
      } else if (voiceHandler) {
        voiceHandler.write(data);
      }
    });
    ui._micStream = userMedia;
  } catch (err) {
    window.alert(
      "Failed to initialize user media\nRefresh page to retry.\n" + err
    );
    return;
  }
  initializeUI();
  enumMicrophones();
}
window.onload = main;
