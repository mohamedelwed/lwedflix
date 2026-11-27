// Runs at document start in every frame of the player's WebView — the
// wrapper page (wrapper.html) and the servers' embedded players — as
// electron/preload.js does on desktop. In a player frame it runs that same
// preload, unchanged, with stand-ins for Electron's contextBridge and
// ipcRenderer that carry its messages to the wrapper page over postMessage;
// the wrapper page routes them as electron/main.js does. It also reports
// the media URLs the frame loads, for downloads (as electron/streams.js
// watches the network on desktop), and refuses pop-ups.
//
// scripts/build-bridge.mjs fills in the placeholders and writes
// player/bridge.generated.ts.
(function () {
  if (window.__lwfBridge) return;
  try {
    Object.defineProperty(window, '__lwfBridge', { value: true });
  } catch (e) {
    return;
  }
  var TOKEN = '__LWF_TOKEN__';
  if (window === window.top) return; // the wrapper page has the router

  var top = window.top;
  var post = function (message) {
    message.lwf = TOKEN;
    try {
      top.postMessage(message, '*');
    } catch (e) {
      // The frame is going away.
    }
  };

  // ---- pop-ups: the servers' ads open them on every tap ----
  try {
    window.open = function () {
      return null;
    };
  } catch (e) {}

  // ---- media capture, for downloads ----
  var seen = {};
  var MEDIA = /\.(m3u8|mpd|mp4|m4v|webm|mov|mkv)(\?|#|$)/i;
  var isPlaylist = function (text) {
    return typeof text === 'string' && /^﻿?\s*#EXTM3U/.test(text.slice(0, 16));
  };
  var HLS_TYPE = 'application/vnd.apple.mpegurl';
  // 'element': the URL a <video> or <source> plays. Android's WebView plays
  // HLS natively, so those requests never pass through fetch or XHR; the
  // app works out what the URL is (engine.ts).
  var report = function (url, type, size) {
    if (typeof url !== 'string' || !/^https?:/i.test(url)) return;
    if (!(type === 'element' || MEDIA.test(url) || /mpegurl|dash\+xml|^video\//i.test(type || ''))) return;
    var key = url + '|' + (type || '');
    if (seen[key]) return;
    seen[key] = 1;
    post({ t: 'send', c: 'stream', p: { url: url, type: type || '', size: size || 0, frame: location.href } });
  };
  try {
    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      var xhr = this;
      try {
        var absolute = new URL(String(url), location.href).href;
        xhr.addEventListener('load', function () {
          try {
            var type = xhr.getResponseHeader('content-type');
            // Playlists hide behind other names and types (.txt, .png, text/plain).
            if ((xhr.responseType === '' || xhr.responseType === 'text') && isPlaylist(xhr.responseText)) type = HLS_TYPE;
            report(absolute, type, Number(xhr.getResponseHeader('content-length')) || 0);
          } catch (e) {}
        });
      } catch (e) {}
      return open.apply(this, arguments);
    };
  } catch (e) {}
  try {
    var originalFetch = window.fetch;
    if (originalFetch) {
      window.fetch = function (input) {
        var promise = originalFetch.apply(this, arguments);
        try {
          var url = typeof input === 'string' ? input : input && input.url;
          var absolute = new URL(String(url), location.href).href;
          promise.then(function (response) {
            try {
              var type = response.headers.get('content-type') || '';
              var size = Number(response.headers.get('content-length')) || 0;
              report(absolute, type, size);
              // Not labelled as video: peek at the start for a playlist.
              if (!/mpegurl|^video\/|^audio\/|^image\//i.test(type) && (size === 0 || size < 4 * 1024 * 1024) && response.body) {
                var reader = response.clone().body.getReader();
                reader.read().then(function (chunk) {
                  try {
                    reader.cancel();
                  } catch (e) {}
                  if (chunk && chunk.value && isPlaylist(String.fromCharCode.apply(null, chunk.value.subarray(0, 16)))) report(absolute, HLS_TYPE, size);
                }, function () {});
              }
            } catch (e) {}
          }, function () {});
        } catch (e) {}
        return promise;
      };
    }
  } catch (e) {}
  var reportElement = function (value) {
    try {
      if (value) report(new URL(String(value), location.href).href, 'element', 0);
    } catch (e) {}
  };
  [window.HTMLMediaElement, window.HTMLSourceElement].forEach(function (Element) {
    try {
      var srcDescriptor = Element && Object.getOwnPropertyDescriptor(Element.prototype, 'src');
      if (srcDescriptor && srcDescriptor.set) {
        Object.defineProperty(Element.prototype, 'src', {
          configurable: true,
          enumerable: srcDescriptor.enumerable,
          get: srcDescriptor.get,
          set: function (value) {
            reportElement(value);
            return srcDescriptor.set.call(this, value);
          },
        });
      }
    } catch (e) {}
  });
  try {
    var setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      try {
        if (String(name).toLowerCase() === 'src' && (this instanceof HTMLMediaElement || this instanceof HTMLSourceElement)) reportElement(value);
      } catch (e) {}
      return setAttribute.apply(this, arguments);
    };
  } catch (e) {}
  // And whatever the videos end up playing, however their source was set
  // (markup, a player library's own path): checked every two seconds.
  setInterval(function () {
    try {
      var videos = document.getElementsByTagName('video');
      for (var i = 0; i < videos.length; i++) reportElement(videos[i].currentSrc);
    } catch (e) {}
  }, 2000);

  // ---- the player bridge: electron/preload.js over postMessage ----
  var listeners = {};
  var pending = {};
  var nextId = 1;
  window.addEventListener('message', function (event) {
    var message = event.data;
    if (event.source !== top || !message || message.lwf !== TOKEN) return;
    if (message.t === 'reply') {
      var call = pending[message.id];
      if (!call) return;
      delete pending[message.id];
      if (message.ok) call.resolve(message.v);
      else call.reject(new Error(message.v || 'failed'));
    } else if (message.t === 'event') {
      var set = listeners[message.c] || [];
      for (var i = 0; i < set.length; i++) set[i]({}, message.p);
    }
  });

  var ipcRenderer = {
    send: function (channel, payload) {
      post({ t: 'send', c: channel, p: payload });
    },
    invoke: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1);
      return new Promise(function (resolve, reject) {
        var id = nextId++;
        pending[id] = { resolve: resolve, reject: reject };
        post({ t: 'invoke', id: id, c: channel, a: args });
      });
    },
    on: function (channel, listener) {
      (listeners[channel] = listeners[channel] || []).push(listener);
    },
    removeListener: function (channel, listener) {
      listeners[channel] = (listeners[channel] || []).filter(function (l) {
        return l !== listener;
      });
    },
  };
  var contextBridge = {
    exposeInMainWorld: function () {
      // Only the app page exposes bridges; a player frame never does.
    },
  };
  var electron = { contextBridge: contextBridge, ipcRenderer: ipcRenderer };

  (function (require, process) {
    // ---- electron/preload.js ----
    /*__PRELOAD__*/
    // ----
  })(
    function (name) {
      if (name !== 'electron') throw new Error("Cannot find module '" + name + "'");
      return electron;
    },
    { platform: '__PLATFORM__' }
  );
})();
true;
