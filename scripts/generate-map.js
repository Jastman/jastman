const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function main() {
  console.log('Starting map generation process...');

  // 1. Read the template and points data
  const templatePath = path.resolve(__dirname, 'cesium-template.html');
  const pointsPath = path.resolve(__dirname, 'points.json');
  
  if (!fs.existsSync(templatePath)) throw new Error(`Template not found at ${templatePath}`);
  if (!fs.existsSync(pointsPath)) throw new Error(`Points file not found at ${pointsPath}`);

  let htmlContent = fs.readFileSync(templatePath, 'utf8');
  const points = JSON.parse(fs.readFileSync(pointsPath, 'utf8'));

  // 2. Pick today's location
  const start = new Date(new Date().getFullYear(), 0, 0);
  const diff = (new Date() - start) + ((start.getTimezoneOffset() - new Date().getTimezoneOffset()) * 60 * 1000);
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  const todayPoint = points[dayOfYear % points.length];
  
  // 3. Extract coordinates (adjusts based on whether your JSON uses 'lon' or 'lng')
  const targetLon = todayPoint.lon || todayPoint.lng;
  const targetLat = todayPoint.lat;
  const targetHeight = todayPoint.height || 500;

  console.log(`Targeting Coordinates: Lon ${targetLon}, Lat ${targetLat}, Height ${targetHeight}`);

  // 4. Inject variables and API token into the template
  htmlContent = htmlContent.replace(/LON/g, targetLon)
                           .replace(/LAT/g, targetLat)
                           .replace(/HEIGHT/g, targetHeight);
                           
  const token = process.env.CESIUM_ION_TOKEN || '';
  if (!token) console.warn('WARNING: CESIUM_ION_TOKEN environment variable is missing.');
  
  htmlContent = htmlContent.replace('INJECT_TOKEN_HERE', token);

  // 5. Save to a temporary file that Puppeteer can load locally
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
    // 6. Point Puppeteer to the compiled temporary HTML file
    const targetUrl = `file://${tempHtmlPath}`;
    console.log(`Navigating to ${targetUrl}...`);
    
    // We use load instead of networkidle0 because 3D Tiles constantly stream data
    await page.goto(targetUrl, { waitUntil: 'load' });

    console.log('Waiting for Cesium window.renderComplete flag...');
    await page.waitForFunction('window.renderComplete === true', { timeout: 30000 });
    
    console.log('Render complete! Taking screenshot...');
    
  const screenshotPath = path.resolve(__dirname, '../assets/random-point.png')
    await page.screenshot({ path: screenshotPath });
    
    console.log(`Screenshot saved successfully to ${screenshotPath}`);

  } catch (error) {
    console.error('Error during map generation:', error);
    process.exit(1); 
  } finally {
    if (browser) await browser.close();
    
    // Clean up the temporary file so it doesn't dirty the working directory
    if (fs.existsSync(tempHtmlPath)) {
      fs.unlinkSync(tempHtmlPath);
    }
  }
}

main();