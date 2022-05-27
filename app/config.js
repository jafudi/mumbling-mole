// Note: You probably do not want to change any values in here because this
//       file might need to be updated with new default values for new
//       configuration options. Use the [config.local.js] file instead!

window.mumbleWebConfig = {
  // Which fields to show on the Connect to Server dialog
  connectDialog: {
    address: false,
    port: false,
    token: false,
    username: true,
    password: true,
    channelName: false,
  },
  // Default values for user settings
  // You can see your current value by typing `localStorage.getItem('mumble.$setting')` in the web console.
  settings: {
    voiceMode: "cont", // one of 'cont' (Continuous), 'ptt' (Push-to-Talk)
    pttKey: "ctrl + shift",
    toolbarVertical: false,
    userCountInChannelName: false,
    audioBitrate: 40000, // bits per second
    samplesPerPacket: 960,
  },
  // Default values (can be changed by passing a query parameter of the same name)
  defaults: {
    // Connect Dialog
    address: window.location.hostname,
    port: "443/murmur",
    username: "",
    password: "",
    webrtc: "auto", // whether to enable (true), disable (false) or auto-detect ('auto') WebRTC support
    // General
    theme: "MetroMumbleLight",
    startMute: false,
    startDeaf: false,
  },
};
