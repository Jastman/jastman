# Autonomous 3D Globe Profile Render - Architecture & Overview

This project is a fully autonomous, serverless micro-service running entirely inside a GitHub repository. It programmatically generates a fresh, cinematic 3D globe render of a random global location and injects it directly into the GitHub profile README on a daily schedule.

## Architecture Diagram

```mermaid
graph TD
    subgraph GitHub [GitHub Infrastructure]
        A[GitHub Actions Cron Job\nDaily @ 6:00 AM EDT / Workflow Dispatch] -->|Triggers| B[Node.js Orchestrator\nscripts/generate-map.js]
        
        subgraph DataSource [Data Sources]
            B -->|50% Hybrid Pick| C[Curated List\npoints.json]
            B -->|50% Hybrid Pick| D[Wikipedia API\nRandom Geolocated Article + Guardrail Filter]
        end

        subgraph Rendering [Headless Rendering Engine]
            B -->|Injects Coordinates & Token| E[Cesium Template HTML\nscripts/cesium-template.html]
            E -->|Loads 3D Tileset ID 2275207| F[Cesium Ion / Google Photorealistic 3D Tiles]
            E -->|Spins up Headless Browser w/ SwiftShader| G[Puppeteer Automation]
            G -->|Waits for Tile Stream & Validates Size| H[Screenshot Buffer > 50KB]
        end

        subgraph Persistence [State & Version Control]
            H -->|Saves & Cache-Busts URL| I[assets/random-point.png & markdown caption]
            I -->|Git Commit & Push| J[GitHub Repository Main Branch]
            J -->|CDN Cache-Busting Query ?v=timestamp| K[User GitHub Profile README.md]
        end
    end

    ---

## 🛠️ How It Works

* **Daily Automation:** Triggered via GitHub Actions on a cron schedule (`0 10 * * *` UTC / 6:00 AM EDT) and manual workflow dispatch.
* **Hybrid Data Pipeline:** A Node.js orchestrator flips a coin on each run to select a location using a 50/50 strategy between a curated list of architectural/natural wonders (`points.json`) and a random geolocated Wikipedia article filtered through safety guardrails.
* **Headless 3D Rendering:** Uses Puppeteer with WebGL SwiftShader to run CesiumJS headlessly, loading Google Photorealistic 3D Tiles via Cesium Ion.
* **Cinematic Camera Framing:** Automatically calculates a dynamic distance offset and a 45-degree downward tilt to frame structures and natural wonders dead-center.
* **Anti-Black Screen Safeguard:** Validates the rendered image file size (>50KB) in a retry loop to ensure high-resolution textures have fully streamed before saving.
* **CDN Cache-Busting:** Automatically commits the updated image and caption, appending a dynamic timestamp query (`?v=timestamp`) to force GitHub's CDN to instantly refresh your profile view.