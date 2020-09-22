// You can overwrite the default configuration values set in [config.js] here.
// There should never be any required changes to this file and you can always
// simply copy it over when updating to a new version.

let config = window.mumbleWebConfig // eslint-disable-line no-unused-vars

config.connectDialog.address = false
config.connectDialog.port = false
config.connectDialog.token = false

config.settings.toolbarVertical = false
config.settings.audioBitrate = 96000
config.settings.voiceMode = 'cont'

config.defaults.port = '443/murmur'

