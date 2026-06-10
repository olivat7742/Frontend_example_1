/**
 * webRTCSDK.js — headless WebRTC/SIP adapter for Cognigy voice endpoints.
 *
 * Exposes window.WebRTCSDK.createWebRTCClient({ endpointUrl, userId }) and a
 * client object whose API matches what script.js already expects:
 *
 *   client.on('infoReceived' | 'ringing' | 'connected' | 'answered' | 'ended' | 'failed', cb)
 *   client.isConnected() -> boolean
 *   client.connect()     -> Promise   (registers with the SIP server)
 *   client.startCall()   -> Promise   (places the call to the Cognigy app)
 *   client.endCall()     -> Promise
 *   client.mute() / client.unmute()
 *   client.sendInfo(text, data) -> Promise   (sends a SIP INFO JSON payload)
 *
 * It reimplements, in dependency-free vanilla JS, the connection logic of the
 * official Cognigy click-to-call widget (github.com/Cognigy/click-to-call-widget):
 *   1. GET <endpointUrl>  -> endpointSettings.sipConnectivityInfo
 *      { wsUri, realm, username, password, applicationSid }
 *   2. JsSIP UA registers as sip:<userId>@<realm> (auth user = username)
 *   3. UA calls "app-<applicationSid>"
 *   4. Incoming SIP INFO (originator 'remote') is surfaced verbatim via the
 *      'infoReceived' event so script.js can parse phase / _transcription itself.
 *
 * No credentials are bundled: they are fetched live from the public endpoint URL.
 * JsSIP is loaded at runtime from a pinned CDN build (jssip@3.10.1, the same
 * version the official widget uses).
 */
