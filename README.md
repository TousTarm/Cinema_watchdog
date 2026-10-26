# Cinema Watchdog

A small bot that watched Cinema City for new screenings of *The Odyssey* in IMAX 70mm at Praha Flora and sent me a Telegram message as soon as new ones went on sale. I had promised my parents we would go, and the good seats sold out within minutes of each release. It worked: the whole family saw it from great seats.

The film, cinema and format are hardcoded, so this is a one-off tool rather than a general watcher. Messages and logs are in Czech.

## What it does

- Every 5 minutes (plus 0–60 s of random jitter) it queries the Cinema City quickbook API for each of the next 31 days, skipping August 2026.
- Keeps screenings that match the film ID, have the `70-mm` attribute, are not sold out and are not blocked for online sales.
- The first check only records the screenings that already exist; later checks send a Telegram message with the dates and times of new ones and a purchase link.
- Telegram commands, answered only in the configured chat:
  - `/test` replies `ONLINE`
  - `/release` or `/released` lists the currently available dates and the number of screenings
  - `/time` shows the time until the next check

## Requirements

- Node.js 20 and npm, or Docker with Docker Compose
- A Telegram bot token (from BotFather) and the ID of the chat it should write to

## Configuration

Create `.env` in the project root:

```
TELEGRAM_TOKEN=<bot token>
TELEGRAM_CHAT_ID=<chat id>
```

Both are required; without them the app exits. To watch a different film, cinema or date range, change the constants at the top of `index.ts` (`CINEMA_ID`, `FILM_ID`, `TARGET_ATTR`, `DAYS_TO_CHECK`), the August skip in `checkAvailability()` and the purchase link.

## Running

```bash
npm ci
npm start          # runs index.ts with tsx
```

With Docker:

```bash
docker compose up -d --build
```

## Tests

There are no tests.

## Structure

```
index.ts            the whole bot: API polling, change detection, Telegram commands
Dockerfile          node:20-alpine image running npm start
docker-compose.yml  one service, reads .env
```

Built with the help of AI coding tools.
