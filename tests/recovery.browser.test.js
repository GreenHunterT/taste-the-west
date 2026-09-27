// Owner password recovery (milestone 1Y) — real-browser tests.
//
// Uses tests/fixtures/fake-auth.js in place of supabase-js (per page), so the
// flows run offline and every Supabase Auth call is recorded.
//
//   NODE_PATH=<dir with playwright-core>/node_modules node --test tests/recovery.browser.test.js
'use strict';

const test = require('node:test');
const { before, after } = test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startHarness } = require('./fixtures/harness');

const FAKE_AUTH = fs.readFileSync(path.join(__dirname, 'fixtures/fake-auth.js'), 'utf8');
const RECOVERY_HASH = '#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=recovery';

let H, ctx;
before(async () => { H = await startHarness(); });
after(async () => { if (H) await H.stop(); });

// A fresh page whose supabase-js is the fake, configured by `cfg`.
async function newPage(cfg, lang, width, cdnDelayMs) {
  if (ctx) await ctx.close();
  ctx = await H.newContext({ viewport: { width: width || 1440, height: 900 } });
  await ctx.addInitScript(([c, l]) => {
    window.__FAKE_AUTH = c;
    try { localStorage.setItem('ttw_admin_ui', JSON.stringify({ adminLang: l })); } catch (e) {}
  }, [cfg || {}, lang || 'en']);
  const p = await ctx.newPage();
  await p.route(/supabase-js/, async (r) => {
    if (cdnDelayMs) await new Promise((res) => setTimeout(res, cdnDelayMs));
    r.fulfill({ contentType: 'text/javascript', body: FAKE_AUTH });
  });
  p.__errors = [];
  p.on('pageerror', (e) => p.__errors.push(e.message));
  return p;
}
const calls = (p) => p.evaluate(() => window.__authCalls || []);
const shown = (p, sel) => p.$eval(sel, (e) => !e.hidden && getComputedStyle(e).display !== 'none');
async function openForgot(p, lang) {
  await p.goto(H.base + '/admin/login.html');
  await p.waitForSelector('#forgot-btn');
  await p.click('#forgot-btn');
  await p.waitForSelector('#recover-form:not([hidden])');
}

// ── A / K ───────────────────────────────────────────────────────────
test('A. "Forgot password?" on the login page in EN and AR', async () => {
  let p = await newPage({}, 'en');
  await p.goto(H.base + '/admin/login.html');
  assert.equal((await p.textContent('#forgot-btn')).trim(), 'Forgot password?');
  p = await newPage({}, 'ar');
  await p.goto(H.base + '/admin/login.html');
  await p.waitForSelector('#forgot-btn');
  assert.equal((await p.textContent('#forgot-btn')).trim(), 'نسيت كلمة المرور؟');
  assert.equal(await p.$eval('#forgot-btn', (e) => e.getAttribute('dir')), 'rtl');
});

