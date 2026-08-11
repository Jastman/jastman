const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ─── Capture settings ────────────────────────────────────────────────────────
const GIF_WIDTH = 800;
const GIF_HEIGHT = 400;
const GIF_FPS = 10;
const CAPTURE_INTERVAL_MS = 100; // 100ms between frames = 10fps in output
const ZOOM_DURATION_MS = 20000;  // must match cesium-template duration
const FINAL_SETTLE_MS = 5000;    // must match cesium-template settle time
const MIN_FRAME_BYTES = 30000;   // frames smaller than this are black/blank — skip them
const HOLD_SECONDS = 3;          // seconds to hold the final frame before looping

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

async function captureFrames(page, framesDir) {
  let frameIndex = 0;
  let skipped = 0;

  console.log('Waiting for zoom animation to start...');
  await page.waitForFunction('window.zoomStarted === true', { timeout: 30000 });
  console.log('Zoom started — capturing frames...');

  const totalFrames = Math.floor(ZOOM_DURATION_MS / CAPTURE_INTERVAL_MS);

  for (let i = 0; i < totalFrames; i++) {
    const buf = await page.screenshot({ type: 'png' });
    if (buf.length >= MIN_FRAME_BYTES) {
      const framePath = path.join(framesDir, `frame-${String(frameIndex).padStart(5, '0')}.png`);
      fs.writeFileSync(framePath, buf);
      frameIndex++;
    } else {
      skipped++;
    }
    if (i % 20 === 0) console.log(`  Frame ${i + 1}/${totalFrames} (${skipped} black skipped)`);
    await new Promise(r => setTimeout(r, CAPTURE_INTERVAL_MS));
  }

  // Wait for final settle, then capture hold frames
  console.log('Waiting for final render completion...');
  await page.waitForFunction('window.renderComplete === true', {
    timeout: FINAL_SETTLE_MS + 10000
  });

  // Take one clean final frame and duplicate it for HOLD_SECONDS
  const holdFrame = await page.screenshot({ type: 'png' });
  const holdCount = GIF_FPS * HOLD_SECONDS;
  for (let i = 0; i < holdCount; i++) {
    const framePath = path.join(framesDir, `frame-${String(frameIndex).padStart(5, '0')}.png`);
    fs.writeFileSync(framePath, holdFrame);
    frameIndex++;
  }

  if (frameIndex === 0) throw new Error('All frames were black — tile rendering failed.');
  console.log(`Captured ${frameIndex} frames (${skipped} black skipped, ${holdCount} hold frames).`);
  return frameIndex;
}

function encodeGIF(framesDir, outputPath) {
  const paletteFile = path.join(framesDir, 'palette.png');
  const inputPattern = path.join(framesDir, 'frame-%05d.png');

  // Pass 1: generate an optimised palette from the full frame sequence
  execSync(
    `ffmpeg -y -framerate ${GIF_FPS} -i "${inputPattern}" ` +
    `-vf "fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff" ` +
    `"${paletteFile}"`,
    { stdio: 'inherit' }
  );

  // Pass 2: encode with Bayer dithering and diff-mode rectangle for small file size
  execSync(
    `ffmpeg -y -framerate ${GIF_FPS} -i "${inputPattern}" -i "${paletteFile}" ` +
    `-lavfi "fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" ` +
    `"${outputPath}"`,
    { stdio: 'inherit' }
  );
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
    .replace(/HEIGHT/g, targetHeight)
    .replace('INJECT_TOKEN_HERE', process.env.CESIUM_ION_TOKEN || '');

  const tempHtmlPath = path.resolve(__dirname, 'temp-render.html');
  fs.writeFileSync(tempHtmlPath, htmlContent);

  const framesDir = path.resolve(__dirname, '../assets/_frames_tmp');
  fs.mkdirSync(framesDir, { recursive: true });

  const archiveDir = path.resolve(__dirname, '../assets/world-zooms');
  fs.mkdirSync(archiveDir, { recursive: true });

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

  try {
    await page.goto(`file://${tempHtmlPath}`, { waitUntil: 'load' });
    await captureFrames(page, framesDir);
  } finally {
    await browser.close();
    if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath);
  }

  // Encode GIF via ffmpeg
  const gifPath = path.resolve(__dirname, '../assets/random-point.gif');
  console.log('Encoding GIF with ffmpeg...');
  encodeGIF(framesDir, gifPath);
  console.log(`GIF saved: ${gifPath}`);

  // Archive a timestamped copy
  const now = new Date();
  const datestamp = now.toISOString().slice(0, 10);
  const safeName = locationName.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40);
  const archivePath = path.join(archiveDir, `${datestamp}-${safeName}.gif`);
  fs.copyFileSync(gifPath, archivePath);
  console.log(`Archived: ${archivePath}`);

  // Save last frame as static PNG fallback
  const frames = fs.readdirSync(framesDir).filter(f => f.endsWith('.png')).sort();
  fs.copyFileSync(
    path.join(framesDir, frames[frames.length - 1]),
    path.resolve(__dirname, '../assets/random-point.png')
  );

  // Clean up temp frames
  fs.rmSync(framesDir, { recursive: true, force: true });

  // Write caption
  const captionText = `**${locationName}**\n\nCoordinates: ${targetLat}, ${targetLon}\n\n*${fact}*`;
  fs.writeFileSync(path.resolve(__dirname, '../assets/random-point-caption.md'), captionText);

  // Update README
  const readmePath = path.resolve(__dirname, '../README.md');
  if (fs.existsSync(readmePath)) {
    let readmeContent = fs.readFileSync(readmePath, 'utf8');
    const runDate = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
    const runTime = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    const timestamp = Date.now();
    const injectedMarkdown =
      `<!-- START_LOCATION -->\n![Cesium Daily World Zoom](assets/random-point.gif?v=${timestamp})\n\n` +
      `${captionText}\n\n*Last generated: ${runDate} at ${runTime}*\n<!-- END_LOCATION -->`;
    readmeContent = readmeContent.replace(/<!-- START_LOCATION -->[\s\S]*<!-- END_LOCATION -->/, injectedMarkdown);
    fs.writeFileSync(readmePath, readmeContent);
    console.log('README updated.');
  }
}

main();
