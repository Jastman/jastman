const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'docs/renders.json');
const archiveDir = path.join(root, 'assets/world-zooms');

function validateRender(render) {
  if (!render || typeof render.name !== 'string' || !render.name.trim() ||
      typeof render.fact !== 'string' ||
      !Number.isFinite(render.lat) || Math.abs(render.lat) > 90 ||
      !Number.isFinite(render.lon) || Math.abs(render.lon) > 180 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(render.date) ||
      !/^\d{4}-\d{2}-\d{2}-[a-zA-Z0-9-]+\.gif$/.test(render.file) ||
      !render.file.startsWith(`${render.date}-`)) {
    throw new Error('Invalid archive render metadata');
  }
}

function saveRenders(renders, outputPath = manifestPath) {
  const byFile = new Map();
  for (const render of renders) {
    validateRender(render);
    byFile.set(render.file, render);
  }
  const sorted = [...byFile.values()].sort((a, b) => b.file.localeCompare(a.file));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(sorted, null, 2)}\n`);
}

function recordRender(render, outputPath = manifestPath) {
  const renders = fs.existsSync(outputPath)
    ? JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    : [];
  saveRenders([...renders, render], outputPath);
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

function backfill() {
  const files = new Set(fs.readdirSync(archiveDir).filter(file => file.endsWith('.gif')));
  const renders = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : [];
  const found = new Set(renders.map(render => render.file));
  const commits = git('log', '--format=%H', '--', 'assets/world-zooms').trim().split('\n');

  for (const commit of commits.filter(Boolean)) {
    const caption = git('show', `${commit}:assets/random-point-caption.md`);
    const match = caption.match(/^\*\*(.+)\*\*\s+Coordinates:\s*(-?[\d.]+),\s*(-?[\d.]+)\s+\*([\s\S]*)\*\s*$/);
    if (!match) continue;
    const [, name, lat, lon, fact] = match;
    const slug = name.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40);
    const changed = git('diff-tree', '--root', '--no-commit-id', '--name-only', '-r', commit, '--', 'assets/world-zooms');
    let curated;
    for (const filename of changed.trim().split('\n').filter(Boolean)) {
      const file = path.basename(filename);
      if (!files.has(file) || found.has(file)) continue;
      let point = { name, lat: Number(lat), lon: Number(lon), fact };
      if (file.slice(11) !== `${slug}.gif`) {
        curated ??= JSON.parse(git('show', `${commit}:scripts/points.json`));
        const candidates = curated.filter(point =>
          `${point.name.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40)}.gif` === file.slice(11)
        );
        if (candidates.length !== 1) continue;
        const original = candidates[0];
        point = {
          name: original.name, lat: original.lat, lon: original.lon ?? original.lng,
          fact: original.fact || ''
        };
      }
      renders.push({ file, date: file.slice(0, 10), ...point });
      found.add(file);
    }
  }

  const missing = [...files].filter(file => !found.has(file));
  if (missing.length) {
    throw new Error(`Missing original metadata for ${missing.length} renders:\n${missing.join('\n')}`);
  }
  saveRenders(renders);
  console.log(`Recovered metadata for ${renders.length} archived renders.`);
}

function checkArchive() {
  const renders = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = new Set(fs.readdirSync(archiveDir).filter(file => file.endsWith('.gif')));
  const seen = new Set();
  for (const render of renders) {
    validateRender(render);
    if (!files.has(render.file) || seen.has(render.file)) {
      throw new Error(`Missing or duplicate archived GIF: ${render.file}`);
    }
    seen.add(render.file);
  }
  if (seen.size !== files.size) throw new Error('Some archived GIFs have no location metadata');
  console.log(`Archive verified: ${seen.size} GIFs with valid location metadata.`);
}

if (require.main === module) {
  if (process.argv[2] === '--backfill') backfill();
  else if (process.argv[2] === '--check') checkArchive();
  else throw new Error('Usage: node scripts/archive-metadata.js --backfill|--check');
}

module.exports = { recordRender, validateRender };