test('K. Arabic first paint — login recovery + reset page never paint English', async () => {
  for (const [url, sel, en] of [
    ['/admin/login.html', '#forgot-btn', 'Forgot password?'],
    ['/admin/reset-password.html' + RECOVERY_HASH, '#reset-title', 'Choose a new password'],
  ]) {
    const p = await newPage({}, 'ar', 1440, 1200);   // slow CDN: the window where a flash would show
    await p.goto(H.base + url, { waitUntil: 'commit' });
    const seen = [];
    for (let i = 0; i < 20; i++) {
      seen.push(await p.evaluate(([s]) => {
        const el = document.querySelector(s);
        if (!el || !document.body) return 'no-dom';
        return getComputedStyle(document.body).visibility === 'visible' ? el.textContent.trim() : 'hidden';
      }, [sel]).catch(() => 'nav'));
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(!seen.includes(en), url + ' painted English: ' + seen.join(','));
    assert.ok(seen.some((x) => /[؀-ۿ]/.test(x)), url + ' shows Arabic early: ' + seen.join(','));
  }
});

// ── B / C / D + request errors ──────────────────────────────────────
test('B+D. request calls resetPasswordForEmail with the current-origin reset URL', async () => {
  const p = await newPage({});
  await openForgot(p);
  await p.fill('#recover-email', '  owner@example.com ');
  await p.click('#recover-btn');
  await p.waitForSelector('#recover-done:not([hidden])');
  const c = await calls(p);
  assert.deepEqual(c, [['resetPasswordForEmail', 'owner@example.com', { redirectTo: H.base + '/admin/reset-password.html' }]]);
  assert.ok(!/localhost/.test(JSON.stringify(c)) || H.base.includes('localhost'), 'origin-derived, never a hard-coded host');
});

test('C. the confirmation is identical whether or not Supabase reports a problem with the account', async () => {
  const neutral = 'If an account exists for that email, a password reset link has been sent.';
  let p = await newPage({});
  await openForgot(p);
  await p.fill('#recover-email', 'owner@example.com');
  await p.click('#recover-btn');
  await p.waitForSelector('#recover-done:not([hidden])');
  const okText = (await p.textContent('#recover-done')).replace(/\s+/g, ' ').trim();
  assert.match(okText, new RegExp(neutral.replace(/[.]/g, '\\.')));

  p = await newPage({ resetError: { status: 400, code: 'user_not_found', message: 'User not found' } });
  await openForgot(p);
  await p.fill('#recover-email', 'nobody@example.com');
  await p.click('#recover-btn');
  await p.waitForSelector('#recover-done:not([hidden])');
  assert.equal((await p.textContent('#recover-done')).replace(/\s+/g, ' ').trim(), okText, 'no account enumeration');
  assert.equal(await shown(p, '#recover-error'), false);
  assert.ok(!/User not found|user_not_found/.test(await p.textContent('body')), 'no raw Supabase error');
});

test('request errors: empty, invalid, rate limit, network — all translated, none raw', async () => {
  let p = await newPage({}, 'ar');
  await openForgot(p);
  await p.click('#recover-btn');
  assert.equal(await p.textContent('#recover-error'), 'يُرجى إدخال بريدك الإلكتروني.');
  assert.equal(await p.$eval('#recover-email', (e) => e.getAttribute('aria-invalid')), 'true');
  await p.fill('#recover-email', 'not-an-email');
  await p.click('#recover-btn');
  assert.equal(await p.textContent('#recover-error'), 'يُرجى إدخال بريد إلكتروني صحيح.');
  assert.deepEqual(await calls(p), [], 'nothing sent for invalid input');

  p = await newPage({ resetError: { status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } });
  await openForgot(p);
  await p.fill('#recover-email', 'owner@example.com');
  await p.click('#recover-btn');
  await p.waitForSelector('#recover-error:not([hidden])');
  assert.equal(await p.textContent('#recover-error'), 'Too many requests. Please wait a few minutes before trying again.');

  p = await newPage({ resetThrow: true });
  await openForgot(p);
  await p.fill('#recover-email', 'owner@example.com');
  await p.click('#recover-btn');
  await p.waitForSelector('#recover-error:not([hidden])');
  assert.equal(await p.textContent('#recover-error'), 'Could not connect. Check your internet connection and try again.');
  assert.equal(await p.$eval('#recover-btn', (b) => b.disabled), false, 'button usable again');
});

// ── E / F ───────────────────────────────────────────────────────────
test('E. a valid recovery link unlocks the form and the tokens leave the address bar', async () => {
  const p = await newPage({});
  await p.goto(H.base + '/admin/reset-password.html' + RECOVERY_HASH);
  await p.waitForSelector('#reset-form:not([hidden])');
  assert.equal(await shown(p, '#reset-invalid'), false);
  assert.equal(new URL(p.url()).hash, '', 'no access_token left in the URL');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'new-password');

  // A custom email template ({{ .TokenHash }}) works through verifyOtp.
  const p2 = await newPage({});
  await p2.goto(H.base + '/admin/reset-password.html?token_hash=th123&type=recovery');
  await p2.waitForSelector('#reset-form:not([hidden])');
  assert.deepEqual((await calls(p2))[0], ['verifyOtp', { token_hash: 'th123', type: 'recovery' }]);
});

