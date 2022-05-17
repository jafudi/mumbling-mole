/**
 * the default language to use
 *
 * @var {string}
 * @author svartoyg
 */
var _languageDefault = null;

/**
 * the fallback language to use
 *
 * @var {string}
 * @author svartoyg
 */
var _languageFallback = null;

/**
 * two level map with ISO-639-1 code as first key and translation id as second key
 *
 * @var {Map<string,Map<string,string>>}
 * @author svartoyg
 */
var _data = {};

/**
 * @param {string} language
 * @return Promise<Map<string,string>>
 * @author svartoyg
 */
async function retrieveData(language) {
  let json;
  try {
    json = (await import(`../localize/${language}.json`)).default;
  } catch (exception) {
    json = (
      await import(
        `../localize/${language.substr(0, language.indexOf("-"))}.json`
      )
    ).default;
  }
  const map = {};
  flatten(json, "", map);
  return map;
}

function flatten(tree, prefix, result) {
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") {
      result[prefix + key] = value;
    } else {
      flatten(value, prefix + key + ".", result);
    }
  }
}

/**
 * @param {string} languageDefault
 * @param {string} [languageFallback]
 * @author svartoyg
 */
export async function initialize(languageDefault, languageFallback = "en") {
  _languageFallback = languageFallback;
  _languageDefault = languageDefault;
  for (const language of [_languageFallback, _languageDefault]) {
    if (_data.hasOwnProperty(language)) continue;
    let data;
    try {
      data = await retrieveData(language);
    } catch (exception) {
      console.warn(exception.toString());
    }
    _data[language] = data;
  }
}

/**
 * gets a translation by its key for a specific language
 *
 * @param {string} key
 * @param {string} [languageChosen]
 * @return {string}
 * @author svartoyg
 */
export function translate(key, languageChosen = _languageDefault) {
  let result = undefined;
  for (const language of [languageChosen, _languageFallback]) {
    if (
      _data.hasOwnProperty(language) &&
      _data[language] !== undefined &&
      _data[language].hasOwnProperty(key)
    ) {
      result = _data[language][key];
      break;
    }
  }
  if (result === undefined) {
    result = "{{" + key + "}}";
  }
  return result;
}

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
      case "textcontent":
        element.textContent = translation;
        break;
      case "attribute":
        element.setAttribute(parameters.name || "value", translation);
        break;
    }
  } else {
    console.warn(
      `translation selector "${selector}" for "${key}" did not match any element`
    );
  }
}

/**
 * @author svartoyg
 */
export function translateEverything() {
  translatePiece(
    "#connect-dialog_title",
    "textcontent",
    {},
    "connectdialog.title"
  );
  translatePiece(
    "#connect-dialog_input_username",
    "textcontent",
    {},
    "connectdialog.username"
  );
  translatePiece(
    "#connect-dialog_input_password",
    "textcontent",
    {},
    "connectdialog.password"
  );
  translatePiece(
    "#connect-dialog_select_microphone",
    "textcontent",
    {},
    "connectdialog.microphone"
  );
  translatePiece(
    "#connect-dialog_headphones",
    "textcontent",
    {},
    "connectdialog.headphones"
  );
  translatePiece(
    "#connect-dialog_controls_connect",
    "attribute",
    { name: "value" },
    "connectdialog.connect"
  );
  translatePiece(
    ".connect-dialog.error-dialog .dialog-header",
    "textcontent",
    {},
    "connectdialog.error.title"
  );
  translatePiece(
    ".connect-dialog.error-dialog .reason .refused",
    "textcontent",
    {},
    "connectdialog.error.reason.refused"
  );
  translatePiece(
    ".connect-dialog.error-dialog .reason .version",
    "textcontent",
    {},
    "connectdialog.error.reason.version"
  );
  translatePiece(
    ".connect-dialog.error-dialog .reason .username",
    "textcontent",
    {},
    "connectdialog.error.reason.username"
  );
  translatePiece(
    ".connect-dialog.error-dialog .reason .userpassword",
    "textcontent",
    {},
    "connectdialog.error.reason.userpassword"
  );
  translatePiece(
    ".connect-dialog.error-dialog .reason .serverpassword",
    "textcontent",
    {},
    "connectdialog.error.reason.serverpassword"
  );
  translatePiece(
    ".connect-dialog.error-dialog .reason .username-in-use",
    "textcontent",
    {},
    "connectdialog.error.reason.username_in_use"
  );
  translatePiece(
    ".connect-dialog.error-dialog .reason .full",
    "textcontent",
    {},
    "connectdialog.error.reason.full"
  );
  translatePiece(
    ".connect-dialog.error-dialog .reason .clientcert",
    "textcontent",
    {},
    "connectdialog.error.reason.clientcert"
  );
  translatePiece(
    ".connect-dialog.error-dialog .reason .server",
    "textcontent",
    {},
    "connectdialog.error.reason.server"
  );
  translatePiece(
    ".connect-dialog.error-dialog .alternate-username",
    "textcontent",
    {},
    "connectdialog.username"
  );
  translatePiece(
    ".connect-dialog.error-dialog .alternate-password",
    "textcontent",
    {},
    "connectdialog.password"
  );
  translatePiece(
    ".connect-dialog.error-dialog .dialog-submit",
    "attribute",
    { name: "value" },
    "connectdialog.error.retry"
  );
  translatePiece(
    ".connect-dialog.error-dialog .dialog-close",
    "attribute",
    { name: "value" },
    "connectdialog.error.cancel"
  );

  translatePiece(
    "#connection-info_title",
    "textcontent",
    {},
    "connectinfo.title"
  );
  translatePiece(
    "#connection-info_server",
    "textcontent",
    {},
    "connectinfo.server"
  );
  translatePiece(
    "#connection-info_webapp",
    "textcontent",
    {},
    "connectinfo.webapp"
  );
  translatePiece(
    "#connection-info_native",
    "textcontent",
    {},
    "connectinfo.native"
  );

  translatePiece(
    "#settings-dialog_title",
    "textcontent",
    {},
    "settingsdialog.title"
  );
  translatePiece(
    "#settings-dialog_transmission",
    "textcontent",
    {},
    "settingsdialog.transmission"
  );
  translatePiece(
    "#settings-dialog_cont",
    "textcontent",
    {},
    "settingsdialog.cont"
  );
  translatePiece(
    "#settings-dialog_ptt",
    "textcontent",
    {},
    "settingsdialog.ptt"
  );
  translatePiece(
    "#settings-dialog_ptt_key",
    "textcontent",
    {},
    "settingsdialog.ptt_key"
  );
  translatePiece(
    "#settings-dialog_audio_quality",
    "textcontent",
    {},
    "settingsdialog.audio_quality"
  );
  translatePiece(
    "#settings-dialog_packet",
    "textcontent",
    {},
    "settingsdialog.packet"
  );
  translatePiece(
    "#settings-dialog_close",
    "attribute",
    { name: "value" },
    "settingsdialog.close"
  );
  translatePiece(
    "#settings-dialog_submit",
    "attribute",
    { name: "value" },
    "settingsdialog.submit"
  );
}
