/* Shared helpers: money formatting, DOM shortcuts, and Apple-style springs (response + damping ratio). */
(function () {
  'use strict';
  var ATN = (window.ATN = window.ATN || {});

  ATN.reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  ATN.$ = function (sel, root) { return (root || document).querySelector(sel); };
  ATN.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  ATN.el = function (tag, cls, html) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  };
  ATN.esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  ATN.clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  ATN.lerp = function (a, b, t) { return a + (b - a) * t; };
  ATN.easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
  ATN.easeInOut = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

  /** 1 USD = 1,000,000 micro-dollars (src/domain/money.ts). Whole cents show 2 decimals; sub-cent amounts keep their precision. */
  ATN.usd = function (micros) {
    var neg = micros < 0;
    var m = Math.abs(micros);
    var whole = m % 10000 === 0;
    var s = (m / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: whole ? 2 : 6 });
    return (neg ? '−' : '') + '$' + s;
  };
  /** Rounded to cents, for values that are mid-animation. */
  ATN.usdLive = function (v, target) {
    if (Math.abs(v - target) < 40) return ATN.usd(target);
    return ATN.usd(Math.round(v / 10000) * 10000);
  };
  /** Turns raw micro-dollar numbers inside server messages into dollars. */
  ATN.humanize = function (text) {
    return String(text).replace(/\b(\d{5,})\b/g, function (_m, n) { return ATN.usd(Number(n)); });
  };
  ATN.mmss = function (ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  ATN.shortHex = function (hex) { return hex ? hex.slice(0, 8) + '…' + hex.slice(-4) : ''; };

  /**
   * Critically damped by default (damping 1). `response` is how quickly the value reaches its target, in seconds,
   * and is not a duration: the spring has none. Re-targeting mid-flight keeps velocity, so motion is interruptible.
   */
  function Spring(value, opts) {
    opts = opts || {};
    this.v = value;
    this.target = value;
    this.vel = 0;
    this.response = opts.response || 0.5;
    this.damping = opts.damping == null ? 1 : opts.damping;
    this.eps = opts.epsilon == null ? 0.01 : opts.epsilon;
    this.onUpdate = opts.onUpdate || function () {};
    this.raf = 0;
    this.last = 0;
    var self = this;
    this._tick = function (now) {
      var dt = Math.min(0.05, (now - self.last) / 1000);
      self.last = now;
      var w = (2 * Math.PI) / self.response;
      var k = w * w;
      var c = 2 * self.damping * w;
      var steps = Math.max(1, Math.ceil(dt / 0.008));
      var h = dt / steps;
      for (var i = 0; i < steps; i += 1) {
        var a = -k * (self.v - self.target) - c * self.vel;
        self.vel += a * h;
        self.v += self.vel * h;
      }
      if (Math.abs(self.v - self.target) < self.eps && Math.abs(self.vel) < self.eps * 4) {
        self.v = self.target;
        self.vel = 0;
        self.raf = 0;
        self.onUpdate(self.v, true);
        return;
      }
      self.onUpdate(self.v, false);
      self.raf = requestAnimationFrame(self._tick);
    };
  }
  Spring.prototype.to = function (target) {
    if (ATN.reduceMotion) return this.snap(target);
    this.target = target;
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this._tick);
    }
  };
  Spring.prototype.snap = function (target) {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.v = this.target = target;
    this.vel = 0;
    this.onUpdate(this.v, true);
  };
  ATN.Spring = Spring;

  ATN.params = (function () {
    var out = {};
    var q = window.location.search.replace(/^\?/, '');
    q.split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = decodeURIComponent(i < 0 ? pair : pair.slice(0, i));
      out[k] = i < 0 ? '1' : decodeURIComponent(pair.slice(i + 1));
    });
    return out;
  })();
})();
