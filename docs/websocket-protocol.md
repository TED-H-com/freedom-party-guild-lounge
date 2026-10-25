# Client Connection Protocol

Despite the naming of this document (which serves historical or requested naming conventions), the Freedom Party Guild Lounge **does not currently use WebSockets** for real-time communication. Instead, it relies on a robust **short-polling mechanism** over standard HTTP(S) to synchronize state across clients.

## Polling Mechanism Overview

The React frontend utilizes a custom `usePolling` hook to repeatedly fetch the latest state from the Cloudflare Worker API. This approach was chosen for its simplicity, reliability across restrictive venue networks, and stateless backend requirements.

### Client-Side Implementation (`usePolling`)
- **Intervals**: Clients poll endpoints at specific intervals (e.g., 1500ms for event state, 5000ms for participant presence) to balance real-time responsiveness with API load.
- **Resilience**: The polling hook gracefully handles temporary network failures and resumes polling when the connection is restored.
- **Heartbeats**: Mobile clients proactively send a heartbeat (`POST /api/participants/:id/heartbeat`) every 20 seconds to declare themselves online. The server considers any participant without a heartbeat in the last 90 seconds to be offline.

## Event Schemas & Payloads

The polling protocol relies on specific JSON payload structures returned by the edge API.

### 1. Global Event State (`GET /api/event`)
Polled every 1.5 seconds by all active clients (Mobile, Lounge, Admin).

```json
{
  "mode": "idle" | "countdown" | "match",
  "endsAt": 1716382910, // null if mode is idle
  "round": 3,
  "matchCount": 12
}
```

### 2. Participant Heartbeat (`POST /api/participants/:id/heartbeat`)
Sent every 20 seconds by active mobile clients. Requires the `X-Participant-Token` header.

*Request Body:* None
*Response:* `204 No Content`

### 3. Match Result (`GET /api/matches/me`)
Polled by mobile clients every 1.8 seconds **only when** `event.mode === "match"`. Requires the `X-Participant-Token` header.

*Success Response:*
```json
{
  "match": {
    "target": {
      "id": "p_abc123",
      "nickname": "Alex",
      "role": "summoner",
      "skillsJson": "[\"策展\", \"社群\"]",
      "greeting": "Let's connect!",
      "socialEnergy": 4,
      "photoKey": "photo_xyz789.jpg"
    }
  }
}
```
*Pending Response (If match not yet computed or no match found):*
```json
{
  "match": null
}
```

### 4. Admin & Lounge Participants (`GET /api/host/participants`)
Polled by Lounge Display and Admin Dashboard every 1.8 seconds. Requires the `Authorization: Bearer <HOST_TOKEN>` header.

```json
{
  "participants": [
    {
      "id": "p_abc123",
      "nickname": "Alex",
      "role": "summoner",
      "skillsJson": "[\"策展\", \"社群\"]",
      "greeting": "Let's connect!",
      "socialEnergy": 4,
      "photoKey": "photo_xyz789.jpg",
      "wallEnabled": 1,
      "matchEnabled": 1,
      "wall": true,
      "online": true // Computed based on updatedAt being within the last 90 seconds
    }
  ]
}
```

## Potential WebSocket Upgrade Path

If the application scales beyond the limits of short-polling, migrating to Cloudflare Durable Objects + WebSockets would involve adapting these polling schemas into WebSocket message frames:

- **Server-to-Client `EVENT_UPDATE`**: Pushed whenever `event_state` changes.
- **Server-to-Client `MATCH_RESULT`**: Pushed to specific clients when a round completes.
- **Client-to-Server `HEARTBEAT`**: A ping/pong frame to maintain the connection.