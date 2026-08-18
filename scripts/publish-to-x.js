const fs = require('fs');
const path = require('path');
const { TwitterApi } = require('twitter-api-v2');

const MAX_POST_LENGTH = 280;
const gifPath = path.resolve(__dirname, '../assets/random-point.gif');
const captionPath = path.resolve(__dirname, '../assets/random-point-caption.md');

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildPostText(caption) {
  const title = caption.match(/^\*\*(.+?)\*\*\s*$/m)?.[1]?.trim() || 'A random corner of the Earth';
  const coordinates = caption.match(/^Coordinates:\s*(.+)$/m)?.[1]?.trim();
  const factLine = caption
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.startsWith('*') && !line.startsWith('**') && line.endsWith('*'));
  const fact = factLine?.slice(1, -1).trim().replace(/\s+/g, ' ') || 'A place discovered with CesiumJS.';
  const location = truncateText(title, 120);
  const coordinateText = coordinates ? `Coordinates: ${coordinates}` : '';
  const postPrefix = [location, coordinateText].filter(Boolean).join('\n');
  const factBudget = MAX_POST_LENGTH - postPrefix.length - 1;
  const factText = truncateText(fact, Math.max(0, factBudget));

  return `${postPrefix}\n${factText}`;
}

function getRequiredEnvironment() {
  const required = [
    'X_API_KEY',
    'X_API_SECRET',
    'X_ACCESS_TOKEN',
    'X_ACCESS_TOKEN_SECRET'
  ];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required X credentials: ${missing.join(', ')}`);
  }
}

async function main() {
  getRequiredEnvironment();

  if (!fs.existsSync(gifPath)) throw new Error(`Render not found at ${gifPath}`);
  if (!fs.existsSync(captionPath)) throw new Error(`Caption not found at ${captionPath}`);

  const caption = fs.readFileSync(captionPath, 'utf8');
  const postText = buildPostText(caption);
  const client = new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET
  });

  console.log(`Uploading ${path.basename(gifPath)} to X...`);
  const mediaId = await client.v2.uploadMedia(fs.readFileSync(gifPath), {
    media_type: 'image/gif',
    media_category: 'tweet_gif'
  });
  const tweet = await client.v2.tweet({
    text: postText,
    media: { media_ids: [mediaId] }
  });

  console.log(`Published X post ${tweet.data.id}`);
  console.log(`Post text: ${postText}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error('X publishing failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = { buildPostText };
