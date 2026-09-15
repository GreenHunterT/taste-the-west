// =================================================================
//  Admin — Interaction Sound Engine  (milestone 1M)
//
//  ONE centralized, optional, asset-free Web-Audio engine for subtle Admin
//  UI feedback. It ONLY synthesises + gates on the on/off flag. The shell
//  (admin-shell.js) owns:
//    - the per-device preference   (ttw_admin_ui → adminSounds, default ON)
//    - the app-bar speaker toggle
//    - the ONE set of delegated listeners (click / focusin / input-range)
//    - ctx.sound(kind) for views that need an explicit success / warning
//
//  This module is deliberately dumb: no DOM listeners, no localStorage, no
//  Supabase. It never touches the public site's `sounds_enabled` — that is a
//  separate system in js/app.js.
//
//  Vocabulary (nothing else): tap · focus · tick · success · warning.
//  Everything is very short (≤ ~180ms), very quiet (shared master gain), and
//  fails silently — audio must never break Admin functionality.
// =================================================================

window.AdminSound = (function () {
  'use strict';

  // Master gain — conservative on purpose; must not startle a headphone user.
  var MASTER_GAIN = 0.075;
  // tick rate-limit: callers may fire freely (slider drag); the engine drops
  // any tick closer than this to the previous one (~22 ticks/s max).
  var TICK_MIN_GAP_MS = 45;

  function now() {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
  }

  function create(opts) {
    opts = opts || {};
    var enabled = opts.enabled !== false;   // default ON
    var actx = null;
    var master = null;
    var lastTickAt = 0;

    function ensureCtx() {
      if (actx) return actx;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        actx = new AC();
        master = actx.createGain();
        master.gain.value = MASTER_GAIN;
        master.connect(actx.destination);
      } catch (e) { actx = null; master = null; }
      return actx;
    }

    // One short enveloped oscillator. `gain` is RELATIVE to the master gain.
    function blip(o) {
      var c = ensureCtx();
      if (!c || !master) return;
      if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
      try {
        var t0 = c.currentTime;
        var dur = o.dur || 0.06;
        var osc = c.createOscillator();
        var g = c.createGain();
        osc.type = o.type || 'sine';
        osc.frequency.setValueAtTime(o.f0, t0);
        if (o.f1 && o.f1 !== o.f0) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 1), t0 + dur);
        }
        var peak = (o.gain == null ? 1 : o.gain);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, dur * 0.4));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g); g.connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.03);
        osc.onended = function () { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
      } catch (e) { /* fail silently */ }
    }

    var KINDS = {
      // short, soft, neutral tactile response
      tap:     function () { blip({ type: 'sine',     f0: 430, f1: 350, dur: 0.055, gain: 0.85 }); },
      // softer + lower + quieter than tap — a gentle "you're in a field"
      focus:   function () { blip({ type: 'sine',     f0: 300, f1: 288, dur: 0.05,  gain: 0.45 }); },
      // very short dry mechanical transient
      tick:    function () { blip({ type: 'triangle', f0: 880, f1: 880, dur: 0.026, gain: 0.30 }); },
      // two closely-spaced gentle rising tones
      success: function () {
        blip({ type: 'sine', f0: 520, f1: 520, dur: 0.085, gain: 0.7 });
        setTimeout(function () { blip({ type: 'sine', f0: 712, f1: 760, dur: 0.13, gain: 0.7 }); }, 68);
      },
      // one restrained descending tone
      warning: function () { blip({ type: 'sine', f0: 540, f1: 392, dur: 0.16, gain: 0.7 }); },
    };

    function play(kind) {
      if (!enabled) return;
      var fn = KINDS[kind];
      if (!fn) return;
      if (kind === 'tick') {
        var t = now();
        if (t - lastTickAt < TICK_MIN_GAP_MS) return;
        lastTickAt = t;
      }
      try { fn(); } catch (e) { /* fail silently */ }
    }

    function setEnabled(v) {
      enabled = !!v;
      if (enabled) ensureCtx();   // warm it while a user gesture is in scope
      if (typeof opts.onEnabledChange === 'function') {
        try { opts.onEnabledChange(enabled); } catch (e) {}
      }
    }
    function isEnabled() { return enabled; }
    function toggle() { setEnabled(!enabled); return enabled; }

    return {
      play: play,
      setEnabled: setEnabled,
      isEnabled: isEnabled,
      toggle: toggle,
    };
  }

  return { create: create };
})();