;(function () {
  'use strict'

  // Pinned JsSIP ESM build (self-contained, no sub-imports). Exposes { UA, WebSocketInterface, ... }.
  var JSSIP_URL = 'https://cdn.jsdelivr.net/npm/jssip@3.10.1/+esm'

  // Default ICE config. A public STUN server is enough for a server-anchored
  // bot call; add a TURN server here if you need to traverse strict NATs.
  var PC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }

  var REGISTER_TIMEOUT_MS = 15000

  // --- JsSIP loader (cached) -------------------------------------------------
  var _jssip = null
  function loadJsSIP() {
    if (_jssip) return _jssip
    _jssip = import(JSSIP_URL).then(function (m) {
      var UA = m.UA || (m.default && m.default.UA)
      var WebSocketInterface = m.WebSocketInterface || (m.default && m.default.WebSocketInterface)
      if (!UA || !WebSocketInterface) throw new Error('JsSIP failed to load from CDN')
      return { UA: UA, WebSocketInterface: WebSocketInterface }
    })
    return _jssip
  }

  // --- Tiny event emitter ----------------------------------------------------
  function Emitter() { this._handlers = {} }
  Emitter.prototype.on = function (evt, cb) {
    (this._handlers[evt] = this._handlers[evt] || []).push(cb)
    return this
  }
  Emitter.prototype.emit = function (evt) {
    var args = Array.prototype.slice.call(arguments, 1)
    var list = this._handlers[evt]
    if (!list) return
    list.slice().forEach(function (cb) {
      try { cb.apply(null, args) } catch (e) { console.error('[WebRTCSDK] handler error for "' + evt + '"', e) }
    })
  }

  // --- Remote audio sink -----------------------------------------------------
  function makeAudioSink() {
    var el = document.createElement('audio')
    el.autoplay = true
    el.setAttribute('playsinline', '')
    el.style.display = 'none'
    document.body.appendChild(el)
    return el
  }

  // --- Client factory --------------------------------------------------------
  function createWebRTCClient(opts) {
    opts = opts || {}
    var endpointUrl = opts.endpointUrl
    var userId = opts.userId || ''
    if (!endpointUrl) return Promise.reject(new Error('endpointUrl is required'))

    return fetch(endpointUrl)
      .then(function (res) {
        if (!res.ok) throw new Error('Configuration fetch failed: HTTP ' + res.status)
        return res.json()
      })
      .then(function (cfg) {
        var info = cfg && cfg.endpointSettings && cfg.endpointSettings.sipConnectivityInfo
        if (!info || !info.wsUri || !info.realm) {
          throw new Error('Invalid endpoint configuration received')
        }
        var sip = {
          wsUri: info.wsUri,
          realm: info.realm,
          username: info.username,
          password: info.password,
          applicationSid: info.applicationSid,
          // userId arrives already URL-encoded from the caller (see script.js).
          fullUsername: (userId || ('webrtc-' + Math.random().toString(36).slice(2, 10))) + '@' + info.realm,
        }
        return buildClient(sip)
      })
  }

  function buildClient(sip) {
    var client = new Emitter()
    var st = { ua: null, session: null, connected: false, connecting: null }
    var audioSink = null

    function attachRemoteAudio(pc) {
      if (!pc) return
      if (!audioSink) audioSink = makeAudioSink()
      var play = function () { var p = audioSink.play(); if (p && p.catch) p.catch(function () {}) }
      pc.addEventListener('track', function (ev) {
        audioSink.srcObject = (ev.streams && ev.streams[0]) || new MediaStream([ev.track])
        play()
      })
      // Legacy fallback for older WebRTC stacks.
      pc.addEventListener('addstream', function (ev) {
        audioSink.srcObject = ev.stream
        play()
      })
    }

    function wireSession(rtcSession) {
      st.session = rtcSession

      if (rtcSession.connection) attachRemoteAudio(rtcSession.connection)
      rtcSession.on('peerconnection', function (d) { attachRemoteAudio(d && d.peerconnection) })

      rtcSession.on('progress', function () { client.emit('ringing') })

      rtcSession.on('accepted', function () {
        // script.js wires both 'connected' (stores the session) and 'answered'.
        client.emit('connected', sessionWrapper(rtcSession))
        client.emit('answered')
      })

      // Surface incoming metadata verbatim. We deliberately do NOT split out
      // _transcription (unlike the official widget) — script.js handles both
      // account_check and _transcription inside handleInfoReceived().
      rtcSession.on('newInfo', function (d) {
        if (d && d.originator === 'remote' && d.info) {
          client.emit('infoReceived', { info: { body: d.info.body } })
        }
      })

      rtcSession.on('ended', function () { st.session = null; client.emit('ended') })
      rtcSession.on('failed', function (e) { st.session = null; client.emit('failed', e) })
    }

    function sessionWrapper(rtcSession) {
      return {
        mute: function () { try { rtcSession.mute({ audio: true }) } catch (e) {} },
        unmute: function () { try { rtcSession.unmute({ audio: true }) } catch (e) {} },
      }
    }

    client.isConnected = function () { return !!st.connected }

    client.connect = function () {
      if (st.connected) return Promise.resolve(client)
      if (st.connecting) return st.connecting

      st.connecting = loadJsSIP().then(function (J) {
        return new Promise(function (resolve, reject) {
          var settled = false
          var socket = new J.WebSocketInterface(sip.wsUri)
          var ua = new J.UA({
            uri: 'sip:' + sip.fullUsername,
            password: sip.password,
            authorization_user: sip.username,
            sockets: [socket],
            register: true,
          })
          st.ua = ua

          ua.on('registered', function () {
            st.connected = true
            if (!settled) { settled = true; resolve(client) }
          })
          ua.on('registrationFailed', function (e) {
            st.connected = false
            client.emit('failed', e)
            if (!settled) {
              settled = true
              var code = (e && e.response && e.response.status_code) || (e && e.cause) || 'unknown'
              reject(new Error('SIP registration failed (' + code + ')'))
            }
          })
          ua.on('disconnected', function () { st.connected = false })
          ua.on('newRTCSession', function (d) { wireSession(d.session) })

          ua.start()

          setTimeout(function () {
            if (!settled) { settled = true; reject(new Error('SIP registration timed out')) }
          }, REGISTER_TIMEOUT_MS)
        })
      })

      // Allow a later retry if this attempt fails.
      st.connecting.catch(function () { st.connecting = null })
      return st.connecting
    }

    client.startCall = function () {
      return client.connect().then(function () {
        if (!st.ua) throw new Error('SIP client not connected')
        st.ua.call('app-' + sip.applicationSid, {
          mediaConstraints: { audio: true, video: false },
          pcConfig: PC_CONFIG,
        })
        return client
      })
    }

    client.endCall = function () {
      try { if (st.session) st.session.terminate() } catch (e) {}
      try { if (st.ua) st.ua.stop() } catch (e) {}
      st.session = null
      st.connected = false
      st.connecting = null
      st.ua = null
      return Promise.resolve()
    }

    client.mute = function () { try { if (st.session) st.session.mute({ audio: true }) } catch (e) {} }
    client.unmute = function () { try { if (st.session) st.session.unmute({ audio: true }) } catch (e) {} }

    client.sendInfo = function (text, data) {
      return new Promise(function (resolve, reject) {
        try {
          if (!st.session) throw new Error('No active session for sendInfo')
          // Matches the official widget wire format: { text, data } as application/json.
          st.session.sendInfo('application/json', JSON.stringify({ text: text || '', data: data || {} }))
          resolve()
        } catch (e) { reject(e) }
      })
    }

    return client
  }

  // --- Expose global ---------------------------------------------------------
  window.WebRTCSDK = { createWebRTCClient: createWebRTCClient }
})()
