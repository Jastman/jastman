const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execFileSync, execSync } = require('child_process');
const { PNG } = require('pngjs');

// ─── Capture settings ────────────────────────────────────────────────────────
const GIF_WIDTH = 800;
const GIF_HEIGHT = 400;
const GIF_FPS = 10;
const CAPTURE_INTERVAL_MS = 100; // 100ms between frames = 10fps in output
const ZOOM_DURATION_MS = 20000;  // must match cesium-template duration
const FINAL_SETTLE_MS = 5000;    // must match cesium-template settle time
const MIN_FRAME_BYTES = 256;     // catches empty/corrupt PNGs; pixel checks are authoritative
const PIXEL_SAMPLE_STRIDE = 4;
const MIN_NON_BLACK_RATIO = 0.02;
const MIN_AVERAGE_LUMA = 8;
const MIN_PEAK_LUMA = 32;
const FINAL_FRAME_ATTEMPTS = 15;
const FINAL_FRAME_RETRY_MS = 1000;
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

function inspectFrame(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < MIN_FRAME_BYTES) {
    return { valid: false, reason: 'PNG buffer is empty or too small' };
  }

  let image;
  try {
    image = PNG.sync.read(buffer);
  } catch {
    return { valid: false, reason: 'PNG could not be decoded' };
  }

  if (image.width !== GIF_WIDTH || image.height !== GIF_HEIGHT) {
    return {
      valid: false,
      reason: `unexpected dimensions ${image.width}x${image.height}`
    };
  }

  let sampledPixels = 0;
  let nonBlackPixels = 0;
  let totalLuma = 0;
  let peakLuma = 0;

  for (let y = 0; y < image.height; y += PIXEL_SAMPLE_STRIDE) {
    for (let x = 0; x < image.width; x += PIXEL_SAMPLE_STRIDE) {
      const offset = (y * image.width + x) * 4;
      const alpha = image.data[offset + 3];
      if (alpha < 16) continue;

      const luma =
        (0.2126 * image.data[offset]) +
        (0.7152 * image.data[offset + 1]) +
        (0.0722 * image.data[offset + 2]);

      sampledPixels++;
      totalLuma += luma;
      peakLuma = Math.max(peakLuma, luma);
      if (luma >= MIN_PEAK_LUMA) nonBlackPixels++;
    }
  }

  if (sampledPixels === 0) {
    return { valid: false, reason: 'PNG contains no visible pixels' };
  }

  const averageLuma = totalLuma / sampledPixels;
  const nonBlackRatio = nonBlackPixels / sampledPixels;
  const valid =
    nonBlackRatio >= MIN_NON_BLACK_RATIO &&
    averageLuma >= MIN_AVERAGE_LUMA &&
    peakLuma >= MIN_PEAK_LUMA;

  return {
    valid,
    averageLuma,
    nonBlackRatio,
    peakLuma,
    reason: valid
      ? 'ok'
      : `too dark (average luma ${averageLuma.toFixed(1)}, ` +
        `${(nonBlackRatio * 100).toFixed(1)}% non-black pixels)`
  };
}

async function captureUsableFrame(page) {
  let lastReason = 'no frame captured';

  for (let attempt = 1; attempt <= FINAL_FRAME_ATTEMPTS; attempt++) {
    const frame = await page.screenshot({ type: 'png' });
    const quality = inspectFrame(frame);
    if (quality.valid) return frame;

    lastReason = quality.reason;
    console.warn(
      `[WARNING]: Final frame was not usable (attempt ${attempt}/${FINAL_FRAME_ATTEMPTS}: ${quality.reason}).`
    );
    if (attempt < FINAL_FRAME_ATTEMPTS) {
      await new Promise(resolve => setTimeout(resolve, FINAL_FRAME_RETRY_MS));
    }
  }

  console.warn(`[WARNING]: Final frame validation failed: ${lastReason}`);
  return null;
}

