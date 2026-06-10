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
| `webRTCSDK.js` | Headless WebRTC/SIP adapter (JsSIP) — connects the call and surfaces metadata |

## Configuration (top of `script.js`)

- `ENDPOINT` — the plain HTTPS Cognigy endpoint URL (already set).
- `BRAND` — the name shown in the logo, nav, and page title. Currently
  `SecureAccount`; change this one line to rebrand.
- `SHOW_DEMO_CONTROLS` — `true` shows a floating panel to fire payloads manually
  (Unlock / Deny / Stream text) without a live call. Set to `false` for production.

URL params: `?userId=...` (session id in Cognigy's Interaction Panel),
`?name=...` (customer name sent to the agent on connect).

## How the connection works (`webRTCSDK.js`)

`webRTCSDK.js` is a small, dependency-free adapter that reimplements the connection
logic of the official Cognigy click-to-call widget
(github.com/Cognigy/click-to-call-widget). It registers `window.WebRTCSDK` and
exposes `createWebRTCClient({ endpointUrl, userId })`. On a call it:

1. `GET <endpointUrl>` → reads `endpointSettings.sipConnectivityInfo`
   (`wsUri`, `realm`, `username`, `password`, `applicationSid`).
2. Registers a JsSIP user agent as `sip:<userId>@<realm>`.
3. Calls `app-<applicationSid>` (the Cognigy voice app).
4. Emits incoming SIP INFO verbatim via `infoReceived` → `handleInfoReceived()`.

**No credentials are bundled** — they're fetched live from the public endpoint URL
at call time. JsSIP is loaded at runtime from a pinned CDN build (`jssip@3.10.1`,
the same version the official widget uses); requires network access on first call.

> The endpoint must allow your page's origin via CORS. The configured GitHub Pages
> origin is already allow-listed by the trial endpoint.

## Running locally

Serve the folder over HTTP (microphone access and the SDK fetch need a real origin,
not `file://`):

```powershell
# from this folder
python -m http.server 5500
# or:  npx serve .
```

Then open http://localhost:5500/ and click **Talk to Assistant**.
