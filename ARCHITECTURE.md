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