async function throwIfRenderFailed(page, phase) {
  const renderError = await page.evaluate(() => window.renderError);
  if (renderError) {
    throw new Error(`Cesium render failed ${phase}: ${renderError}`);
  }
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
  let lastGoodFrame = null;

  console.log('Waiting for zoom animation to start...');
  await page.waitForFunction(
    'window.zoomStarted === true || window.renderError !== null',
    { timeout: 30000 }
  );
  await throwIfRenderFailed(page, 'before capture');
  console.log('Zoom started — capturing frames...');

  const totalFrames = Math.floor(ZOOM_DURATION_MS / CAPTURE_INTERVAL_MS);

  for (let i = 0; i < totalFrames; i++) {
    const buf = await page.screenshot({ type: 'png' });
    const quality = inspectFrame(buf);
    if (quality.valid) {
      const framePath = path.join(framesDir, `frame-${String(frameIndex).padStart(5, '0')}.png`);
      fs.writeFileSync(framePath, buf);
      frameIndex++;
      lastGoodFrame = buf;
    } else {
      skipped++;
    }
    if (i % 20 === 0) console.log(`  Frame ${i + 1}/${totalFrames} (${skipped} unusable skipped)`);
    await new Promise(r => setTimeout(r, CAPTURE_INTERVAL_MS));
  }

  // Wait for final settle, then capture hold frames
  console.log('Waiting for final render completion...');
  await page.waitForFunction('window.renderComplete === true', {
    timeout: FINAL_SETTLE_MS + 10000
  });
  await throwIfRenderFailed(page, 'during capture');

  // Retry the final screenshot so a transient blank render is never duplicated.
  let holdFrame = await captureUsableFrame(page);
  if (!holdFrame && lastGoodFrame) {
    console.warn('[WARNING]: Using the last verified frame for the final hold.');
    holdFrame = lastGoodFrame;
  }
  if (!holdFrame) {
    throw new Error('No usable rendered frame was captured.');
  }

  const holdCount = GIF_FPS * HOLD_SECONDS;
  for (let i = 0; i < holdCount; i++) {
    const framePath = path.join(framesDir, `frame-${String(frameIndex).padStart(5, '0')}.png`);
    fs.writeFileSync(framePath, holdFrame);
    frameIndex++;
  }

  console.log(`Captured ${frameIndex} frames (${skipped} unusable skipped, ${holdCount} hold frames).`);
  return { frameCount: frameIndex, finalFrame: holdFrame };
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

function verifyEncodedGIF(outputPath, framesDir) {
  const frameCountText = execFileSync(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-count_frames',
      '-show_entries', 'stream=nb_read_frames',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      outputPath
    ],
    { encoding: 'utf8' }
  ).trim();
  const frameCount = Number(frameCountText);
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new Error(`Could not determine the encoded GIF frame count: ${frameCountText}`);
  }

  const finalFramePath = path.join(framesDir, 'encoded-final.png');
  try {
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel', 'error',
        '-i', outputPath,
        '-vf', `select=eq(n\\,${frameCount - 1})`,
        '-frames:v', '1',
        finalFramePath
      ],
      { stdio: 'inherit' }
    );

    const quality = inspectFrame(fs.readFileSync(finalFramePath));
    if (!quality.valid) {
      throw new Error(`Encoded GIF final frame is not usable: ${quality.reason}`);
    }
  } finally {
    if (fs.existsSync(finalFramePath)) fs.unlinkSync(finalFramePath);
  }
}