test('F. missing / expired / used / non-recovery sessions never get the form', async () => {
  const cases = [
    ['no link, no session', '', {}],
    ['ordinary signed-in owner (not a recovery link)', '', { session: { user: { id: 'u1' } } }],
    ['expired link', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', {}],
    ['bad token_hash', '?token_hash=bad&type=recovery', { otpError: { status: 403, message: 'Token has expired or is invalid' } }],
  ];
  for (const [name, suffix, cfg] of cases) {
    const p = await newPage(cfg, 'en');
    await p.goto(H.base + '/admin/reset-password.html' + suffix);
    await p.waitForSelector('#reset-invalid:not([hidden])');
    assert.equal(await shown(p, '#reset-form'), false, name);
    assert.equal(await p.textContent('#reset-invalid h2'), 'Reset link expired or invalid', name);
    assert.equal(await p.$eval('#reset-invalid a.btn', (a) => a.getAttribute('href')), '/admin/login.html#forgot', name);
    assert.ok(!(await calls(p)).some((c) => c[0] === 'updateUser'), name + ': no password update possible');
    assert.ok(!/otp_expired|Token has expired/.test(await p.textContent('body')), name + ': no raw error');
  }
  // "Request another reset" opens the recovery panel directly.
  const p = await newPage({});
  await p.goto(H.base + '/admin/login.html#forgot');
  await p.waitForSelector('#recover-form:not([hidden])');
});

test('a recovery link that lands on the LOGIN page is forwarded to the reset page (never straight into Admin)', async () => {
  const p = await newPage({});
  await p.goto(H.base + '/admin/login.html' + RECOVERY_HASH);
  await p.waitForURL(/reset-password\.html/);
  await p.waitForSelector('#reset-form:not([hidden])');
});

// ── G / H / I / J ───────────────────────────────────────────────────
async function openValidReset(cfg, lang) {
  const p = await newPage(cfg || {}, lang);
  await p.goto(H.base + '/admin/reset-password.html' + RECOVERY_HASH);
  await p.waitForSelector('#reset-form:not([hidden])');
  return p;
}

test('G+H. mismatched and too-short passwords are rejected before calling Supabase', async () => {
  const p = await openValidReset({}, 'ar');
  await p.click('#reset-btn');
  assert.equal(await p.textContent('#reset-error'), 'يُرجى إدخال كلمة المرور الجديدة وتأكيدها.');
  await p.fill('#new-password', 'short');
  await p.fill('#confirm-password', 'short');
  await p.click('#reset-btn');
  assert.equal(await p.textContent('#reset-error'), 'يجب ألا تقل كلمة المرور عن 8 أحرف.');
  assert.equal(await p.$eval('#new-password', (e) => e.getAttribute('aria-invalid')), 'true');
  await p.fill('#new-password', 'longenough1');
  await p.fill('#confirm-password', 'longenough2');
  await p.click('#reset-btn');
  assert.equal(await p.textContent('#reset-error'), 'كلمتا المرور غير متطابقتين.');
  assert.equal(await p.$eval('#confirm-password', (e) => e.getAttribute('aria-invalid')), 'true');
  assert.ok(!(await calls(p)).some((c) => c[0] === 'updateUser'));
});

test('I+J. success: updateUser({password}) → recovery session signed out → success + sign-in link', async () => {
  const p = await openValidReset({});
  await p.fill('#new-password', 'NewSecret123');
  await p.fill('#confirm-password', 'NewSecret123');
  await p.click('#reset-btn');
  await p.waitForSelector('#reset-success:not([hidden])');
  const c = await calls(p);
  assert.deepEqual(c.filter((x) => x[0] !== 'verifyOtp'), [['updateUser', { password: 'NewSecret123' }], ['signOut']]);
  assert.equal(await shown(p, '#reset-form'), false);
  assert.equal(await p.textContent('#reset-success h2'), 'Password updated successfully');
  assert.equal(await p.$eval('#reset-to-login', (a) => a.getAttribute('href')), '/admin/login.html');
  assert.equal(await p.inputValue('#new-password'), '', 'password cleared from the page');
  assert.deepEqual(p.__errors, []);
});

test('update failures: weak / same password / expired session / network — translated', async () => {
  const cases = [
    [{ updateError: { status: 422, code: 'weak_password', message: 'Password should be at least 12 characters.' } }, 'form', 'That password was not accepted. Please choose a longer or stronger password.'],
    [{ updateError: { status: 422, code: 'same_password', message: 'New password should be different from the old password.' } }, 'form', 'Please choose a password different from your current one.'],
    [{ updateError: { status: 0, message: 'Failed to fetch' } }, 'form', 'Could not connect. Check your internet connection and try again.'],
    [{ updateError: { status: 401, code: 'session_expired', message: 'Session expired' } }, 'invalid', null],
  ];
  for (const [cfg, where, text] of cases) {
    const p = await openValidReset(cfg);
    await p.fill('#new-password', 'NewSecret123');
    await p.fill('#confirm-password', 'NewSecret123');
    await p.click('#reset-btn');
    if (where === 'invalid') {
      await p.waitForSelector('#reset-invalid:not([hidden])');
    } else {
      await p.waitForSelector('#reset-error:not([hidden])');
      assert.equal(await p.textContent('#reset-error'), text);
      assert.equal(await p.$eval('#reset-btn', (b) => b.disabled), false);
    }
    assert.ok(!(await calls(p)).some((c) => c[0] === 'signOut'), 'no sign-out on failure');
  }
});

// ── L ───────────────────────────────────────────────────────────────
test('L. login recovery + reset page fit 1440 → 320 in EN and AR', async () => {
  const problems = [];
  for (const lang of ['en', 'ar']) {
    for (const w of [1440, 768, 390, 320]) {
      let p = await newPage({}, lang, w);
      await openForgot(p);
      if (await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) problems.push(`${lang} ${w} recover`);
      p = await openValidReset({}, lang).then(async (pp) => { await pp.setViewportSize({ width: w, height: 800 }); return pp; });
      if (await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) problems.push(`${lang} ${w} reset`);
      const clipped = await p.$$eval('.login-card button, .login-card input', (els) => {
        const c = document.querySelector('.login-card').getBoundingClientRect();
        return els.filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > c.right + 1 || r.left < c.left - 1); }).length;
      });
      if (clipped) problems.push(`${lang} ${w} reset controls clipped`);
    }
  }
  assert.deepEqual(problems, []);
  if (ctx) { await ctx.close(); ctx = null; }
});
