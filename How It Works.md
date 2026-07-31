  ## 🛠️ How It Works

* **Daily Automation:** Triggered via GitHub Actions on a cron schedule (`0 10 * * *` UTC / 6:00 AM EDT) and manual workflow dispatch.
* **Hybrid Data Pipeline:** A Node.js orchestrator flips a coin on each run to select a location using a 50/50 strategy between a curated list of architectural/natural wonders (`points.json`) and a random geolocated Wikipedia article filtered through safety guardrails.
* **Headless 3D Rendering:** Uses Puppeteer with WebGL SwiftShader to run CesiumJS headlessly, loading Google Photorealistic 3D Tiles via Cesium Ion.
* **Cinematic Camera Framing:** Automatically calculates a dynamic distance offset and a 45-degree downward tilt to frame structures and natural wonders dead-center.
* **Anti-Black Screen Safeguard:** Validates the rendered image file size (>50KB) in a retry loop to ensure high-resolution textures have fully streamed before saving.
* **CDN Cache-Busting:** Automatically commits the updated image and caption, appending a dynamic timestamp query (`?v=timestamp`) to force GitHub's CDN to instantly refresh your profile view.