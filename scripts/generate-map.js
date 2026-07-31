const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Helper function to fetch a random geolocated article from Wikipedia
async function fetchDynamicPointFromWiki() {
  // 1. Fetch 50 random Wikipedia articles
  const randomUrl = 'https://en.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=50&format=json&origin=*';
  const randomRes = await fetch(randomUrl);
  const randomData = await randomRes.json();
  const pageIds = randomData.query.random.map(p => p.id).join('|');

  // 2. Query those 50 pages specifically for coordinates and an introductory text extract
  const dataUrl = `https://en.wikipedia.org/w/api.php?action=query&pageids=${pageIds}&prop=coordinates|extracts&exintro=1&exchars=250&explaintext=1&format=json&origin=*`;
  const dataRes = await fetch(dataUrl);
  const data = await dataRes.json();

  // 3. Find the first page that actually contains coordinates
  for (const pageId in data.query.pages) {
    const page = data.query.pages[pageId];
    if (page.coordinates && page.coordinates.length > 0) {
      const name = page.title;
      const lon = page.coordinates[0].lon;
      const lat = page.coordinates[0].lat;
      // Default height for Wiki points since they don't provide altitude
      const height = 1500; 
      
      // Clean up the text extract to act as our fun fact
      const fact = page.extract ? page.extract.replace(/\n/g, ' ').trim() : 'A random location discovered via Wikipedia.';

      return { name, lon, lat, height, fact };
    }
  }
  throw new Error("No coordinates found in this Wikipedia batch.");
}

async function main() {
  console.log('Starting map generation process...');

  const templatePath = path.resolve(__dirname, 'cesium-template.html');
  const pointsPath = path.resolve(__dirname, 'points.json');
  
  if (!fs.existsSync(templatePath)) throw new Error(`Template not found at ${templatePath}`);
  if (!fs.existsSync(pointsPath)) throw new Error(`Points file not found at ${pointsPath}`);

  let htmlContent = fs.readFileSync(templatePath, 'utf8');
  let todayPoint;

  try {
    console.log('Attempting to fetch dynamic daily point from Wikipedia...');
    todayPoint = await fetchDynamicPointFromWiki();
    console.log(`Successfully generated dynamic point: ${todayPoint.name}`);
  } catch (error) {
    console.warn(`[WARNING]: ${error.message} Falling back to static points.json.`);
    
    // The Fallback Logic: Pick today's point from the 100-item array
    const fallbackPoints = JSON.parse(fs.readFileSync(pointsPath, 'utf8'));
    const start = new Date(new Date().getFullYear(), 0, 0);
    const diff = (new Date() - start) + ((start.getTimezoneOffset() - new Date().getTimezoneOffset()) * 60 * 1000);
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    todayPoint = fallbackPoints[dayOfYear % fallbackPoints.length];
  }

  // Extract variables for template and caption
  const targetLon = todayPoint.lon || todayPoint.lng;
  const targetLat = todayPoint.lat;
  const targetHeight = todayPoint.height || 1500;
  const locationName = todayPoint.name || 'Unknown Location';
  const fact = todayPoint.fact || '';

  console.log(`Targeting Coordinates: Lon ${targetLon}, Lat ${targetLat}, Height ${targetHeight}`);

  // Inject variables into the HTML template
  htmlContent = htmlContent.replace(/LON/g, targetLon)
                           .replace(/LAT/g, targetLat)
                           .replace(/HEIGHT/g, targetHeight);
                           
  const token = process.env.CESIUM_ION_TOKEN || '';
  if (!token) console.warn('WARNING: CESIUM_ION_TOKEN environment variable is missing.');
  
  htmlContent = htmlContent.replace('INJECT_TOKEN_HERE', token);

  // Save the temporary HTML file
  const tempHtmlPath = path.resolve(__dirname, 'temp-render.html');
  fs.writeFileSync(tempHtmlPath, htmlContent);

  console.log('Launching headless browser with WebGL (SwiftShader)...');
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',                  
      '--use-gl=swiftshader',           
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--allow-file-access-from-files'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 400, deviceScaleFactor: 2 });

  page.on('console', msg => console.log(`[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`));
  page.on('pageerror', error => console.error(`[Browser Error]: ${error.message}`));

  try {
    const targetUrl = `file://${tempHtmlPath}`;
    console.log(`Navigating to ${targetUrl}...`);
    
    await page.goto(targetUrl, { waitUntil: 'load' });

    console.log('Waiting for Cesium window.renderComplete flag...');
    await page.waitForFunction('window.renderComplete === true', { timeout: 30000 });
    
    console.log('Render complete! Taking screenshot...');
    
    // Save image to the assets folder
    const screenshotPath = path.resolve(__dirname, '../assets/random-point.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved successfully to ${screenshotPath}`);

    // Update the caption Markdown file
    const captionText = `**${locationName}**\n\nCoordinates: ${targetLat}, ${targetLon}\n\n*${fact}*`;
    const captionPath = path.resolve(__dirname, '../assets/random-point-caption.md');
    fs.writeFileSync(captionPath, captionText);
    console.log(`Caption updated for: ${locationName}`);

    // Update the README.md dynamically with a cache-busting timestamp (Make sure you have the HTML comments in your README!)
    const readmePath = path.resolve(__dirname, '../README.md');
    if (fs.existsSync(readmePath)) {
      let readmeContent = fs.readFileSync(readmePath, 'utf8');
      const regex = /<!-- START_LOCATION -->[\s\S]*<!-- END_LOCATION -->/;
      
      // Generate a clean date and time string in Eastern Time
      const now = new Date();
      const runDate = now.toLocaleDateString('en-US', { 
        timeZone: 'America/New_York', 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
      const runTime = now.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      });

      const timestamp = Date.now();
      
      // Inject the image, the caption, and the last generated date/time
      const injectedMarkdown = `<!-- START_LOCATION -->\n![Cesium Daily Map](assets/random-point.png?v=${timestamp})\n\n**Location:** ${captionText}\n\n*Last generated: ${runDate} at ${runTime}*\n<!-- END_LOCATION -->`;
      readmeContent = readmeContent.replace(regex, injectedMarkdown);
      fs.writeFileSync(readmePath, readmeContent);
      console.log(`README.md updated with latest location and date: ${runDate}`);
    }

  } catch (error) {
    console.error('Error during map generation:', error);
    process.exit(1); 
  } finally {
    if (browser) await browser.close();
    if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath);
  }
}

main();