import url from 'url'

var loadingTheme = require('../themes/MetroMumbleLight/loading.scss')
var mainTheme = require('../themes/MetroMumbleLight/main.scss')

function useStyle(url) {
  var style = document.createElement('link')
  style.rel = 'stylesheet'
  style.type = 'text/css'
  style.href = url
  document.getElementsByTagName('head')[0].appendChild(style)
}
useStyle(loadingTheme)
useStyle(mainTheme)
