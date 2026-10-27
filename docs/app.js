/* global Cesium */
'use strict';

const byId = id => document.getElementById(id);
const repositoryBase = 'https://raw.githubusercontent.com/Jastman/jastman/main/';
const archiveBase = `${repositoryBase}assets/world-zooms/`;
const manifestUrl = window.location.hostname.endsWith('.github.io')
  ? `${repositoryBase}docs/renders.json`
  : 'renders.json';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const preview = byId('preview');
const detail = byId('detail');
const status = byId('status');
let viewer;
let locations = [];
let selected = null;
let hovered = null;
let returnFocus = null;
let rotationEnabled = !reducedMotion.matches;
let idleAfter = 0;
let lastTick = performance.now();
const activePointers = new Set();

function formatDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
  });
}

function gifUrl(render) {
  return archiveBase + encodeURIComponent(render.file);
}

function hidePreview() {
  preview.hidden = true;
  byId('preview-image').removeAttribute('src');
  hovered = null;
}

function pauseForInteraction() {
  idleAfter = performance.now() + 10000;
}

function updateRotationButton() {
  byId('rotation').textContent = rotationEnabled ? 'Pause rotation' : 'Resume rotation';
  byId('rotation').setAttribute('aria-pressed', String(rotationEnabled));
}

function renderList() {
  const query = byId('search').value.trim().toLocaleLowerCase();
  const matches = locations.filter(location =>
    `${location.name} ${location.renders.map(render => render.date).join(' ')}`.toLocaleLowerCase().includes(query)
  );
  const fragment = document.createDocumentFragment();
  for (const location of matches) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'location';
    button.setAttribute('aria-pressed', String(location === selected));
    const name = document.createElement('strong');
    name.textContent = location.name;
    const subtitle = document.createElement('span');
    subtitle.textContent = `${formatDate(location.renders[0].date)} · ${location.renders.length} render${location.renders.length === 1 ? '' : 's'}`;
    button.append(name, subtitle);
    button.addEventListener('click', () => openLocation(location, button));
    li.append(button);
    fragment.append(li);
  }
  byId('locations').replaceChildren(fragment);
  byId('result-count').textContent = matches.length
    ? `${matches.length} place${matches.length === 1 ? '' : 's'} · newest first`
    : 'No places found. Try another name or date.';
}

function showRender(render) {
  byId('detail-name').textContent = render.name;
  byId('detail-image').alt = `Daily Cesium render of ${render.name}, ${formatDate(render.date)}`;
  byId('image-error').hidden = true;
  byId('detail-image').src = gifUrl(render);
  byId('detail-fact').textContent = render.fact || 'A corner of the Earth discovered by the Daily Render project.';
  byId('detail-coordinates').textContent = `${render.lat.toFixed(4)}°, ${render.lon.toFixed(4)}°`;
  byId('open-gif').href = gifUrl(render);
  byId('open-map').href = `https://www.openstreetmap.org/?mlat=${render.lat}&mlon=${render.lon}#map=12/${render.lat}/${render.lon}`;
}

function openLocation(location, trigger = null) {
  selected = location;
  returnFocus = trigger;
  hidePreview();
  const options = location.renders.map((render, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = formatDate(render.date);
    return option;
  });
  byId('render-date').replaceChildren(...options);
  showRender(location.renders[0]);
  detail.hidden = false;
  for (const button of byId('locations').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button === trigger));
  }
  if (viewer) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(location.lon, location.lat, 4500000),
      duration: reducedMotion.matches ? 0 : 1.4
    });
  }
  byId('detail-name').focus({ preventScroll: true });
  if (window.innerWidth <= 700) detail.scrollIntoView({ behavior: 'instant', block: 'start' });
}

function closeLocation() {
  detail.hidden = true;
  byId('detail-image').removeAttribute('src');
  selected = null;
  for (const button of byId('locations').querySelectorAll('button')) button.setAttribute('aria-pressed', 'false');
  pauseForInteraction();
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  else byId('reset').focus({ preventScroll: true });
}

function resetView() {
  hidePreview();
  if (selected) closeLocation();
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(5, 20, 22000000),
    duration: reducedMotion.matches ? 0 : 1.4
  });
  pauseForInteraction();
}

function validRender(render) {
  return render && typeof render.name === 'string' && typeof render.fact === 'string' &&
    Number.isFinite(render.lat) && Math.abs(render.lat) <= 90 &&
    Number.isFinite(render.lon) && Math.abs(render.lon) <= 180 &&
    /^\d{4}-\d{2}-\d{2}$/.test(render.date) &&
    /^\d{4}-\d{2}-\d{2}-[a-zA-Z0-9-]+\.gif$/.test(render.file) &&
    render.file.startsWith(`${render.date}-`);
}

