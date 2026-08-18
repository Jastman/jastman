# Setup

1. Copy this whole folder's contents into your `username/username` profile repo (the special one GitHub shows on your profile).
2. Get a free Cesium ion token at ion.cesium.com if you don't already have one handy from work.
3. In your repo, go to Settings > Secrets and variables > Actions, and add a secret named `CESIUM_ION_TOKEN` with that token.
4. Run `npm install` locally once to confirm `generate-map.js` works before relying on the Action (`CESIUM_ION_TOKEN=yourtoken npm run generate`).
5. To publish each render to X, create an X Developer app with OAuth 1.0a user authentication enabled and Read and Write permissions. Regenerate the access token for the account that should publish, then add these four repository secrets under Settings > Secrets and variables > Actions:
   - `X_API_KEY`
   - `X_API_SECRET`
   - `X_ACCESS_TOKEN`
   - `X_ACCESS_TOKEN_SECRET`
6. Push. The workflow runs daily and on manual trigger (Actions tab > "Update random Cesium point" > Run workflow). Each run commits the updated profile assets and publishes the GIF with its location name, coordinates, and description to the X account represented by the access token. X posts are capped at 280 characters.
7. Add this to your README:

```markdown
### 📍 Random point of interest

![Random Cesium render](https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_USERNAME/main/assets/random-point.png)

Wherever the globe landed this time. Refreshes daily via GitHub Actions + CesiumJS.
```

Notes:
- The tileset asset ID in `cesium-template.html` (`96188`) points at a general buildings/terrain asset. If it 404s for you, swap it for whichever ion asset ID you have access to, or just delete that tileset block and let it fall back to imagery + terrain, still looks good.
- Daily is the default cadence since GitHub Actions on public repos is free but not meant for minute-by-minute cron jobs. You can loosen or tighten the schedule in `update-map.yml`.
- The `points.json` list is 12 spots picked for geospatial/XR relevance, not exhaustive. Add your own, that's half the fun.
