# Herald Telegram Bot

Telegram bot for Herald pattern capture.

## Commands

- `/capture` - Reply to a message to capture it as a pattern
- `/patterns [topic]` - Show relevant patterns
- `/reflect <insight>` - Quick capture with explicit text

## Setup

1. Create a bot via @BotFather on Telegram
2. Get the bot token
3. Set environment variables (see `.env.example`)
4. Deploy to Railway

## Environment Variables

- `TELEGRAM_BOT_TOKEN` - Bot token from @BotFather (required)
- `HERALD_API_KEY` - Herald API key (required)
- `HERALD_BASE_URL` - Herald API base URL (default: https://api.getceda.com)
- `DEFAULT_ORG` - Default organization for pattern context (default: telegram)
- `DEFAULT_PROJECT` - Default project for pattern context (default: herald-bot)

## Development

```bash
npm install
npm run dev
```

## Production

```bash
npm run build
npm start
```

## Deploy to Railway

1. Push to GitHub
2. Connect Railway to your repo
3. Set environment variables in Railway
4. Deploy