async function main() {
  console.log('Starting cinematic GIF generation...');

  const templatePath = path.resolve(__dirname, 'cesium-template.html');
  const pointsPath = path.resolve(__dirname, 'points.json');

  if (!fs.existsSync(templatePath)) throw new Error(`Template not found at ${templatePath}`);
  if (!fs.existsSync(pointsPath)) throw new Error(`Points file not found at ${pointsPath}`);

  let htmlContent = fs.readFileSync(templatePath, 'utf8');
  let todayPoint;
  const fallbackPoints = JSON.parse(fs.readFileSync(pointsPath, 'utf8'));
  const requestedLocation = process.env.RENDER_LOCATION?.trim();

  if (requestedLocation) {
    todayPoint = fallbackPoints.find(point =>
      point.name.toLowerCase() === requestedLocation.toLowerCase()
    );
    if (!todayPoint) {
      throw new Error(`Requested curated location not found: ${requestedLocation}`);
    }
    console.log(`Rendering requested location: ${todayPoint.name}`);
  } else if (Math.random() < 0.5) {
    console.log('Picking randomly from curated list...');
    todayPoint = fallbackPoints[Math.floor(Math.random() * fallbackPoints.length)];
  } else {
    try {
      console.log('Fetching dynamic daily point from Wikipedia...');
      todayPoint = await fetchDynamicPointFromWiki();
      console.log(`Dynamic point: ${todayPoint.name}`);
    } catch (error) {
      console.warn(`[WARNING]: ${error.message} Falling back to static points.json.`);
      todayPoint = fallbackPoints[Math.floor(Math.random() * fallbackPoints.length)];
    }
  }

  const targetLon = todayPoint.lon || todayPoint.lng;
  const targetLat = todayPoint.lat;
  const targetHeight = todayPoint.height || 1500;
  const targetFocusHeight = Number.isFinite(todayPoint.focusHeight)
    ? todayPoint.focusHeight
    : 0;
  const locationName = todayPoint.name || 'Unknown Location';
  const fact = todayPoint.fact || '';

  console.log(`Targeting: ${locationName} (Lon: ${targetLon}, Lat: ${targetLat})`);

  htmlContent = htmlContent
    .replace(/LON/g, targetLon)
    .replace(/LAT/g, targetLat)
    .replace(/FOCUS_HEIGHT_HERE/g, targetFocusHeight)
    .replace(/HEIGHT/g, targetHeight)
    .replace('INJECT_TOKEN_HERE', process.env.CESIUM_ION_TOKEN || '');

  const tempHtmlPath = path.resolve(__dirname, 'temp-render.html');
  fs.writeFileSync(tempHtmlPath, htmlContent);

  const framesDir = path.resolve(__dirname, '../assets/_frames_tmp');
  if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const archiveDir = path.resolve(__dirname, '../assets/world-zooms');
  fs.mkdirSync(archiveDir, { recursive: true });

  try {
    let captureResult;
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl',
        '--ignore-gpu-blocklist', '--allow-file-access-from-files'
      ]
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: GIF_WIDTH, height: GIF_HEIGHT, deviceScaleFactor: 1 });
      await page.goto(`file://${tempHtmlPath}`, { waitUntil: 'load' });
      captureResult = await captureFrames(page, framesDir);
    } finally {
      await browser.close();
    }

    // Encode GIF via ffmpeg and verify the encoded final frame too.
    const gifPath = path.resolve(__dirname, '../assets/random-point.gif');
    const candidateGifPath = path.join(framesDir, 'generated.gif');
    console.log('Encoding GIF with ffmpeg...');
    encodeGIF(framesDir, candidateGifPath);
    verifyEncodedGIF(candidateGifPath, framesDir);
    fs.copyFileSync(candidateGifPath, gifPath);
    console.log(`GIF saved: ${gifPath}`);

    // Archive a timestamped copy
    const now = new Date();
    const datestamp = now.toISOString().slice(0, 10);
    const safeName = locationName.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40);
    const archivePath = path.join(archiveDir, `${datestamp}-${safeName}.gif`);
    fs.copyFileSync(gifPath, archivePath);
    console.log(`Archived: ${archivePath}`);

    // Save the verified rendered frame, never ffmpeg's palette image.
    fs.writeFileSync(
      path.resolve(__dirname, '../assets/random-point.png'),
      captureResult.finalFrame
    );

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
  } finally {
    if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath);
    if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main();
}

module.exports = { inspectFrame, verifyEncodedGIF };
