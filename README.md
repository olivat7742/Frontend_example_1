# Account Unlock — Cognigy WebRTC Demo

A voice-driven account-recovery page. The visitor talks to a Cognigy AI agent over
a WebRTC call. When the agent decides the identity is verified, it sends a SIP INFO
metadata payload and the page animates the account from **Locked** to **Unlocked**.

## The trigger payload

The backend (Cognigy) sends this over the SIP INFO channel:

```json
{ "phase": "account_check", "accountUnlocked": true }
```

- `accountUnlocked: true`  → "Verifying…" beat, then the lock springs open, a green
  check draws in, confetti fires, and the unlock details appear.
- `accountUnlocked: false` → the card shifts red and shakes ("Couldn't Unlock").

Transcript lines are streamed word-by-word from either form:

```json
{ "_transcription": { "originator": "bot", "messages": [{ "text": "…" }] } }
{ "text": "…" }
```

## Files

| File | Purpose |
|---|---|
| `index.html` | Welcome splash + locked/unlock card + bottom call bar |
| `style.css`  | All styling and animations (lock, confetti, states) |
| `script.js`  | Call wiring + `handleInfoReceived()` dispatcher + state machine |
| `webRTCSDK.js` | **Required, not included** — the Cognigy/JsSIP WebRTC SDK (see below) |

## Configuration (top of `script.js`)

- `ENDPOINT` — the plain HTTPS Cognigy endpoint URL (already set).
- `BRAND` — the name shown in the logo, nav, and page title. Currently
  `SecureAccount`; change this one line to rebrand.
- `SHOW_DEMO_CONTROLS` — `true` shows a floating panel to fire payloads manually
  (Unlock / Deny / Stream text) without a live call. Set to `false` for production.

URL params: `?userId=...` (session id in Cognigy's Interaction Panel),
`?name=...` (customer name sent to the agent on connect).

## The missing dependency: `webRTCSDK.js`

This is the shared Cognigy WebRTC SDK (built on JsSIP). It is **not** the NiCE
AudioCodes `ac_webrtc.min.js` — that's a different SDK. The page loads it via
`<script src="webRTCSDK.js">` and it registers `window.WebRTCSDK`.

Get it from the Nexora repo at `public/webRTCSDK.js` (identical to
`public/moments/webRTCSDK.js`) and drop the file into this folder. Until it's
present, the page loads fine and the **Demo Controls** panel still drives the full
unlock animation — only the live call will error.

## Running locally

Serve the folder over HTTP (microphone access and the SDK fetch need a real origin,
not `file://`):

```powershell
# from this folder
python -m http.server 5500
# or:  npx serve .
```

Then open http://localhost:5500/ and click **Talk to Assistant**.
