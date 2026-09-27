// =================================================================
//  Admin interface language — pre-paint bootstrap  (milestone 1T.1)
//
//  Loaded synchronously in <head> (render-blocking, so it runs before the
//  first paint). The static Admin markup is authored in English; when the
//  saved Admin language is Arabic, <body> is hidden (admin.css:
//  html.admin-i18n-boot) until js/i18n.js has translated it — which removes
//  the class. English saved → nothing is hidden, behaviour unchanged.
//
//  Fail-safe: the class is removed after BOOT_MAX_MS no matter what, so a
//  failed/slow i18n.js can at worst show English — never a blank Admin.
//  Never sets dir="rtl" on the document (layout stays LTR, per 1T).
// =================================================================
(function () {
  'use strict';
  var BOOT_MAX_MS = 1500;
  var lang = 'en';
  try {
    var o = JSON.parse(localStorage.getItem('ttw_admin_ui') || '{}');
    if (o && o.adminLang === 'ar') lang = 'ar';
  } catch (e) { /* storage unavailable / bad JSON → English */ }

  var html = document.documentElement;
  html.setAttribute('lang', lang);
  html.setAttribute('data-admin-lang', lang);
  if (lang !== 'ar') return;

  html.classList.add('admin-i18n-boot');
  setTimeout(function () { html.classList.remove('admin-i18n-boot'); }, BOOT_MAX_MS);
})();
