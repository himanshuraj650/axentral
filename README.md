dxDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDXDXDZDD89
TTDR55# Axyntrel

## Project Description
Axyntrel is a powerful project built to simplify complex tasks using cutting-edge technology. It focuses on enhancing productivity and efficiency.

## Features
- User-friendly interface
- High performance
- Supports multiple languages
- API integration capabilities

## Security And Data Retention
- End-to-end encrypted messaging and signaling relay.
- Chat content is never stored in the database.
- By default, room metadata is in-memory only (ephemeral) and not persisted.
- By default, call logs are not persisted server-side.
- API responses are not logged with payload bodies.

Environment flags:
- `ALLOW_PERSISTENT_ROOM_STORAGE=false` (default recommended)
- `ALLOW_SERVER_CALL_LOGS=false` (default recommended)
- `APP_ORIGIN=http://localhost:5000` (recommended for strict WS origin checks)
- `DATABASE_URL=...` is only required if `ALLOW_PERSISTENT_ROOM_STORAGE=true`

## Installation Instructions
1. Clone the repository:
   ```bash
   git clone https://github.com/himanshuraj650/axyntrel.git
   ```
2. Navigate to the project directory:
   ```bash
   cd axyntrel
   ```
3. Install required dependencies:
   ```bash
   npm install
   ```

## Usage Guide
1. Start the project:
   ```bash
   npm start
   ```
2. Open your browser and navigate to `http://localhost:3000`.

## Render Deployment
This repository includes a `render.yaml` blueprint for deploying the app as a web service with a managed PostgreSQL database.

Deployment steps:
1. Push the repository to GitHub.
2. In Render, choose **New +** then **Blueprint**.
3. Connect the repository and let Render read `render.yaml`.
4. Keep `ALLOW_PERSISTENT_ROOM_STORAGE=true` if you want rooms stored in Postgres.
5. Set TURN variables in Render for reliable voice/video calling across networks.

Recommended Render environment variables (Metered TURN):
```env
METERED_DOMAIN=yourappname.metered.live
METERED_API_KEY=your_metered_api_key
VITE_ICE_TRANSPORT_POLICY=relay
```

Security note:
- Keep `METERED_API_KEY` only on server-side env (Render Environment).
- Never expose `METERED_API_KEY` in frontend code or public repos.

Optional Twilio token-based TURN:
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_TTL_SEC=3600
```

Optional static TURN override (non-Twilio providers):
```env
TURN_URLS=turn:your-turn-host:3478,turns:your-turn-host:5349
TURN_USERNAME=your-turn-username
TURN_CREDENTIAL=your-turn-password
```

If you do not configure TURN, calls may still work on the same network, but cross-network voice/video reliability will be lower.

## WebRTC Calling Setup
For reliable voice/video calls across mobile networks and strict NATs, configure a TURN server.

### Option 1: Metered TURN (recommended)
1. Create account at Metered dashboard.
2. Open Developers and copy `METERED_DOMAIN` + API key.
3. Add these variables in Render:
```env
METERED_DOMAIN=yourappname.metered.live
METERED_API_KEY=your_metered_api_key
VITE_ICE_TRANSPORT_POLICY=relay
```

Optional static Metered override:
```env
TURN_URLS=turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:80?transport=tcp,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443?transport=tcp
TURN_USERNAME=your_metered_username
TURN_CREDENTIAL=your_metered_password
```

### Option 2: Twilio Network Traversal
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_TTL_SEC=3600
VITE_ICE_TRANSPORT_POLICY=relay
```

### Option 3: Any authenticated TURN provider
Add these variables to your `.env` file:
```env
TURN_URLS=turn:your-turn-host:3478,turns:your-turn-host:5349
TURN_USERNAME=your-turn-username
TURN_CREDENTIAL=your-turn-password
```

Notes:
- `TURN_URLS` can contain one or multiple endpoints separated by commas.
- STUN is already enabled by default and works for same-network calls.
- TURN (or a cloud service) is recommended for production-grade cross-network connectivity.

## Tech Stack
- **Frontend:** React
- **Backend:** Node.js, Express
- **Database:** MongoDB
- **Others:** Jest for testing, Docker for containerization

## Contribution Guidelines
We welcome contributions! To get involved:
1. Fork the repository.
2. Create a new feature branch:
   ```bash
   git checkout -b feature/YourFeature
   ```
3. Make your changes and commit them:
   ```bash
   git commit -m 'Add some feature'
   ```
4. Push to the branch:
   ```bash
   git push origin feature/YourFeature
   ```
5. Open a pull request.

Thank you for helping to improve Axyntrel!