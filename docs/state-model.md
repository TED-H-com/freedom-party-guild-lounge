# State Model

The Freedom Party Guild Lounge utilizes Cloudflare D1 (SQLite) via Drizzle ORM to manage the application's state. The state model revolves around three primary entities: Participants, the global Event State, and the history of Matches.

## 1. Database Schema

### `participants`
Stores information about attendees who have completed the check-in process.

- **`id`** (TEXT): Unique identifier for the participant.
- **`tokenHash`** (TEXT): A SHA-256 hash of the participant's local device token, used to authenticate actions securely without storing the raw token.
- **`nickname`** (TEXT): Chosen display name.
- **`role`** (TEXT): The guild role selected by the participant (e.g., `mechanic`, `illusionist`, `summoner`, `lord`).
- **`skillsJson`** (TEXT): JSON array of selected skills.
- **`greeting`** (TEXT): The participant's personal greeting or catchphrase.
- **`socialEnergy`** (INTEGER): A self-assigned rating from 1 to 5 indicating willingness to roam or stay anchored.
- **`photoKey`** (TEXT): Identifier for the participant's photo.
- **`wallEnabled`** (INTEGER): Boolean flag indicating if the participant chose to appear on the public lounge wall (1 = true, 0 = false).
- **`matchEnabled`** (INTEGER): Boolean flag indicating if the participant is open to matching (1 = true, 0 = false).
- **`createdAt`** (INTEGER): Timestamp of registration.
- **`updatedAt`** (INTEGER): Timestamp of the last interaction or heartbeat, used to determine if a participant is currently "online" (active within the last 90 seconds).

### `event_state`
A singleton table that maintains the overarching status of the event and the matchmaking process.

- **`id`** (INTEGER): Always 1, ensuring only a single state record exists.
- **`mode`** (TEXT): The current phase of the event. Can be:
  - `idle`: The default state. Attendees are checking in or mingling freely.
  - `countdown`: A match round is about to start. Displays a countdown on all screens.
  - `match`: The countdown has finished, and matches have been assigned and revealed.
- **`endsAt`** (INTEGER, nullable): An epoch timestamp indicating when the current `countdown` phase will conclude.
- **`round`** (INTEGER): The sequential identifier for the current matching round. Increments every time a new match phase is initiated.
- **`matchCount`** (INTEGER): The number of successful pairings created in the current round.
- **`updatedAt`** (INTEGER): Timestamp of the last state modification.

### `matches`
Records the pairings created during the `match` phase of the event.

- **`id`** (INTEGER): Auto-incrementing primary key.
- **`round`** (INTEGER): The event round during which this match was made (corresponds to `event_state.round`).
- **`participantId`** (TEXT): The ID of the participant (foreign key to `participants.id`).
- **`targetId`** (TEXT): The ID of the assigned partner (foreign key to `participants.id`).
- **`createdAt`** (INTEGER): Timestamp when the match was recorded.

## 2. Event State Flow

The application progresses through states controlled by the host via the Admin Dashboard.

1. **Initialization (`idle`)**
   - The event begins in `idle` mode. The database is empty, and the `event_state` round is 0.
   - Participants scan the QR code, create their profiles, and send heartbeats every 20 seconds to update their `participants.updatedAt` timestamp.
   - The Lounge Display shows the wall of active, `wallEnabled` participants.

2. **Preparation (`countdown`)**
   - The host selects a timer duration (e.g., 10s, 30s) and triggers the match sequence.
   - The `event_state.mode` transitions to `countdown`, and `endsAt` is set to the future timestamp.
   - All polling clients (mobile devices and the Lounge Display) detect this mode change and visually transition to a synchronized countdown screen.

3. **Execution (`match`)**
   - When the countdown concludes, the host client automatically triggers the `/api/host/complete-round` endpoint.
   - The worker executes the matching algorithm:
     - Identifies all "online" participants (`updatedAt` within 90 seconds) who have `matchEnabled = 1`.
     - Groups them by `socialEnergy` to pair anchors (1-2) with explorers (4-5) where possible.
     - Avoids pairing participants who have previously matched in earlier rounds.
   - The resulting pairs are saved to the `matches` table.
   - The `event_state.mode` transitions to `match`, `round` is incremented, and `matchCount` is updated.
   - Mobile clients detect the `match` mode and fetch their specific pairing from the `matches` table to display the result.

4. **Reset (`idle`)**
   - The host resets the round via the Admin Dashboard.
   - The `event_state.mode` returns to `idle`.
   - The UI returns to the default check-in and mingling state, ready for the next round.