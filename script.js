// === Config ============================================================

// Cognigy WebRTC endpoint (plain HTTPS endpoint URL, not wss:// or /voiceGateway).
const ENDPOINT = 'https://endpoint-trial.cognigy.ai/9bcd0fbd0eb00a8c4bec9ef8d37a60ea678f7aa6cb536f8977f694fb8ca97cc6'

// Brand name shown in the logo / nav / page title. Change in one place.
const BRAND = 'SecureAccount'

// Show the floating "Demo Controls" panel (simulate payloads without a live call).
// Handy for presenting the unlock animation before the SDK/endpoint is wired up.
const SHOW_DEMO_CONTROLS = true

const _params       = new URLSearchParams(window.location.search)
const USER_ID       = _params.get('userId') || 'account-unlock-demo'
const CUSTOMER_NAME = _params.get('name') || null

// === State =============================================================

const state = {
  client:    null,
  session:   null,
  micMuted:  false,
  isInCall:  false,
  account:   'locked',   // locked | checking | unlocked | denied
}

// === Boot ==============================================================

document.addEventListener('DOMContentLoaded', () => {
  applyBrand()

  document.getElementById('welcome-start-btn').addEventListener('click', () => {
    launchApp()
    startAiCall()
  })

  if (!SHOW_DEMO_CONTROLS) document.getElementById('demo-panel').style.display = 'none'
})

// Apply the BRAND constant everywhere it appears.
function applyBrand() {
  document.title = BRAND + ' — Account Access'
  document.querySelectorAll('[data-brand]').forEach(el => { el.textContent = BRAND })
}

// === Welcome -> app ====================================================

function launchApp() {
  document.getElementById('welcome-screen').classList.add('fly-up')
  document.getElementById('app').classList.remove('hidden')
}

// === Account state machine =============================================

const COPY = {
  locked: {
    title:   'Account Locked',
    message: 'For your security, this account is temporarily locked. Speak with our assistant to verify your identity and restore access.',
  },
  checking: {
    title:   'Verifying…',
    message: 'Hold tight, we are confirming your identity with the assistant.',
  },
  unlocked: {
    title:   'Account Unlocked',
    message: 'Your identity has been verified and your access is fully restored.',
  },
  denied: {
    title:   'Couldn’t Unlock',
    message: 'We weren’t able to verify your identity this time. Please continue with the assistant so we can try again.',
  },
}

const PILL_LABEL = { locked: 'Locked', checking: 'Verifying', unlocked: 'Unlocked', denied: 'Denied' }

function setAccountState(next) {
  state.account = next
  const card = document.getElementById('account-card')
  const pill = document.getElementById('status-pill')

  card.className = 'account-card state-' + next
  pill.className = 'status-pill ' + next
  document.getElementById('status-pill-label').textContent = PILL_LABEL[next]

  document.getElementById('account-title').textContent   = COPY[next].title
  document.getElementById('account-message').textContent = COPY[next].message

  document.getElementById('verify-row').classList.toggle('hidden', next !== 'checking')
  document.getElementById('unlock-details').classList.toggle('hidden', next !== 'unlocked')

  if (next === 'unlocked') fireConfetti()
}

// The core moment: an `account_check` payload arrives. Play a brief verifying
// beat for drama, then reveal the unlock (or denial) animation.
function runAccountCheck(unlocked) {
  launchApp()
  setAccountState('checking')
  setTimeout(() => setAccountState(unlocked ? 'unlocked' : 'denied'), 1400)
}

// === Confetti burst ====================================================

const CONFETTI_COLORS = ['#22c55e', '#6366f1', '#8b5cf6', '#fbbf24', '#f472b6', '#38bdf8']

function fireConfetti() {
  const host = document.getElementById('confetti')
  host.innerHTML = ''
  host.classList.remove('burst')
  const pieces = 26
  for (let i = 0; i < pieces; i++) {
    const angle = (Math.PI * 2 * i) / pieces + (i % 2 ? .25 : 0)
    const dist  = 80 + (i % 5) * 22
    const piece = document.createElement('i')
    piece.style.setProperty('--dx', `${Math.cos(angle) * dist}px`)
    piece.style.setProperty('--dy', `${Math.sin(angle) * dist - 30}px`)
    piece.style.setProperty('--rot', `${(i % 2 ? 1 : -1) * (180 + i * 12)}deg`)
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
    piece.style.animationDelay = `${(i % 6) * 18}ms`
    host.appendChild(piece)
  }
  // force reflow so the burst animation restarts on repeat unlocks
  void host.offsetWidth
  host.classList.add('burst')
}

// === Reset =============================================================

function resetApp() {
  setAccountState('locked')
  document.getElementById('confetti').innerHTML = ''
}

// === AI call ===========================================================

