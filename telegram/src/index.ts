import { Bot, InlineKeyboard, Context } from 'grammy';
import { HeraldClient } from './herald-client';
import * as dotenv from 'dotenv';

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const HERALD_API_KEY = process.env.HERALD_API_KEY;
const HERALD_BASE_URL = process.env.CEDA_API_URL || process.env.HERALD_BASE_URL || 'https://getceda.com';
const DEFAULT_ORG = process.env.DEFAULT_ORG || 'telegram';
const DEFAULT_PROJECT = process.env.DEFAULT_PROJECT || 'herald-bot';

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is required');
}

if (!HERALD_API_KEY) {
  throw new Error('HERALD_API_KEY is required');
}

const bot = new Bot(TELEGRAM_BOT_TOKEN);
const heraldClient = new HeraldClient(HERALD_BASE_URL, HERALD_API_KEY);

const pendingCaptures = new Map<string, { text: string; chatId: number; messageId: number }>();

bot.command('start', async (ctx) => {
  await ctx.reply(
    'Welcome to Herald Pattern Capture Bot!\n\n' +
    'Commands:\n' +
    '/capture - Reply to a message to capture it as a pattern\n' +
    '/patterns [topic] - Show relevant patterns\n' +
    '/reflect <insight> - Quick capture with explicit text\n\n' +
    'To capture a message, reply to it with /capture'
  );
});

bot.command('capture', async (ctx) => {
  const replyMessage = ctx.message?.reply_to_message;
  
  if (!replyMessage) {
    await ctx.reply(
      'Please reply to a message you want to capture.\n\n' +
      'Usage: Reply to a message and type /capture'
    );
    return;
  }

  const text = 'text' in replyMessage ? replyMessage.text : null;
  
  if (!text) {
    await ctx.reply('The replied message does not contain text to capture.');
    return;
  }

  const messageId = ctx.message?.message_id ?? 0;
  const captureId = `${ctx.chat.id}_${Date.now()}`;
  pendingCaptures.set(captureId, {
    text,
    chatId: ctx.chat.id,
    messageId,
  });

  const keyboard = new InlineKeyboard()
    .text('Yes', `capture_yes_${captureId}`)
    .text('No', `capture_no_${captureId}`);

  const preview = text.length > 100 ? text.substring(0, 100) + '...' : text;
  
  await ctx.reply(
    `Capture this?\n\n"${preview}"`,
    { reply_markup: keyboard }
  );
});

bot.callbackQuery(/^capture_yes_(.+)$/, async (ctx) => {
  const captureId = ctx.match[1];
  const capture = pendingCaptures.get(captureId);

  if (!capture) {
    await ctx.answerCallbackQuery({ text: 'Capture expired or not found' });
    return;
  }

  try {
    await heraldClient.reflect({
      insight: capture.text,
      feeling: 'success',
      context: {
        org: DEFAULT_ORG,
        project: DEFAULT_PROJECT,
      },
    });

    pendingCaptures.delete(captureId);
    await ctx.answerCallbackQuery({ text: 'Pattern captured!' });
    await ctx.editMessageText('Pattern captured successfully!');
  } catch (error) {
    console.error('Error capturing pattern:', error);
    await ctx.answerCallbackQuery({ text: 'Failed to capture pattern' });
    await ctx.editMessageText(`Failed to capture pattern: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

bot.callbackQuery(/^capture_no_(.+)$/, async (ctx) => {
  const captureId = ctx.match[1];
  pendingCaptures.delete(captureId);
  await ctx.answerCallbackQuery({ text: 'Capture cancelled' });
  await ctx.editMessageText('Capture cancelled.');
});

bot.command('patterns', async (ctx) => {
  const topic = ctx.match?.trim() || undefined;

  try {
    const response = await heraldClient.patterns({
      topic,
      context: {
        org: DEFAULT_ORG,
        project: DEFAULT_PROJECT,
      },
    });

    if (!response.patterns || response.patterns.length === 0) {
      await ctx.reply(topic 
        ? `No patterns found for topic: "${topic}"`
        : 'No patterns found.'
      );
      return;
    }

    const patternList = response.patterns
      .slice(0, 10)
      .map((p, i) => `${i + 1}. ${p.insight.substring(0, 100)}${p.insight.length > 100 ? '...' : ''}`)
      .join('\n\n');

    await ctx.reply(
      `Found ${response.patterns.length} pattern(s)${topic ? ` for "${topic}"` : ''}:\n\n${patternList}`
    );
  } catch (error) {
    console.error('Error fetching patterns:', error);
    await ctx.reply(`Failed to fetch patterns: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

bot.command('reflect', async (ctx) => {
  const insight = ctx.match?.trim();

  if (!insight) {
    await ctx.reply(
      'Please provide an insight to capture.\n\n' +
      'Usage: /reflect <your insight here>'
    );
    return;
  }

  try {
    await heraldClient.reflect({
      insight,
      feeling: 'success',
      context: {
        org: DEFAULT_ORG,
        project: DEFAULT_PROJECT,
      },
    });

    await ctx.reply('Pattern captured successfully!');
  } catch (error) {
    console.error('Error capturing reflection:', error);
    await ctx.reply(`Failed to capture pattern: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

bot.catch((err) => {
  console.error('Bot error:', err);
});

console.log('Starting Herald Telegram Bot...');
bot.start();
