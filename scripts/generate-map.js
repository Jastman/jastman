const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const GIFEncoder = require('gif-encoder-2');
const { createCanvas, Image } = require('canvas');

// ─── GIF settings ───────────────────────────────────────────────────────────
const GIF_WIDTH = 800;
const GIF_HEIGHT = 400;
const GIF_FPS = 10;            // frames per second in output GIF
const CAPTURE_INTERVAL_MS = 200; // capture a frame every 200ms during zoom
const ZOOM_DURATION_MS = 20000;  // must match cesium-template duration (20s)
const INITIAL_WAIT_MS = 8000;    // must match cesium-template initial wait
const FINAL_SETTLE_MS = 5000;    // must match cesium-template settle time

function isUnwantedLocation(title, extract) {
  const text = `${title} ${extract}`.toLowerCase();
  const bannedKeywords = [
    'high school', 'middle school', 'elementary school', 'primary school', 'kindergarten',
    'school district', 'public school', 'private school', 'prep school', 'boarded school',
    'shooting', 'massacre', 'attack', 'bombing', 'terrorist', 'terrorism', 'assassination',
    'murder', 'homicide', 'slaughter', 'riot', 'disaster', 'tragedy', 'cemetery', 'graveyard',
    'prison', 'penitentiary', 'jail'
  ];
  return bannedKeywords.some(word => text.includes(word));
}

async function fetchDynamicPointFromWiki() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const randomUrl = 'https://en.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=50&format=json&origin=*';
    const randomRes = await fetch(randomUrl);
    const randomData = await randomRes.json();
    const pageIds = randomData.query.random.map(p => p.id).join('|');

    const dataUrl = `https://en.wikipedia.org/w/api.php?action=query&pageids=${pageIds}&prop=coordinates|extracts&exintro=1&exchars=300&explaintext=1&format=json&origin=*`;
    const dataRes = await fetch(dataUrl);
    const data = await dataRes.json();

    for (const pageId in data.query.pages) {
      const page = data.query.pages[pageId];
      if (page.coordinates && page.coordinates.length > 0) {
        const name = page.title;
        const extract = page.extract ? page.extract.replace(/\n/g, ' ').trim() : '';

        if (isUnwantedLocation(name, extract)) continue;

        return {
          name,
          lon: page.coordinates[0].lon,
          lat: page.coordinates[0].lat,
          height: 1200,
          fact: extract || 'A random location discovered via Wikipedia.'
        };
      }
    }
  }
  throw new Error("Failed to find clean Wikipedia point.");
}

async function captureFramesDuringZoom(page) {
  const frames = [];

  // Wait for zoom to start
  console.log('Waiting for zoom animation to start...');
  await page.waitForFunction('window.zoomStarted === true', { timeout: 30000 });
  console.log('Zoom started — capturing frames...');

  const totalFrames = Math.floor(ZOOM_DURATION_MS / CAPTURE_INTERVAL_MS);

  for (let i = 0; i < totalFrames; i++) {
    const buf = await page.screenshot({ type: 'png' });
    frames.push(buf);
    if (i % 10 === 0) console.log(`  Frame ${i + 1}/${totalFrames}`);
    await new Promise(r => setTimeout(r, CAPTURE_INTERVAL_MS));
  }

  // Wait for final render to complete and capture a few settled frames
  console.log('Waiting for final render completion...');
  await page.waitForFunction('window.renderComplete === true', {
    timeout: FINAL_SETTLE_MS + 10000
  });

  // Grab a few extra frames of the final settled view
  for (let i = 0; i < 10; i++) {
    const buf = await page.screenshot({ type: 'png' });
    frames.push(buf);
    await new Promise(r => setTimeout(r, 200));
  }

  return frames;
}

async function encodeGIF(frames, outputPath) {
  const encoder = new GIFEncoder(GIF_WIDTH, GIF_HEIGHT, 'neuquant', true, frames.length);
  const canvas = createCanvas(GIF_WIDTH, GIF_HEIGHT);
  const ctx = canvas.getContext('2d');
  const delay = Math.round(1000 / GIF_FPS);

  const stream = encoder.createReadStream();
  const writeStream = fs.createWriteStream(outputPath);
  stream.pipe(writeStream);

  encoder.start();
  encoder.setRepeat(0);   // loop forever
  encoder.setDelay(delay);
  encoder.setQuality(10);

  for (const [idx, frameBuf] of frames.entries()) {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = frameBuf;
    });
    ctx.drawImage(img, 0, 0, GIF_WIDTH, GIF_HEIGHT);
    encoder.addFrame(ctx);
    if (idx % 20 === 0) console.log(`  Encoding frame ${idx + 1}/${frames.length}`);
  }

  encoder.finish();

  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
}

