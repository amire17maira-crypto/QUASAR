# Shadow FCA

Independent Facebook Chat API client for Node.js.

## Current Status

Early development. Not production-ready.
Facebook login, MQTT and Telegram integration are not implemented yet.

## Implemented

- Independent sessions.
- Separate CookieJar for every session.
- AppState import and export.
- HTTP client with per-session cookies.
- Central request scheduler.
- Rate-limit detection.
- No automatic retries for rate-limited requests.
- AES-256-GCM encrypted session storage.
- Scrypt password-based key derivation.
- Session manager.
- Public API through index.js.

## Requirements

- Node.js >= 18.

## Installation

Run npm install in the project directory.

## Tests

Run npm test to execute the test suite.

## Security

- Never share Facebook cookies or AppState through Telegram.
- Never commit passwords, tokens or session files to Git.
- Keep encrypted session files private.
- Each user should control their own authenticated session.
- Expired Facebook cookies require valid re-authentication.
- Rate limits must be respected, not bypassed.

## Planned Work

- Secure authentication lifecycle.
- Controlled MQTT connection and reconnection.
- Promise and callback compatibility.
- Telegram access approval system.
- Compatibility layer for existing bot commands.
- Additional security and integration tests.

## License

UNLICENSED
