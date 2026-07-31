const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..");
const ION_TOKEN = process.env.CESIUM_ION_TOKEN;

if (!ION_TOKEN) {
  console.error("Missing CESIUM_ION_TOKEN env var. Get one free at ion.cesium.com.");
  process.exit(1);
}

async function main() {
  const points = JSON.parse(fs.readFileSync(path.join(__dirname, "points.json"), "utf8"));
  const point = points[Math.floor(Math.random() * points.length)];

  let template = fs.readFileSync(path.join(__dirname, "cesium-template.html"), "utf8");
  template = template
    .replace("ION_TOKEN", ION_TOKEN)
    .replace("LON, LAT, HEIGHT", `${point.lon}, ${point.lat}, ${point.height}`);

  const tempHtmlPath = path.join(__dirname, "_render.html");
  fs.writeFileSync(tempHtmlPath, template);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--use-gl=swiftshader", "--enable-webgl"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630 });
    await page.goto(`file://${tempHtmlPath}`, { waitUntil: "load" });

    // wait for the flyTo + tile streaming to finish
    await page.waitForFunction("window.renderComplete === true", { timeout: 20000 });

    const assetsDir = path.join(ROOT, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    await page.screenshot({ path: path.join(assetsDir, "random-point.png") });

    const caption = `**${point.name}**\n\n${point.fact}`;
    fs.writeFileSync(path.join(assetsDir, "random-point-caption.md"), caption);

    console.log(`Rendered: ${point.name}`);
  } finally {
    await browser.close();
    fs.unlinkSync(tempHtmlPath);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