function initClient() {
  if (state.client) return Promise.resolve(state.client)
  const SDK = window.WebRTCSDK || window.default
  if (!SDK?.createWebRTCClient) {
    console.error('WebRTC SDK not loaded.')
    return Promise.reject(new Error('SDK not loaded'))
  }
  return SDK.createWebRTCClient({
    endpointUrl: ENDPOINT,
    userId: encodeURIComponent(USER_ID),
  }).then(client => {
    state.client = client

    client.on('infoReceived', handleInfoReceived)

    client.on('ringing', () => {
      state.isInCall = true
      setCallUiActive(true)
    })

    client.on('connected', session => { state.session = session || null })

    client.on('answered', () => {
      state.isInCall = true
      setCallUiActive(true)
      const payload = { ...(CUSTOMER_NAME && { customerName: CUSTOMER_NAME }) }
      if (Object.keys(payload).length) {
        client.sendInfo('', payload).catch(err => console.error('sendInfo failed', err))
      }
    })

    client.on('ended', () => {
      state.session  = null
      state.isInCall = false
      state.micMuted = false
      setCallUiActive(false)
    })

    client.on('failed', () => {
      state.session  = null
      state.isInCall = false
      setCallUiActive(false)
    })

    return client
  })
}

function startAiCall() {
  const btn      = document.getElementById('ai-call-btn')
  const btnLabel = document.getElementById('ai-call-btn-label')
  btnLabel.textContent = 'Connecting…'
  btn.disabled = true

  initClient()
    .then(client => {
      if (client.isConnected?.()) return client
      return client.connect().then(() => client)
    })
    .then(client => client.startCall())
    .catch(err => {
      const msg = err?.message || String(err)
      console.error('Call failed to start', err)
      btnLabel.textContent = 'Talk to Assistant'
      btn.disabled = false
      document.getElementById('transcript-text').textContent = '⚠  ' + msg
      document.getElementById('transcript-area').classList.remove('hidden')
    })
}

function endAiCall() {
  if (state.client) {
    state.client.endCall?.().catch(() => {})
    state.client = null
  }
  state.session  = null
  state.isInCall = false
  state.micMuted = false
  setCallUiActive(false)
}

function setCallUiActive(active) {
  document.getElementById('ai-call-btn').classList.toggle('hidden', active)
  document.getElementById('mute-btn').classList.toggle('hidden', !active)
  document.getElementById('end-call-btn').classList.toggle('hidden', !active)
  document.getElementById('transcript-area').classList.toggle('hidden', !active)
  if (!active) {
    document.getElementById('transcript-text').textContent = ''
    document.getElementById('ai-call-btn-label').textContent = 'Talk to Assistant'
    document.getElementById('ai-call-btn').disabled = false
  }
}

function toggleMute() {
  state.micMuted = !state.micMuted
  try {
    if (state.micMuted) {
      state.client?.mute?.() || state.session?.mute?.()
    } else {
      state.client?.unmute?.() || state.session?.unmute?.()
    }
  } catch (e) { console.warn('Mute toggle failed', e) }
  document.getElementById('mute-btn').classList.toggle('muted', state.micMuted)
  document.getElementById('mute-label').textContent = state.micMuted ? 'Unmute' : 'Mute'
  document.getElementById('mute-icon').innerHTML = state.micMuted
    ? '<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'
    : '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'
}

// === Backend payload handler ===========================================

function handleInfoReceived(raw) {
  const body = (raw?.info?.body) || (raw?.body) || (raw?.text) || null
  if (!body) return
  let data
  try { data = typeof body === 'string' ? JSON.parse(body) : body }
  catch (e) { console.error('[SIP INFO] Failed to parse body', body, e); return }
  if (data._transcription) {
    console.log('[SIP INFO] transcription:', data._transcription?.messages?.slice(-1)[0]?.text ?? '')
  } else {
    console.log('[SIP INFO] phase=' + (data.phase ?? '?'), data)
  }

  // The account-check moment: { "phase": "account_check", "accountUnlocked": true }
  if (data.phase === 'account_check' && typeof data.accountUnlocked === 'boolean') {
    runAccountCheck(data.accountUnlocked)
  }

  // Transcript (fires on any phase)
  const text = data._transcription?.messages?.slice(-1)[0]?.text ?? (typeof data.text === 'string' ? data.text : null)
  if (text) streamText(text)
}

// === Transcript streaming ==============================================

let streamTimer = null

function streamText(text) {
  const el = document.getElementById('transcript-text')
  clearInterval(streamTimer)
  el.textContent = ''
  document.getElementById('transcript-area').classList.remove('hidden')
  const words = text.split(' ')
  let i = 0
  streamTimer = setInterval(() => {
    if (i >= words.length) { clearInterval(streamTimer); return }
    el.textContent += (i > 0 ? ' ' : '') + words[i++]
  }, 140)
}

// === Demo controls =====================================================

function toggleDemo() {
  const body = document.getElementById('demo-body')
  const btn  = document.getElementById('demo-toggle-btn')
  body.classList.toggle('collapsed')
  btn.textContent = body.classList.contains('collapsed') ? '+' : '−'
}

function simulatePayload(payload) {
  handleInfoReceived(payload)
}
