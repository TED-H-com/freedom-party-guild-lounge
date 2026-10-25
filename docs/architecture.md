# System Architecture

The Freedom Party Guild Lounge is a distributed edge application built with modern web technologies, designed to handle real-time event check-ins, social matching, and state synchronization across multiple clients.

## High-Level Architecture

The system operates across three primary layers: Frontend (Client), Edge Worker (API & Logic), and Storage (Database & Assets).

### 1. Frontend Layer (React 19 + Vite 6)
The client-side application is a single-page application (SPA) built with React. It serves three distinct user interfaces from a unified codebase (`src/App.jsx`):
- **Mobile Check-in (`/?surface=checkin`)**: The public interface for attendees to register, create identity badges, and view their personalized match results.
- **Lounge Display (`/?surface=lounge`)**: A public display screen (requires host token) showing the QR code, wall of attendees, and live event countdown.
- **Admin Dashboard (`/?surface=admin`)**: A control panel for event hosts to manage event state, start countdowns, and reset data.

**Key Frontend Characteristics:**
- **State Synchronization**: Uses a short-polling mechanism (`usePolling` hook) to continuously fetch the latest state from the backend.
- **Identity Management**: Uses `localStorage` to persist a unique identity token (`guild:identity:v2`) per device.
- **Visuals**: CSS-based responsive layouts, Phosphor Icons for UI elements, and HTML5 Canvas for generating downloadable badge PNGs.

### 2. Edge API Layer (Cloudflare Workers)
The backend logic is entirely implemented as a serverless Edge function (`worker/index.js`).

**Key Responsibilities:**
- **API Routing**: Handles all RESTful endpoints (e.g., `/api/event`, `/api/participants`, `/api/matches`).
- **Authentication**: Verifies participant tokens for attendee actions and the `HOST_TOKEN` for administrative actions.
- **Matching Algorithm**: Executes the logic to pair participants based on social energy levels, round history, and current online status when a round is completed.
- **Heartbeat & Presence**: Tracks active participants via a heartbeat endpoint to ensure matches only occur between currently online attendees.

### 3. Data & Storage Layer (Cloudflare D1)
All structured data and relational state is stored in Cloudflare D1, accessed using Drizzle ORM (`db/schema.ts`).

**Key Characteristics:**
- **Authoritative State**: D1 is the single source of truth for the event state, registered participants, and historical matches.
- **Schema Management**: Database changes are managed via Drizzle migrations.
- **Deployment**: Configured for deployment on OpenAI Sites, binding the D1 database to the edge worker (`.openai/hosting.json`).

## Data Flow Overview

1. **Check-in**: A user scans the QR code, fills out their profile on the frontend, which sends a POST request to `/api/participants`. The worker hashes the token and stores the record in D1.
2. **Synchronization**: The Lounge Display and Admin Dashboard poll `/api/host/participants` and `/api/event` to display real-time updates.
3. **Matching Initiation**: The host triggers a countdown via the Admin Dashboard. Once the countdown completes, a POST request to `/api/host/complete-round` is fired.
4. **Matching Execution**: The worker queries D1 for online, match-enabled participants, performs the pairing algorithm, stores the pairs in the `matches` table, and updates the `eventState` mode to `match`.
5. **Result Delivery**: Mobile clients, which are polling `/api/event` and `/api/matches/me`, detect the mode change to `match` and fetch their specific pairing information.
