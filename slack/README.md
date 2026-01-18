# Herald Slack App

A Slack bot that brings Herald pattern capture to team conversations.

## Features

- `/herald capture` - Summarize a thread and offer to save it as a pattern
- `/herald patterns [topic]` - Show relevant patterns, optionally filtered by topic

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Choose "From scratch" and give it a name (e.g., "Herald")
3. Select your workspace

### 2. Configure Bot Permissions

Go to **OAuth & Permissions** and add these Bot Token Scopes:
- `commands` - For slash commands
- `chat:write` - To send messages
- `channels:history` - To read thread messages

### 3. Enable Slash Commands

Go to **Slash Commands** and create a new command:
- Command: `/herald`
- Request URL: `https://your-railway-app.railway.app/slack/events`
- Short Description: Capture patterns from conversations
- Usage Hint: `capture | patterns [topic]`

### 4. Enable Interactivity

Go to **Interactivity & Shortcuts**:
- Turn on Interactivity
- Request URL: `https://your-railway-app.railway.app/slack/events`

### 5. Install to Workspace

Go to **Install App** and click "Install to Workspace"

### 6. Get Credentials

- **Bot Token**: Found in OAuth & Permissions (starts with `xoxb-`)
- **Signing Secret**: Found in Basic Information

## Environment Variables

```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
HERALD_API_KEY=your-herald-api-key
PORT=3000
```

## Deployment to Railway

1. Push this repo to GitHub
2. Create a new project on [Railway](https://railway.app)
3. Connect your GitHub repo
4. Add environment variables in Railway dashboard
5. Deploy!

Railway will automatically:
- Detect Node.js
- Run `npm install`
- Run `npm run build`
- Start with `npm start`

## Local Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your credentials
# Then run in development mode
npm run dev
```

For local testing, use [ngrok](https://ngrok.com) to expose your local server:

```bash
ngrok http 3000
```

Then update your Slack app's Request URLs with the ngrok URL.

## Usage

### Capture a Pattern

1. Navigate to any thread in Slack
2. Type `/herald capture`
3. Review the thread summary
4. Click "Save as Pattern" or "Discard"

### Find Patterns

```
/herald patterns           # Show all recent patterns
/herald patterns debugging # Show patterns about debugging
```

## Herald API

This app integrates with the Herald API at `https://api.getceda.com`:

- `POST /v1/reflect` - Save a pattern
- `POST /v1/patterns` - Retrieve patterns
