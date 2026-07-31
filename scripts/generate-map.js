const puppeteer = require('puppeteer');
const path = require('path');

async function main() {
  console.log('Launching headless browser with WebGL support...');
  
  // 1. Launch with WebGL (SwiftShader) software rendering flags
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',                  // Force software rendering pathway
      '--use-gl=swiftshader',           // Direct SwiftShader WebGL implementation
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--allow-file-access-from-files'  // Prevent CORS blocks when loading Cesium assets via file://
    ]
  });

  const page = await browser.newPage();

  // Set the viewport dimensions for your GitHub profile map
  await page.setViewport({ width: 800, height: 400, deviceScaleFactor: 2 });

  // 2. Catch and log all browser console output and errors to GitHub Actions
  page.on('console', msg => {
    console.log(`[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`);
  });
  
  page.on('pageerror', error => {
    console.error(`[Browser Error]: ${error.message}`);
  });
  
  page.on('requestfailed', request => {
    console.error(`[Network Error]: ${request.url()} failed - ${request.failure()?.errorText}`);
  });

  try {
    // Assuming your HTML file is in the root directory (one level up from /scripts)
    // Update 'index.html' if your entry file is named differently
    const targetUrl = `file://${path.resolve(__dirname, 'cesium-template.html')}`;
    console.log(`Navigating to ${targetUrl}...`);
    
    // Wait until network activity settles to ensure Cesium assets are loaded
    await page.goto(targetUrl, { waitUntil: 'networkidle0' });

    console.log('Waiting for Cesium window.renderComplete flag...');
    // A 30-second timeout to accommodate slower software rendering on GitHub runners
    await page.waitForFunction('window.renderComplete === true', { timeout: 30000 });
    
    console.log('Render complete! Taking screenshot...');
    
    // Output the screenshot to the root folder (update 'map.png' to match your README reference)
    const screenshotPath = path.resolve(__dirname, '../map.png');
    await page.screenshot({ path: screenshotPath });
    
    console.log(`Screenshot saved successfully to ${screenshotPath}`);

  } catch (error) {
    console.error('Error during map generation:', error);
    // Force the GitHub Action to fail so you can see the logs
    process.exit(1); 
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();