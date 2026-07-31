const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

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

async function main() {
  console.log('Starting map generation process...');

  const templatePath = path.resolve(__dirname, 'cesium-template.html');
  const pointsPath = path.resolve(__dirname, 'points.json');
  
  if (!fs.existsSync(templatePath)) throw new Error(`Template not found at ${templatePath}`);
  if (!fs.existsSync(pointsPath)) throw new Error(`Points file not found at ${pointsPath}`);

  let htmlContent = fs.readFileSync(templatePath, 'utf8');
  let todayPoint;

  // Hybrid Approach: 50% chance to use curated list, 50% chance for Wikipedia
  const useCurated = Math.random() < 0.5;

  if (useCurated) {
    console.log('Picking randomly from your curated 100-item list...');
    const fallbackPoints = JSON.parse(fs.readFileSync(pointsPath, 'utf8'));
    // Truly random pick from the 100 items
    const randomIndex = Math.floor(Math.random() * fallbackPoints.length);
    todayPoint = fallbackPoints[randomIndex];
  } else {
    try {
      console.log('Attempting to fetch dynamic daily point from Wikipedia...');
      todayPoint = await fetchDynamicPointFromWiki();
      console.log(`Successfully generated dynamic point: ${todayPoint.name}`);
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

  htmlContent = htmlContent.replace(/LON/g, targetLon)
                           .replace(/LAT/g, targetLat)
                           .replace(/HEIGHT/g, targetHeight);
                           
  const token = process.env.CESIUM_ION_TOKEN || '';
  htmlContent = htmlContent.replace('INJECT_TOKEN_HERE', token);

  const tempHtmlPath = path.resolve(__dirname, 'temp-render.html');
  fs.writeFileSync(tempHtmlPath, htmlContent);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--allow-file-access-from-files']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 400, deviceScaleFactor: 2 });

  try {
    await page.goto(`file://${tempHtmlPath}`, { waitUntil: 'load' });
    await page.waitForFunction('window.renderComplete === true', { timeout: 30000 });
    
    const screenshotPath = path.resolve(__dirname, '../assets/random-point.png');
    await page.screenshot({ path: screenshotPath });

    const captionText = `**${locationName}**\n\nCoordinates: ${targetLat}, ${targetLon}\n\n*${fact}*`;
    fs.writeFileSync(path.resolve(__dirname, '../assets/random-point-caption.md'), captionText);

    const readmePath = path.resolve(__dirname, '../README.md');
    if (fs.existsSync(readmePath)) {
      let readmeContent = fs.readFileSync(readmePath, 'utf8');
      const regex = /<!-- START_LOCATION -->[\s\S]*<!-- END_LOCATION -->/;
      const now = new Date();
      const runDate = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
      const runTime = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
      
      cconst timestamp = Date.now();
      const injectedMarkdown = `<!-- START_LOCATION -->\n![Cesium Daily Map](assets/random-point.png?v=${timestamp})\n\n${captionText}\n\n*Last generated: ${runDate} at ${runTime}*\n<!-- END_LOCATION -->`;
      readmeContent = readmeContent.replace(regex, injectedMarkdown);
      fs.writeFileSync(readmePath, readmeContent);
    }
  } finally {
    if (browser) await browser.close();
    if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath);
  }
}

main();