async function loadArchive() {
  const response = await fetch(manifestUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Archive request failed (${response.status})`);
  const renders = await response.json();
  if (!Array.isArray(renders) || !renders.length || !renders.every(validRender)) {
    throw new Error('The render archive is empty or contains invalid metadata.');
  }
  const grouped = new Map();
  for (const render of renders.sort((a, b) => b.file.localeCompare(a.file))) {
    const key = `${render.lat},${render.lon}`;
    if (!grouped.has(key)) {
      grouped.set(key, { name: render.name, lat: render.lat, lon: render.lon, renders: [] });
    }
    grouped.get(key).renders.push(render);
  }
  locations = [...grouped.values()];
  renderList();
  status.textContent = `${renders.length} daily renders · ${locations.length} places · one shared planet`;
}

function pickedLocation(position) {
  const picked = viewer.scene.pick(position);
  return picked?.id?.archiveLocation || null;
}

function setupGlobe() {
  viewer = new Cesium.Viewer('globe', {
    animation: false, timeline: false, baseLayerPicker: false,
    geocoder: false, homeButton: false, sceneModePicker: false,
    navigationHelpButton: false, fullscreenButton: false,
    infoBox: false, selectionIndicator: false, baseLayer: false,
    skyBox: false, scene3DOnly: true
  });
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#080e19');
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#183e55');
  viewer.scene.globe.enableLighting = false;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 25000;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 40000000;
  viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(5, 20, 22000000) });
  Cesium.TileMapServiceImageryProvider.fromUrl(
    Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')
  ).then(provider => viewer.imageryLayers.addImageryProvider(provider)).catch(error => {
    console.warn('Earth imagery unavailable; showing the globe and archive points.', error);
    status.textContent += ' · Earth imagery unavailable';
  });

  for (const location of locations) {
    const entity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(location.lon, location.lat, 1000),
      point: {
        pixelSize: 9,
        color: Cesium.Color.fromCssColorString('#73ebc4'),
        outlineColor: Cesium.Color.fromCssColorString('#081720'),
        outlineWidth: 2,
        scaleByDistance: new Cesium.NearFarScalar(500000, 1.5, 30000000, 0.8)
      }
    });
    entity.archiveLocation = location;
  }

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(movement => {
    if (selected) return;
    const location = pickedLocation(movement.endPosition);
    viewer.scene.canvas.style.cursor = location ? 'pointer' : '';
    if (!location) {
      hidePreview();
      return;
    }
    if (hovered !== location) {
      hovered = location;
      const render = location.renders[0];
      byId('preview-image').src = gifUrl(render);
      byId('preview-name').textContent = render.name;
      byId('preview-date').textContent = `${formatDate(render.date)}${location.renders.length > 1 ? ` · ${location.renders.length} renders — click to explore` : ''}`;
    }
    preview.hidden = false;
    const bounds = byId('globe').getBoundingClientRect();
    preview.style.left = `${Math.max(8, Math.min(movement.endPosition.x + 18, bounds.width - preview.offsetWidth - 8))}px`;
    preview.style.top = `${Math.max(8, Math.min(movement.endPosition.y + 18, bounds.height - preview.offsetHeight - 8))}px`;
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(movement => {
    const location = pickedLocation(movement.position);
    if (location) openLocation(location);
    else hidePreview();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  for (const event of ['pointerdown', 'wheel', 'touchstart', 'keydown']) {
    viewer.scene.canvas.addEventListener(event, () => {
      hidePreview();
      pauseForInteraction();
    }, { passive: true });
  }
  viewer.scene.canvas.addEventListener('pointerdown', event => activePointers.add(event.pointerId));
  for (const event of ['pointerup', 'pointercancel']) {
    window.addEventListener(event, event => {
      activePointers.delete(event.pointerId);
      pauseForInteraction();
    });
  }
  window.addEventListener('blur', () => activePointers.clear());
  viewer.scene.canvas.addEventListener('pointerleave', hidePreview);
  viewer.clock.onTick.addEventListener(() => {
    const now = performance.now();
    const delta = Math.min((now - lastTick) / 1000, 0.1);
    lastTick = now;
    if (rotationEnabled && !selected && !hovered && !activePointers.size && now >= idleAfter &&
        !document.hidden && !byId('search').matches(':focus')) {
      viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.025 * delta);
    }
  });
  byId('rotation').disabled = false;
  byId('reset').disabled = false;
  updateRotationButton();
}

byId('search').addEventListener('input', renderList);
byId('rotation').addEventListener('click', () => {
  rotationEnabled = !rotationEnabled;
  updateRotationButton();
});
reducedMotion.addEventListener('change', event => {
  if (event.matches) {
    rotationEnabled = false;
    updateRotationButton();
  }
});
byId('reset').addEventListener('click', resetView);
byId('close-detail').addEventListener('click', closeLocation);
byId('render-date').addEventListener('change', event => {
  if (selected) showRender(selected.renders[Number(event.target.value)]);
});
byId('detail-image').addEventListener('error', () => { byId('image-error').hidden = false; });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    hidePreview();
    if (selected) closeLocation();
  }
});

async function start() {
  try {
    await loadArchive();
    byId('search').disabled = false;
    try {
      if (!window.Cesium) throw new Error('CesiumJS could not be loaded.');
      setupGlobe();
    } catch (error) {
      viewer?.destroy();
      viewer = null;
      status.textContent = 'The 3D globe is unavailable. Browse the render list instead.';
      console.error(error);
    }
  } catch (error) {
    status.textContent = 'The atlas could not load. Please reload, or use the Archive folder link above.';
    console.error(error);
  }
}

start();
