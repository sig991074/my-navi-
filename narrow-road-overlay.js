(() => {
  'use strict';

  const bridge = window.evNarrowRoadBridge;
  if (!bridge) return;

  const state = { edges: [], edgeLayer: null, routeLayer: null, footprints: null, features: [], edgeGrid: new Map(), centerlineTiles: new Map() };
  const panel = document.createElement('div');
  panel.id = 'narrowVectorPanel';
  panel.innerHTML = '<b>道路ベクトル照合</b><label>道路縁 RdEdg GeoJSON <input id="narrowEdgeFile" type="file" accept=".json,.geojson,application/geo+json"></label><button id="narrowVectorCheck" type="button">10m間隔で全ルート照合</button><div id="narrowVectorStatus">基盤地図情報のRdEdg GeoJSONを読み込んでください。F（狭隘道路除外）を使う場合、データ未読込・未判定は通過可にしません。</div>';
  document.body.append(panel);

  const style = document.createElement('style');
  style.textContent = '#narrowVectorPanel{position:absolute;z-index:1200;left:10px;bottom:42px;width:min(340px,calc(100vw - 24px));padding:9px;background:#fffffff2;border:1px solid #35566a;border-radius:6px;box-shadow:0 2px 8px #0005;font:12px/1.4 sans-serif;color:#183746}#narrowVectorPanel label{display:block;margin:6px 0}#narrowVectorPanel input{display:block;width:100%;margin-top:3px;font-size:11px}#narrowVectorPanel button{padding:5px 8px}#narrowVectorStatus{margin-top:6px;font-size:11px}';
  document.head.append(style);

  const status = text => { document.getElementById('narrowVectorStatus').textContent = text; };
  const flatten = coordinates => {
    if (!Array.isArray(coordinates)) return [];
    if (coordinates.length && typeof coordinates[0]?.[0] === 'number') return [coordinates];
    return coordinates.flatMap(flatten);
  };
  const lineFeatures = geojson => {
    if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      throw new Error('GeoJSON FeatureCollection形式の道路縁データを選択してください');
    }
    const hasClass = geojson.features.some(feature => feature.properties && Object.hasOwn(feature.properties, 'class'));
    const features = geojson.features.filter(feature => {
      if (!feature.geometry || (hasClass && feature.properties?.class !== 'RdEdg')) return false;
      return ['LineString', 'MultiLineString'].includes(feature.geometry.type);
    });
    if (!features.length) throw new Error('RdEdgの線データが見つかりません');
    return features;
  };
  const indexEdges = features => {
    const grid = new Map(), global = [], cellSize = 0.005;
    for (const feature of features) for (const line of flatten(feature.geometry.coordinates)) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) continue;
        const minX = Math.floor(Math.min(a[0], b[0]) / cellSize), maxX = Math.floor(Math.max(a[0], b[0]) / cellSize);
        const minY = Math.floor(Math.min(a[1], b[1]) / cellSize), maxY = Math.floor(Math.max(a[1], b[1]) / cellSize);
        if ((maxX - minX + 1) * (maxY - minY + 1) > 16) {
          global.push([a, b]);
          continue;
        }
        for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
          const key = `${x}/${y}`, list = grid.get(key) || [];
          list.push([a, b]);
          grid.set(key, list);
        }
      }
    }
    state.edgeGrid = grid;
    state.edgeGlobal = global;
  };
  const tilePosition = (lat, lon, zoom) => {
    const n = 2 ** zoom;
    return { x: Math.floor((lon + 180) / 360 * n), y: Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n) };
  };
  const fetchCenterlines = async points => {
    const tileMap = new Map();
    for (const point of points) {
      const tile = tilePosition(point[1], point[0], 16);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const x = tile.x + dx, y = tile.y + dy, key = `${x}/${y}`;
        tileMap.set(key, { z: 16, x, y });
      }
    }
    const tiles = [...tileMap.values()];
    if (tiles.length > 1200) throw new Error('ルートが広範囲のため道路中心線タイルが上限を超えました。区間を分けて照合してください');
    const features = [];
    for (let i = 0; i < tiles.length; i += 8) {
      const batch = tiles.slice(i, i + 8);
      const results = await Promise.all(batch.map(async tile => {
        const key = `${tile.z}/${tile.x}/${tile.y}`;
        if (state.centerlineTiles.has(key)) return state.centerlineTiles.get(key);
        const url = `https://cyberjapandata.gsi.go.jp/xyz/experimental_rdcl/${key}.geojson`;
        const response = await fetch(url);
        if (response.status === 404) return { features: [] };
        if (!response.ok) throw new Error(`道路中心線タイルを取得できません（HTTP ${response.status}）`);
        const data = await response.json();
        state.centerlineTiles.set(key, data);
        return data;
      }));
      results.forEach(result => features.push(...(result.features || [])));
    }
    return [...new Map(features.map(feature => [feature.properties?.rID || JSON.stringify(feature.geometry?.coordinates), feature])).values()]
      .filter(feature => feature.geometry?.type === 'LineString');
  };
  const metersPerLon = lat => 111320 * Math.max(0.1, Math.cos(lat * Math.PI / 180));
  const toLocal = (point, origin, bearing) => {
    const east = (point[0] - origin[0]) * metersPerLon(origin[1]);
    const north = (point[1] - origin[1]) * 111320;
    const sin = Math.sin(bearing), cos = Math.cos(bearing);
    return { along: east * sin + north * cos, lateral: -east * cos + north * sin };
  };
  const distancePointSegment = (point, a, b) => {
    const lat = point[1], sx = metersPerLon(lat);
    const ax = (a[0] - point[0]) * sx, ay = (a[1] - point[1]) * 111320;
    const bx = (b[0] - point[0]) * sx, by = (b[1] - point[1]) * 111320;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    return { distance: Math.hypot(ax + t * dx, ay + t * dy), t, ax, ay, dx, dy };
  };
  const nearestCenterline = (point, features, routeBearing) => {
    let best = null;
    for (const feature of features) {
      const coordinates = feature.geometry.coordinates;
      for (let i = 1; i < coordinates.length; i++) {
        const a = coordinates[i - 1], b = coordinates[i];
        const projection = distancePointSegment(point, a, b);
        if (projection.distance > 18 || (best && projection.distance >= best.distance)) continue;
        let bearing = Math.atan2(projection.dx, projection.dy);
        if (Math.cos(bearing - routeBearing) < 0) bearing += Math.PI;
        const center = [point[0] + (projection.ax + projection.t * projection.dx) / metersPerLon(point[1]), point[1] + (projection.ay + projection.t * projection.dy) / 111320];
        best = { distance: projection.distance, bearing, center };
      }
    }
    return best;
  };
  const routeBearing = (a, b) => {
    const east = (b[0] - a[0]) * metersPerLon((a[1] + b[1]) / 2);
    const north = (b[1] - a[1]) * 111320;
    return Math.atan2(east, north);
  };
  const lineSegmentsNear = (origin, bearing, radius = 30) => {
    const cellSize = 0.005, cx = Math.floor(origin[0] / cellSize), cy = Math.floor(origin[1] / cellSize), candidates = new Set(state.edgeGlobal || []);
    const lonCells = Math.ceil(radius / metersPerLon(origin[1]) / cellSize) + 1, latCells = Math.ceil(radius / 111320 / cellSize) + 1;
    for (let x = cx - lonCells; x <= cx + lonCells; x++) for (let y = cy - latCells; y <= cy + latCells; y++) {
      for (const segment of state.edgeGrid.get(`${x}/${y}`) || []) candidates.add(segment);
    }
    const segments = [];
    for (const [aPoint, bPoint] of candidates) {
      const a = toLocal(aPoint, origin, bearing), b = toLocal(bPoint, origin, bearing);
      if (Math.min(a.along, b.along) > radius || Math.max(a.along, b.along) < -radius ||
          Math.min(a.lateral, b.lateral) > radius || Math.max(a.lateral, b.lateral) < -radius) continue;
      segments.push([a, b]);
    }
    return segments;
  };
  const imageFit = (edges, width, length, keepLeft = false) => {
    const scale = 5, size = 301, center = (size - 1) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size, size);
    context.strokeStyle = '#d00000';
    context.lineWidth = 1.5;
    for (const [a, b] of edges) {
      context.beginPath();
      context.moveTo(center + a.lateral * scale, center - a.along * scale);
      context.lineTo(center + b.lateral * scale, center - b.along * scale);
      context.stroke();
    }
    const pixels = context.getImageData(0, 0, size, size).data;
    const halfW = width / 2, halfL = length / 2, inner = 0.15;
    let collision = false, leftEvidence = 0, rightEvidence = 0;
    const countRedPixels = (x1, x2, y1, y2) => {
      let count = 0;
      for (let y = Math.max(0, y1); y <= Math.min(size - 1, y2); y++) {
        for (let x = Math.max(0, x1); x <= Math.min(size - 1, x2); x++) {
          const index = (y * size + x) * 4;
          if (pixels[index] >= 180 && pixels[index + 1] <= 100) count++;
        }
      }
      return count;
    };
    const roadHalfLength = Math.round((halfL + 1) * scale), edgeCounts = [];
    for (let x = 0; x < size; x++) edgeCounts[x] = countRedPixels(x, x, center - roadHalfLength, center + roadHalfLength);
    const threshold = Math.max(2, Math.floor(roadHalfLength * 0.08));
    const boundary = direction => {
      const start = direction > 0 ? center + Math.round(halfW * scale) : center - Math.round(halfW * scale);
      const end = direction > 0 ? size - 1 : 0, candidates = [];
      for (let x = start; direction > 0 ? x <= end : x >= end; x += direction) {
        if (edgeCounts[x] >= threshold) candidates.push(x);
      }
      if (!candidates.length) return null;
      const first = candidates[0], cluster = candidates.filter(x => Math.abs(x - first) <= 2);
      return Math.round(cluster.reduce((sum, x) => sum + x, 0) / cluster.length);
    };
    const leftBoundary = boundary(1), rightBoundary = boundary(-1);
    const edgesFound = leftBoundary !== null && rightBoundary !== null;
    if (!edgesFound) return { status: 'unknown', collision: false, edgesFound: false, lateralShift: 0 };
    const lateralShift = keepLeft ? (leftBoundary - center) / scale - halfW - 1 / scale : 0;
    const shiftPx = Math.round(lateralShift * scale);
    const bodyHalfWidth = Math.round(halfW * scale), bodyHalfLength = Math.round(halfL * scale);
    collision = countRedPixels(center + shiftPx - bodyHalfWidth, center + shiftPx + bodyHalfWidth,
      center - bodyHalfLength, center + bodyHalfLength) > 0;
    return { status: collision ? 'fail' : 'pass', collision, edgesFound, lateralShift };
  };
  const offset = (point, bearing, along, lateral) => {
    const east = along * Math.sin(bearing) - lateral * Math.cos(bearing);
    const north = along * Math.cos(bearing) + lateral * Math.sin(bearing);
    return [point[0] + east / metersPerLon(point[1]), point[1] + north / 111320];
  };
  const footprint = (front, rear, bearing, width, lateralShift, color) => {
    const frontCenter = offset(front, bearing, 0, lateralShift), rearCenter = offset(rear, bearing, 0, lateralShift);
    const corners = [
      offset(frontCenter, bearing, 0, width / 2),
      offset(frontCenter, bearing, 0, -width / 2),
      offset(rearCenter, bearing, 0, -width / 2),
      offset(rearCenter, bearing, 0, width / 2)
    ].map(([lon, lat]) => [lat, lon]);
    return window.L.polygon(corners, { color, weight: 1, fillColor: color, fillOpacity: 0.08, interactive: false });
  };
  const routeSamples = (map, routeLayers) => {
    const samples = [], bounds = map.getBounds();
    for (const route of routeLayers) {
      route.layer.eachLayer(layer => {
        if (!(layer instanceof window.L.Polyline) || !String(layer.options.className || '').includes('route-soft')) return;
        const points = layer.getLatLngs().map(point => [point.lng, point.lat]);
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1], b = points[i], distance = map.distance([a[1], a[0]], [b[1], b[0]]);
          if (distance < 0.1) continue;
          const steps = Math.max(1, Math.ceil(distance / 10));
          for (let j = 0; j < steps; j++) {
            const t = j / steps;
            const point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            if (bounds.contains([point[1], point[0]])) samples.push({ point, bearing: routeBearing(a, b), routeNo: route.routeNo });
          }
        }
      });
    }
    return samples;
  };
  const atDistance = (coordinates, distance) => {
    let remaining = Math.max(0, distance);
    for (let i = 1; i < coordinates.length; i++) {
      const a = coordinates[i - 1], b = coordinates[i], length = Math.hypot((b[0] - a[0]) * metersPerLon(a[1]), (b[1] - a[1]) * 111320);
      if (length <= 0) continue;
      if (remaining <= length || i === coordinates.length - 1) {
        const t = Math.max(0, Math.min(1, remaining / length));
        return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing: routeBearing(a, b) };
      }
      remaining -= length;
    }
    return null;
  };
  const distanceBetween = (a, b) => Math.hypot((b[0] - a[0]) * metersPerLon(a[1]), (b[1] - a[1]) * 111320);
  const angularDifference = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const vectorSamples = (route, dimensions) => {
    const samples = [], seen = new Set(), skippedByIntersection = new Map();
    for (const step of route.steps || []) {
      const context = step._trolleyPathContext, check = step._trolleyCheck;
      if (!context || context.coordinates.length < 2 || step._endpointExcluded || check?.status === 'excluded') continue;
      const [start, end] = context.range, first = Math.ceil(start / 10) * 10;
      for (let station = first; station <= end + 0.01; station += 10) {
        const key = `${step._routeLegIndex ?? 0}/${Math.round(station * 100)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rear = atDistance(context.coordinates, station - dimensions.length / 2);
        const front = atDistance(context.coordinates, station + dimensions.length / 2);
        const center = atDistance(context.coordinates, station);
        if (!rear || !front || !center) continue;
        const bearing = routeBearing(rear.point, front.point);
        const turn = angularDifference(rear.bearing, front.bearing) * 180 / Math.PI;
        const intersectionTurn = turn > 30 && (route._trolleyIntersections || []).some(point =>
          distanceBetween(center.point, point) <= dimensions.length / 2 + 5);
        if (intersectionTurn) {
          skippedByIntersection.set(step, (skippedByIntersection.get(step) || 0) + 1);
          continue;
        }
        samples.push({ step, station, point: center.point, rear: rear.point, front: front.point, bearing, routeBearing: center.bearing });
      }
    }
    return { samples, skippedByIntersection };
  };
  const makeStepResult = (stats, previous, name) => {
    if (!stats || (!stats.samples && !stats.intersectionSkipped)) return previous;
    let status = stats.fail ? 'fail' : stats.unknown || !stats.samples ? 'unchecked' : 'pass';
    const reason = status === 'fail' ? 'vector-footprint-collision' :
      status === 'unchecked' ? (stats.intersectionSkipped && !stats.samples ? 'intersection-turn-only' : 'road-edge-not-detected') : 'vector-footprint-fit';
    return { status, reason, name, samples: stats.samples || 0, intersectionSkipped: stats.intersectionSkipped || 0,
      source: '地理院RdCL・基盤地図情報RdEdg画像照合' };
  };
  const checkRoute = async (route, dimensions, options = {}) => {
    if (!state.features.length) return { active: false };
    const { samples, skippedByIntersection } = vectorSamples(route, dimensions);
    const centerlines = await fetchCenterlines(samples.map(sample => sample.point));
    const stepStats = new Map();
    for (const step of route.steps || []) {
      if (!step._endpointExcluded && step._trolleyCheck?.status !== 'excluded') {
        stepStats.set(step, { samples: 0, fail: false, unknown: false, intersectionSkipped: 0 });
      }
    }
    for (const [step, count] of skippedByIntersection) stepStats.set(step, { samples: 0, fail: false, unknown: false, intersectionSkipped: count });
    const map = bridge.getMap(), bounds = map.getBounds(), marks = [];
    for (const sample of samples) {
      const stat = stepStats.get(sample.step) || { samples: 0, fail: false, unknown: false, intersectionSkipped: 0 };
      stepStats.set(sample.step, stat);
      stat.samples++;
      const matchedCenter = nearestCenterline(sample.point, centerlines, sample.routeBearing);
      const rearMatch = matchedCenter && nearestCenterline(sample.rear, centerlines, sample.routeBearing);
      const frontMatch = matchedCenter && nearestCenterline(sample.front, centerlines, sample.routeBearing);
      let origin, bearing, rear, front, keepLeft = false;
      if (matchedCenter && rearMatch && frontMatch) {
        rear = rearMatch.center;
        front = frontMatch.center;
        origin = [(rear[0] + front[0]) / 2, (rear[1] + front[1]) / 2];
        bearing = routeBearing(rear, front);
      } else if (matchedCenter) {
        stat.unknown = true;
        if (bounds.contains([sample.point[1], sample.point[0]])) {
          marks.push(footprint(sample.front, sample.rear, sample.bearing, dimensions.width, 0, '#687782'));
        }
        continue;
      } else {
        rear = sample.rear;
        front = sample.front;
        origin = [(rear[0] + front[0]) / 2, (rear[1] + front[1]) / 2];
        bearing = routeBearing(rear, front);
        keepLeft = true;
      }
      const edges = lineSegmentsNear(origin, bearing);
      if (!edges.length) {
        stat.unknown = true;
        if (bounds.contains([origin[1], origin[0]])) marks.push(footprint(front, rear, bearing, dimensions.width, 0, '#687782'));
        continue;
      }
      const fit = imageFit(edges, dimensions.width, dimensions.length, keepLeft);
      if (fit.status === 'unknown') stat.unknown = true;
      else if (fit.status === 'fail') stat.fail = true;
      if (bounds.contains([origin[1], origin[0]])) {
        marks.push(footprint(front, rear, bearing, dimensions.width, fit.lateralShift,
          fit.status === 'pass' ? '#16843b' : fit.status === 'fail' ? '#d00000' : '#687782'));
      }
    }
    const stepResults = new Map();
    for (const step of route.steps || []) {
      const stats = stepStats.get(step);
      if (stats) stepResults.set(step, makeStepResult(stats, step._trolleyCheck, step.name || ''));
    }
    if (options.draw) {
      if (state.edgeLayer) map.removeLayer(state.edgeLayer);
      if (state.routeLayer) map.removeLayer(state.routeLayer);
      if (state.footprints) map.removeLayer(state.footprints);
      state.edgeLayer = window.L.geoJSON({ type: 'FeatureCollection', features: state.features },
        { style: { color: '#d00000', weight: 2, opacity: 0.9 } }).addTo(map);
      state.routeLayer = window.L.geoJSON({ type: 'FeatureCollection', features: centerlines },
        { style: { color: '#7626a8', weight: 2, opacity: 0.75 } }).addTo(map);
      state.footprints = window.L.featureGroup(marks).addTo(map);
    }
    return { active: true, stepResults, sampleCount: samples.length };
  };
  bridge.checkRoute = checkRoute;
  const loadEdges = async file => {
    const geojson = JSON.parse(await file.text());
    state.features = lineFeatures(geojson);
    state.edges = state.features;
    indexEdges(state.features);
    return geojson;
  };
  const runCheck = async () => {
    const map = bridge.getMap();
    const file = document.getElementById('narrowEdgeFile').files[0];
    if (!file) throw new Error('RdEdg GeoJSONファイルを選択してください');
    const dimensions = bridge.getDimensions();
    await loadEdges(file);
    const routes = bridge.getRouteLayers().map(item => item.route).filter(Boolean);
    if (!routes.length) throw new Error('先にルートを計算してください');
    let totals = { pass: 0, fail: 0, unchecked: 0, skipped: 0, samples: 0 };
    for (const route of routes) {
      const result = await checkRoute(route, dimensions, { draw: true });
      if (!result.active) continue;
      for (const check of result.stepResults.values()) {
        totals[check.status] = (totals[check.status] || 0) + 1;
        totals.skipped += check.intersectionSkipped || 0;
        totals.samples += check.samples || 0;
      }
    }
    status(`全ルート照合：10m間隔 ${totals.samples}点。画像上で車両形状内に道路縁が侵入 ${totals.fail}区間、両側道路縁の内側に収まる ${totals.pass}区間、未判定 ${totals.unchecked}区間。交差点旋回をパス ${totals.skipped}点（直進は計測）。紫=RdCL、赤=RdEdg、緑=照合可、赤=形状内へ侵入、灰=未判定。`);
  };

  document.getElementById('narrowEdgeFile').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await loadEdges(file);
      status(`RdEdgを読み込みました（線データ ${state.features.length}件）。ルート選定時にベクトル照合を使用します。`);
    } catch (error) {
      state.features = [];
      state.edgeGrid.clear();
      status(`RdEdgを読み込めません：${error.message || error}`);
    }
  });

  document.getElementById('narrowVectorCheck').addEventListener('click', async () => {
    const button = document.getElementById('narrowVectorCheck');
    button.disabled = true;
    status('道路縁・道路中心線データを取得して画像照合しています…');
    try {
      await runCheck();
    } catch (error) {
      status(`照合できません：${error.message || error}`);
    } finally {
      button.disabled = false;
    }
  });
})();
