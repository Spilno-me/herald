import { App, LogLevel } from '@slack/bolt';
import dotenv from 'dotenv';

dotenv.config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  logLevel: LogLevel.INFO,
});

const HERALD_API_BASE = 'https://api.getceda.com';

interface HeraldContext {
  org: string;
  project: string;
}

interface ReflectPayload {
  insight: string;
  feeling: 'success' | 'stuck';
  context: HeraldContext;
}

interface PatternsPayload {
  topic?: string;
  context: HeraldContext;
}

interface ThreadMessage {
  user?: string;
  text?: string;
  ts?: string;
}

async function callHeraldAPI(endpoint: string, payload: ReflectPayload | PatternsPayload): Promise<unknown> {
  const response = await fetch(`${HERALD_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.HERALD_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Herald API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

function summarizeThread(messages: ThreadMessage[]): string {
  if (messages.length === 0) {
    return 'No messages found in this thread.';
  }

  const messageTexts = messages
    .filter(msg => msg.text)
    .map(msg => msg.text)
    .join('\n\n');

  const summary = `Thread Summary (${messages.length} messages):\n\n${messageTexts}`;
  return summary;
}

function extractContext(channelName: string): HeraldContext {
  return {
    org: 'slack-workspace',
    project: channelName || 'general',
  };
}

app.command('/herald', async ({ command, ack, respond, client }) => {
  await ack();

  const args = command.text.trim().split(/\s+/);
  const subcommand = args[0]?.toLowerCase();

  if (subcommand === 'capture') {
    if (!command.channel_id) {
      await respond({
        text: 'Unable to determine channel. Please try again.',
        response_type: 'ephemeral',
      });
      return;
    }

    const threadTs = (command as { thread_ts?: string }).thread_ts;
    
    if (!threadTs) {
      await respond({
        text: 'Please use `/herald capture` in a thread to capture the conversation as a pattern.',
        response_type: 'ephemeral',
      });
      return;
    }

    try {
      const result = await client.conversations.replies({
        channel: command.channel_id,
        ts: threadTs,
      });

      const messages = (result.messages || []) as ThreadMessage[];
      const summary = summarizeThread(messages);

      let channelName = 'general';
      try {
        const channelInfo = await client.conversations.info({
          channel: command.channel_id,
        });
        channelName = (channelInfo.channel as { name?: string })?.name || 'general';
      } catch {
        console.log('Could not fetch channel name, using default');
      }

      await respond({
        text: 'Thread captured! Review the summary below:',
        response_type: 'ephemeral',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Thread Captured!*\n\nReview the summary below:',
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `\`\`\`${summary.substring(0, 2900)}\`\`\``,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Save as Pattern',
                  emoji: true,
                },
                style: 'primary',
                action_id: 'save_pattern',
                value: JSON.stringify({
                  summary,
                  channel: channelName,
                  thread_ts: threadTs,
                }),
              },
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Discard',
                  emoji: true,
                },
                style: 'danger',
                action_id: 'discard_pattern',
              },
            ],
          },
        ],
      });
    } catch (error) {
      console.error('Error capturing thread:', error);
      await respond({
        text: `Error capturing thread: ${error instanceof Error ? error.message : 'Unknown error'}. Make sure the bot has access to this channel.`,
        response_type: 'ephemeral',
      });
    }
  } else if (subcommand === 'patterns') {
    const topic = args.slice(1).join(' ') || undefined;

    try {
      let channelName = 'general';
      try {
        const channelInfo = await client.conversations.info({
          channel: command.channel_id,
        });
        channelName = (channelInfo.channel as { name?: string })?.name || 'general';
      } catch {
        console.log('Could not fetch channel name, using default');
      }

      const context = extractContext(channelName);
      const payload: PatternsPayload = {
        context,
      };
      if (topic) {
        payload.topic = topic;
      }

      const result = await callHeraldAPI('/v1/patterns', payload);

      const patterns = result as { patterns?: Array<{ title?: string; description?: string }> };
      
      if (!patterns.patterns || patterns.patterns.length === 0) {
        await respond({
          text: topic 
            ? `No patterns found for topic: "${topic}"`
            : 'No patterns found. Start capturing threads to build your pattern library!',
          response_type: 'ephemeral',
        });
        return;
      }

      const patternBlocks = patterns.patterns.slice(0, 5).map((pattern, index) => ({
        type: 'section' as const,
        text: {
          type: 'mrkdwn' as const,
          text: `*${index + 1}. ${pattern.title || 'Untitled Pattern'}*\n${pattern.description || 'No description'}`,
        },
      }));

      await respond({
        text: 'Here are the relevant patterns:',
        response_type: 'ephemeral',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: topic 
                ? `*Patterns for "${topic}":*`
                : '*Recent Patterns:*',
            },
          },
          ...patternBlocks,
        ],
      });
    } catch (error) {
      console.error('Error fetching patterns:', error);
      await respond({
        text: `Error fetching patterns: ${error instanceof Error ? error.message : 'Unknown error'}`,
        response_type: 'ephemeral',
      });
    }
  } else {
    await respond({
      text: '*Herald Commands:*\n\n`/herald capture` - Use in a thread to capture the conversation as a pattern\n`/herald patterns [topic]` - Show relevant patterns, optionally filtered by topic',
      response_type: 'ephemeral',
    });
  }
});

app.action('save_pattern', async ({ ack, body, respond }) => {
  await ack();

  try {
    const actionBody = body as {
      actions?: Array<{ value?: string }>;
    };
    const value = actionBody.actions?.[0]?.value;
    if (!value) {
      throw new Error('No pattern data found');
    }

    const { summary, channel } = JSON.parse(value) as { summary: string; channel: string };
    const context = extractContext(channel);

    const payload: ReflectPayload = {
      insight: summary,
      feeling: 'success',
      context,
    };

    await callHeraldAPI('/v1/reflect', payload);

    await respond({
      text: 'Pattern saved successfully to Herald!',
      response_type: 'ephemeral',
      replace_original: true,
    });
  } catch (error) {
    console.error('Error saving pattern:', error);
    await respond({
      text: `Error saving pattern: ${error instanceof Error ? error.message : 'Unknown error'}`,
      response_type: 'ephemeral',
      replace_original: true,
    });
  }
});

app.action('discard_pattern', async ({ ack, respond }) => {
  await ack();

  await respond({
    text: 'Pattern discarded.',
    response_type: 'ephemeral',
    replace_original: true,
  });
});

(async () => {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.start(port);
  console.log(`Herald Slack app is running on port ${port}!`);
})();