async function main() {
  console.log('Starting cinematic GIF generation...');

  const templatePath = path.resolve(__dirname, 'cesium-template.html');
  const pointsPath = path.resolve(__dirname, 'points.json');

  if (!fs.existsSync(templatePath)) throw new Error(`Template not found at ${templatePath}`);
  if (!fs.existsSync(pointsPath)) throw new Error(`Points file not found at ${pointsPath}`);

  let htmlContent = fs.readFileSync(templatePath, 'utf8');
  let todayPoint;

  const useCurated = Math.random() < 0.5;

  if (useCurated) {
    console.log('Picking randomly from curated list...');
    const fallbackPoints = JSON.parse(fs.readFileSync(pointsPath, 'utf8'));
    todayPoint = fallbackPoints[Math.floor(Math.random() * fallbackPoints.length)];
  } else {
    try {
      console.log('Fetching dynamic daily point from Wikipedia...');
      todayPoint = await fetchDynamicPointFromWiki();
      console.log(`Dynamic point: ${todayPoint.name}`);
    } catch (error) {
      console.warn(`[WARNING]: ${error.message} Falling back to static points.json.`);
      const fallbackPoints = JSON.parse(fs.readFileSync(pointsPath, 'utf8'));
      todayPoint = fallbackPoints[Math.floor(Math.random() * fallbackPoints.length)];
    }
  }

  const targetLon = todayPoint.lon || todayPoint.lng;
  const targetLat = todayPoint.lat;
  const targetHeight = todayPoint.height || 1500;
  const locationName = todayPoint.name || 'Unknown Location';
  const fact = todayPoint.fact || '';

  console.log(`Targeting: ${locationName} (Lon: ${targetLon}, Lat: ${targetLat})`);

  htmlContent = htmlContent
    .replace(/LON/g, targetLon)
    .replace(/LAT/g, targetLat)
    .replace(/HEIGHT/g, targetHeight);

  const token = process.env.CESIUM_ION_TOKEN || '';
  htmlContent = htmlContent.replace('INJECT_TOKEN_HERE', token);

  const tempHtmlPath = path.resolve(__dirname, 'temp-render.html');
  fs.writeFileSync(tempHtmlPath, htmlContent);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl',
      '--ignore-gpu-blocklist', '--allow-file-access-from-files'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: GIF_WIDTH, height: GIF_HEIGHT, deviceScaleFactor: 1 });

  // Ensure archive directory exists
  const archiveDir = path.resolve(__dirname, '../assets/world-zooms');
  fs.mkdirSync(archiveDir, { recursive: true });

  let gifPath, staticPath;

  try {
    await page.goto(`file://${tempHtmlPath}`, { waitUntil: 'load' });

    const frames = await captureFramesDuringZoom(page);
    console.log(`Captured ${frames.length} frames. Encoding GIF...`);

    // Timestamped archive copy
    const now = new Date();
    const datestamp = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const archiveGifPath = path.join(archiveDir, `${datestamp}-${locationName.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40)}.gif`);

    gifPath = path.resolve(__dirname, '../assets/random-point.gif');
    staticPath = path.resolve(__dirname, '../assets/random-point.png');

    await encodeGIF(frames, gifPath);
    console.log(`GIF saved: ${gifPath}`);

    // Also save to archive
    fs.copyFileSync(gifPath, archiveGifPath);
    console.log(`Archived: ${archiveGifPath}`);

    // Keep a static PNG (last frame) as fallback
    const lastFrame = frames[frames.length - 1];
    fs.writeFileSync(staticPath, lastFrame);
    console.log(`Static PNG saved: ${staticPath}`);

    // Write caption
    const captionText = `**${locationName}**\n\nCoordinates: ${targetLat}, ${targetLon}\n\n*${fact}*`;
    fs.writeFileSync(path.resolve(__dirname, '../assets/random-point-caption.md'), captionText);

    // Update README
    const readmePath = path.resolve(__dirname, '../README.md');
    if (fs.existsSync(readmePath)) {
      let readmeContent = fs.readFileSync(readmePath, 'utf8');
      const regex = /<!-- START_LOCATION -->[\s\S]*<!-- END_LOCATION -->/;
      const runDate = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
      const runTime = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

      const timestamp = Date.now();
      const injectedMarkdown = `<!-- START_LOCATION -->\n![Cesium Daily World Zoom](assets/random-point.gif?v=${timestamp})\n\n${captionText}\n\n*Last generated: ${runDate} at ${runTime}*\n<!-- END_LOCATION -->`;
      readmeContent = readmeContent.replace(regex, injectedMarkdown);
      fs.writeFileSync(readmePath, readmeContent);
      console.log('README updated.');
    }

  } finally {
    if (browser) await browser.close();
    if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath);
  }
}

main();