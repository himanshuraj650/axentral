## Packages
framer-motion | Page transitions and chat bubble animations
date-fns | Date formatting for chat messages
lucide-react | Icons for UI

## Notes
- E2EE implemented entirely in frontend using Web Crypto API.
- WebSockets handle signaling (key exchange) and encrypted payload delivery.
- Self-destruct logic is handled client-side by tracking `expiresAt` timestamps and auto-purging state.
- Make sure to use Dark Mode as the default theme for this application to fit the aesthetic.
