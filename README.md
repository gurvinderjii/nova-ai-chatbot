# Nova — AI Chat Assistant

A themed, animated AI chat assistant. The frontend is plain HTML/CSS/JS (no framework, no build step); a small Node.js/Express backend streams real replies from Google Gemini (free tier) or OpenAI.

## Features

- Dark/light theme with smooth transitions, persisted across sessions
- Streaming ("typewriter") replies with a typing indicator
- Sidebar with conversation history, persisted in `localStorage`
- Fully responsive, from small phones to large desktops
- Toast notifications for features that aren't available yet
- Pluggable AI backend — Gemini (default, free tier) or OpenAI
- Dockerized for easy deployment

## Tech stack

- **Frontend:** Vanilla HTML/CSS/JS
- **Backend:** Node.js + Express, streaming replies over Server-Sent Events
- **AI providers:** Google Gemini API / OpenAI API (called directly over HTTP, no SDK)
- **Containerization:** Docker + Docker Compose

## Project structure

```
.
├── public/               # Frontend, served statically
│   ├── index.html
│   ├── style.css
│   └── script.js
├── server.js             # Express app + AI provider proxy
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── .claude/launch.json   # Dev server config for the Claude Code preview pane
```

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Then edit `.env`:

| Variable          | Default                  | Notes                                                              |
|-------------------|---------------------------|----------------------------------------------------------------------|
| `AI_PROVIDER`     | `gemini`                 | `gemini` or `openai`                                                  |
| `GEMINI_API_KEY`  | *(empty)*                | Free key: https://aistudio.google.com/apikey                         |
| `GEMINI_MODEL`    | `gemini-3.5-flash-lite`  | Used when `AI_PROVIDER=gemini`                                        |
| `OPENAI_API_KEY`  | *(empty)*                | Only needed when `AI_PROVIDER=openai` (requires a paid OpenAI account) |
| `OPENAI_MODEL`    | `gpt-4o-mini`            | Used when `AI_PROVIDER=openai`                                        |
| `PORT`            | `4173`                   | Local server port                                                     |

### 3. Run

```bash
node server.js
```

Open [http://localhost:4173](http://localhost:4173).

## Run with Docker

```bash
docker compose up --build
```

This builds the image, reads your `.env` for config/secrets, and serves the app on port 4173.

## Notes

- Conversation history and theme preference are stored only in the browser (`localStorage`) — there is no database.
- The attach button in the composer is a UI placeholder; clicking it shows a toast rather than doing nothing silently.
