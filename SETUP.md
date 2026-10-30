# Setup

1. Copy this whole folder's contents into your `username/username` profile repo (the special one GitHub shows on your profile).
2. Get a free Cesium ion token at ion.cesium.com if you don't already have one handy from work.
3. In your repo, go to Settings > Secrets and variables > Actions, and add a secret named `CESIUM_ION_TOKEN` with that token.
4. Run `npm install` locally once to confirm `generate-map.js` works before relying on the Action (`CESIUM_ION_TOKEN=yourtoken npm run generate`).
5. Push. The workflow runs daily and on manual trigger (Actions tab > "Update random Cesium point" > Run workflow).
6. Add this to your README:

```markdown
### 📍 Random point of interest

![Random Cesium render](https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_USERNAME/main/assets/random-point.png)

Wherever the globe landed this time. Refreshes daily via GitHub Actions + CesiumJS.
```

Notes:
- The tileset asset ID in `cesium-template.html` (`96188`) points at a general buildings/terrain asset. If it 404s for you, swap it for whichever ion asset ID you have access to, or just delete that tileset block and let it fall back to imagery + terrain, still looks good.
- Daily is the default cadence since GitHub Actions on public repos is free but not meant for minute-by-minute cron jobs. You can loosen or tighten the schedule in `update-map.yml`.
- The `points.json` list is 12 spots picked for geospatial/XR relevance, not exhaustive. Add your own, that's half the fun.

## Daily Render Atlas

The interactive archive lives in `docs/`. It uses CesiumJS with its bundled
Natural Earth imagery, so the public app does not need a Cesium ion token.
The existing token remains private to the daily render workflow.

To publish at **https://jastman.github.io/jastman/**:

1. Open the repository's **Settings → Pages**.
2. Select **Deploy from a branch**, choose **main** and **/docs**, and save.
3. Wait for the Pages deployment to finish. If Pages is already serving another
   site from this repository, review that configuration before changing it.

The daily workflow commits `docs/renders.json` alongside each new GIF.
On GitHub Pages, the app fetches the latest manifest directly from the
repository's `main` branch, so daily updates do not need a Pages rebuild
(pushes made with `GITHUB_TOKEN` do not trigger branch-based Pages builds).
Allow for GitHub's raw-content cache propagation. GIFs are also loaded on
demand from `main` rather than copied into the Pages site. Repeated visits
to the same coordinates share one globe point; the details panel's date
selector exposes every archived render.

Drag to rotate, scroll or pinch to zoom, hover for a GIF preview, and click a
point for details. The searchable list also works with a keyboard and on touch
screens. Rotation pauses during interaction and while details are open, and
starts paused when the visitor prefers reduced motion. The rotation button
can pause it indefinitely. The list remains usable if WebGL is unavailable.

For a local preview, serve the repository with a static HTTP server, for example
`python3 -m http.server 8000 --directory /absolute/path/to/jastman`, and visit
`http://localhost:8000/docs/`. Opening `index.html` directly does not support
fetching the JSON archive.

Archive maintenance:

- `node scripts/archive-metadata.js --check` verifies that every archived GIF
  has valid coordinates and a unique manifest entry.
- `node scripts/archive-metadata.js --backfill` recovers original captions and
  coordinates from Git history, falling back to an exact, unique curated-point
  match from the same commit when necessary. This needs a full checkout; run
  `git fetch --unshallow origin` first if the clone is shallow.
- Future renders write metadata directly; normal daily runs do not need history.
- If you fork this repo, update the profile, archive, repository-base, and README
  links to your own account and repository. Local previews load the local
  manifest; `*.github.io` hosts load the live manifest from `main`.
