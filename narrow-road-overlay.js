(() => {
  'use strict';

  const bridge = window.evNarrowRoadBridge;
  if (!bridge) return;

  const state = { edges: [], edgeLayer: null, routeLayer: null, footprints: null, features: [], edgeGrid: new Map(), centerlineTiles: new Map() };
  const panel = document.createElement('div');
  panel.id = 'narrowVectorPanel';
  panel.innerHTML = '<b>道路幅照合</b><label>道路縁 RdEdg GeoJSON（任意・WGS84/EPSG:4326）<input id="narrowEdgeFile" type="file" accept=".json,.geojson,application/geo+json"></label><button id="narrowVectorCheck" type="button">全区間照合</button><div id="narrowVectorStatus">RdEdgがない地点も標準地図画像で照合します。地図画像から道路端を確認できない地点は通過OKにしません。</div>';
  panel.querySelector('b').insertAdjacentHTML('afterend',
    '<a class="narrow-gsi-link" href="https://www.mlit.go.jp/road/ir/ir-data/census_visualizationR3/webmap.html" target="_blank" rel="noopener">国交省・一般交通量調査WEBマップ（車線数）</a>' +
    '<a class="narrow-gsi-link" href="https://service.gsi.go.jp/kiban/app/map/?search=base#9/34.6851/135.8048" target="_blank" rel="noopener">① 国土地理院道路情報のダウンロード</a>' +
    '<details class="narrow-gsi-help"><summary>取得手順（奈良県）</summary><ol><li>「基本項目を探す」→「項目指定」→「道路縁」にチェック</li><li>「都道府県・市区町村でメッシュを選択」を選び、奈良県とルート周辺の市町村を指定</li><li>「検索」→「選択をダウンロードリストに追加」→ダウンロード（ログインが必要です）</li><li>保存したZIPを下の②で選択</li></ol><small>全県一括ではなく、ルート周辺の市町村を選ぶとファイルを小さくできます。</small></details>');
  const edgeInput = panel.querySelector('#narrowEdgeFile');
  edgeInput.setAttribute('accept', '.zip,.xml,.json,.geojson,application/zip,application/xml,application/geo+json');
  edgeInput.setAttribute('multiple', '');
  edgeInput.parentElement.firstChild.textContent = '② ファイル選択 ';
  panel.querySelector('#narrowVectorStatus').textContent =
    '20m間隔で照合します。国交省の車線数も参照し、2車線以上は対象外。RdEdgで判定できない地点は標準地図画像を中央線なし方式で補助確認します。';
  document.body.append(panel);
  const panelToggle = document.createElement('button');
  panelToggle.id = 'narrowPanelToggle';
  panelToggle.type = 'button';
  panelToggle.textContent = '道路データ・判定を表示';
  panelToggle.addEventListener('click', () => document.body.classList.remove('route-view-clean'));
  document.body.append(panelToggle);

  const style = document.createElement('style');
  style.textContent = '#narrowVectorPanel{position:absolute;z-index:1200;left:10px;bottom:42px;width:min(270px,calc(100vw - 24px));max-height:40vh;overflow:auto;padding:5px 7px;font-size:11px;background:#fffffff2;border:1px solid #35566a;border-radius:6px;box-shadow:0 2px 8px #0005;font:12px/1.4 sans-serif;color:#183746}#narrowVectorPanel label{display:block;margin:6px 0}#narrowVectorPanel input{display:block;width:100%;margin-top:3px;font-size:11px}#narrowVectorPanel button{padding:5px 8px}#narrowVectorCheck{display:none}#narrowVectorStatus{margin-top:6px;font-size:11px}.narrow-gsi-link{display:block;margin:6px 0;padding:6px;background:#176fa7;color:white;text-decoration:none;text-align:center;font-weight:bold;border-radius:4px}.narrow-gsi-help{margin:5px 0;font-size:11px}.narrow-gsi-help ol{padding-left:20px}.narrow-gsi-help li{margin:3px 0}.narrow-gsi-help small{display:block;color:#586d78}#narrowPanelToggle{display:none;position:absolute;z-index:1201;left:10px;bottom:42px;padding:8px;background:#176fa7;color:white;border:0;border-radius:5px;font-weight:bold}body.route-view-clean #narrowVectorPanel,body.route-view-clean #status,body.menu-popup-open #narrowVectorPanel,body.menu-popup-open #status{display:none}body.route-view-clean #narrowPanelToggle{display:block}';
  document.head.append(style);
  const positionRouteStatus = () => {
    const routeStatus = document.getElementById('status');
    if (!routeStatus) return;
    routeStatus.style.bottom = `${Math.max(10, window.innerHeight - panel.getBoundingClientRect().top + 8)}px`;
  };
  positionRouteStatus();
  window.addEventListener('resize', positionRouteStatus);
  new ResizeObserver(positionRouteStatus).observe(panel);

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
    for (const feature of features) for (const line of flatten(feature.geometry.coordinates)) {
      if (line.length < 2 || line.some(point => !Array.isArray(point) || !Number.isFinite(point[0]) ||
          !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)) {
        throw new Error('道路縁データは経度・緯度（WGS84 / EPSG:4326）のGeoJSONで指定してください');
      }
    }
    return features;
  };
  const featuresInBounds = (features, bounds) => features.filter(feature => {
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const line of flatten(feature.geometry.coordinates)) for (const point of line) {
      west = Math.min(west, point[0]); east = Math.max(east, point[0]);
      south = Math.min(south, point[1]); north = Math.max(north, point[1]);
    }
    return east >= bounds.getWest() && west <= bounds.getEast() && north >= bounds.getSouth() && south <= bounds.getNorth();
  });
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
  const fetchCenterlines = async (points, onProgress = () => {}) => {
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
    onProgress(0, tiles.length);
    for (let i = 0; i < tiles.length; i += 16) {
      const batch = tiles.slice(i, i + 16);
      const results = await Promise.all(batch.map(async tile => {
        const key = `${tile.z}/${tile.x}/${tile.y}`;
        if (state.centerlineTiles.has(key)) return state.centerlineTiles.get(key);
        const url = `https://cyberjapandata.gsi.go.jp/xyz/experimental_rdcl/${key}.geojson`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        let response;
        try {
          response = await fetch(url, { signal: controller.signal });
        } catch (error) {
          if (error.name === 'AbortError') throw new Error('地理院の道路中心線取得が15秒でタイムアウトしました');
          throw error;
        } finally {
          clearTimeout(timer);
        }
        if (response.status === 404) {
          const empty = { features: [] };
          state.centerlineTiles.set(key, empty);
          return empty;
        }
        if (!response.ok) throw new Error(`道路中心線タイルを取得できません（HTTP ${response.status}）`);
        const data = await response.json();
        state.centerlineTiles.set(key, data);
        if (state.centerlineTiles.size > 1500) state.centerlineTiles.delete(state.centerlineTiles.keys().next().value);
        return data;
      }));
      results.forEach(result => features.push(...(result.features || [])));
      onProgress(Math.min(i + batch.length, tiles.length), tiles.length);
    }
    return [...new Map(features.map(feature => [JSON.stringify(feature.geometry?.coordinates), feature])).values()]
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
    let best = null, bestScore = Infinity;
    for (const feature of features) {
      const coordinates = feature.geometry.coordinates;
      for (let i = 1; i < coordinates.length; i++) {
        const a = coordinates[i - 1], b = coordinates[i];
        const projection = distancePointSegment(point, a, b);
        if (projection.distance > 18) continue;
        let bearing = Math.atan2(projection.dx, projection.dy);
        if (Math.cos(bearing - routeBearing) < 0) bearing += Math.PI;
        const score = projection.distance + angularDifference(bearing, routeBearing) * 6;
        if (score >= bestScore) continue;
        const center = [point[0] + (projection.ax + projection.t * projection.dx) / metersPerLon(point[1]), point[1] + (projection.ay + projection.t * projection.dy) / 111320];
        best = { distance: projection.distance, bearing, center };
        bestScore = score;
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
      if (Math.abs(b.along - a.along) < Math.abs(b.lateral - a.lateral) * 0.5) continue;
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
    const halfW = width / 2, halfL = length / 2;
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
      const start = center + direction;
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
    const roadWidth = edgesFound ? Math.abs(leftBoundary - rightBoundary) / scale : null;
    if (keepLeft && leftBoundary === null) return { status: 'unknown', collision: false, edgesFound, lateralShift: 0, roadWidth };
    const lateralShift = keepLeft ? (leftBoundary - center) / scale - halfW - 1 / scale : 0;
    const shiftPx = Math.round(lateralShift * scale);
    const bodyHalfWidth = Math.round(halfW * scale);
    const bodyLeft = center + shiftPx + bodyHalfWidth, bodyRight = center + shiftPx - bodyHalfWidth;
    collision = (leftBoundary !== null && leftBoundary <= bodyLeft) ||
      (rightBoundary !== null && rightBoundary >= bodyRight);
    if (collision) return { status: 'fail', collision, edgesFound, lateralShift, roadWidth };
    if (!edgesFound) return { status: 'unknown', collision: false, edgesFound, lateralShift, roadWidth };
    return { status: 'pass', collision: false, edgesFound, lateralShift, roadWidth };
  };
  const offset = (point, bearing, along, lateral) => {
    const east = along * Math.sin(bearing) - lateral * Math.cos(bearing);
    const north = along * Math.cos(bearing) + lateral * Math.sin(bearing);
    return [point[0] + east / metersPerLon(point[1]), point[1] + north / 111320];
  };
  const mapTiles = new Map();
  const MAP_Z = 18;
  const loadMapTile = async (x, y) => {
    const key = `${x}/${y}`;
    if (mapTiles.has(key)) return mapTiles.get(key);
    const promise = new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      const timer = setTimeout(() => resolve(null), 8000);
      image.onload = () => {
        clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 256;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(image, 0, 0);
          resolve(context.getImageData(0, 0, 256, 256).data);
        } catch (error) { resolve(null); }
      };
      image.onerror = () => { clearTimeout(timer); resolve(null); };
      image.src = `https://cyberjapandata.gsi.go.jp/xyz/std/${MAP_Z}/${x}/${y}.png`;
    });
    mapTiles.set(key, promise);
    if (mapTiles.size > 300) mapTiles.delete(mapTiles.keys().next().value);
    return promise;
  };
  const worldPixel = point => {
    const n = 2 ** MAP_Z;
    return { x: (point[0] + 180) / 360 * n * 256, y: (1 - Math.asinh(Math.tan(point[1] * Math.PI / 180)) / Math.PI) / 2 * n * 256 };
  };
  const mapDrawnEdges = async (origin, bearing, length) => {
    const reach = 14, extent = length / 2 + 2, meterPerPixel = 156543.03 * Math.cos(origin[1] * Math.PI / 180) / 2 ** MAP_Z;
    const corners = [offset(origin, bearing, extent, reach), offset(origin, bearing, -extent, -reach), offset(origin, bearing, extent, -reach), offset(origin, bearing, -extent, reach)].map(worldPixel);
    const minX = Math.floor(Math.min(...corners.map(c => c.x)) / 256), maxX = Math.floor(Math.max(...corners.map(c => c.x)) / 256);
    const minY = Math.floor(Math.min(...corners.map(c => c.y)) / 256), maxY = Math.floor(Math.max(...corners.map(c => c.y)) / 256);
    const data = new Map();
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) data.set(`${x}/${y}`, await loadMapTile(x, y));
    const isLine = point => {
      const pixel = worldPixel(point), tx = Math.floor(pixel.x / 256), ty = Math.floor(pixel.y / 256), tile = data.get(`${tx}/${ty}`);
      if (!tile) return null;
      const index = (Math.floor(pixel.y - ty * 256) * 256 + Math.floor(pixel.x - tx * 256)) * 4;
      const r = tile[index], g = tile[index + 1], b = tile[index + 2];
      return 0.3 * r + 0.59 * g + 0.11 * b < 190;
    };
    const left = [], right = [];
    for (let along = -extent; along <= extent; along += 1) {
      const center = offset(origin, bearing, along, 0);
      const scan = sign => {
        for (let d = 0.5; d <= reach; d += meterPerPixel) {
          const hit = isLine(offset(center, bearing, 0, sign * d));
          if (hit === null) return null;
          if (hit) return d;
        }
        return null;
      };
      left.push({ along, lateral: scan(1) });
      const rightDistance = scan(-1);
      right.push({ along, lateral: rightDistance === null ? null : -rightDistance });
    }
    const bridgeShortGaps = side => {
      const result = side.map(item => ({ ...item }));
      for (let start = 0; start < result.length;) {
        if (result[start].lateral !== null) { start++; continue; }
        let end = start;
        while (end + 1 < result.length && result[end + 1].lateral === null) end++;
        if (start > 0 && end + 1 < result.length && end - start < 3) {
          const before = result[start - 1].lateral, after = result[end + 1].lateral, span = end - start + 2;
          for (let i = start; i <= end; i++) {
            result[i].lateral = before + (after - before) * (i - start + 1) / span;
          }
        }
        start = end + 1;
      }
      return result;
    };
    const smooth = side => side.map((item, i) => {
      if (item.lateral === null) return item;
      const near = side.slice(Math.max(0, i - 2), i + 3).map(x => x.lateral).filter(v => v !== null).sort((a, b) => a - b);
      return { along: item.along, lateral: near[Math.floor(near.length / 2)] };
    });
    const leftLine = smooth(bridgeShortGaps(left)), rightLine = smooth(bridgeShortGaps(right));
    const segments = [];
    for (const side of [leftLine, rightLine]) {
      for (let i = 1; i < side.length; i++) {
        const a = side[i - 1], b = side[i];
        if (a.lateral !== null && b.lateral !== null && Math.abs(a.lateral - b.lateral) < 3) segments.push([a, b]);
      }
    }
    const rows = left.length;
    const haveLeft = left.filter(item => item.lateral !== null).length, haveRight = right.filter(item => item.lateral !== null).length;
    return {
      segments: haveLeft >= rows * 0.5 && haveRight >= rows * 0.5 ? segments : [],
      unavailable: [...data.values()].some(tile => tile === null)
    };
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
  const gsiIntersectionPoints = features => {
    const nodes = new Map(), threshold = 25 * Math.PI / 180;
    const addDirection = (point, neighbor) => {
      if (distanceBetween(point, neighbor) < 0.2) return;
      const key = `${Math.round(point[0] * 100000)}/${Math.round(point[1] * 100000)}`;
      const node = nodes.get(key) || { point, directions: [] }, direction = routeBearing(point, neighbor);
      if (node.directions.every(value => angularDifference(value, direction) > threshold)) node.directions.push(direction);
      nodes.set(key, node);
    };
    for (const feature of features) {
      const coordinates = feature.geometry.coordinates;
      for (let i = 0; i < coordinates.length; i++) {
        if (i) addDirection(coordinates[i], coordinates[i - 1]);
        if (i + 1 < coordinates.length) addDirection(coordinates[i], coordinates[i + 1]);
      }
    }
    return [...nodes.values()].filter(node => node.directions.length >= 3).map(node => node.point);
  };
  const vectorSamples = (route, dimensions) => {
    const samples = [], seen = new Set();
    for (const step of route.steps || []) {
      const context = step._trolleyPathContext, check = step._trolleyCheck;
      if (!context || context.coordinates.length < 2 || step._endpointExcluded || check?.status === 'excluded') continue;
      const [start, end] = context.range, first = Math.ceil(start / 20) * 20;
      for (let station = first; station <= end + 0.01; station += 20) {
        const key = `${step._routeLegIndex ?? 0}/${Math.round(station * 100)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rear = atDistance(context.coordinates, station - dimensions.length / 2);
        const front = atDistance(context.coordinates, station + dimensions.length / 2);
        const center = atDistance(context.coordinates, station);
        if (!rear || !front || !center) continue;
        const bearing = routeBearing(rear.point, front.point);
        const turn = angularDifference(rear.bearing, front.bearing) * 180 / Math.PI;
        samples.push({ step, station, point: center.point, rear: rear.point, front: front.point, bearing,
          routeBearing: center.bearing, turn, intersectionRadius: dimensions.length / 2 + 5 });
      }
    }
    return samples;
  };
  const makeStepResult = (stats, previous, name) => {
    if (!stats) return previous;
    if (!stats.samples && !stats.intersectionSkipped && !stats.censusExcludedSamples) stats.unknown = true;
    let status = stats.fail ? 'fail' : !stats.samples && stats.censusExcludedSamples && !stats.unknown ? 'excluded' :
      stats.unknown || !stats.samples ? 'unchecked' : stats.cautionPoints.length ? 'caution' : 'pass';
    const reason = status === 'fail' ? 'vector-footprint-collision' :
      status === 'excluded' ? 'census-multilane-road' :
      status === 'unchecked' ? (stats.intersectionSkipped && !stats.samples ? 'intersection-turn-only' : 'road-edge-not-detected') :
      status === 'caution' ? 'short-narrow-section' : 'vector-footprint-fit';
    return { status, reason, name, samples: stats.samples || 0, intersectionSkipped: stats.intersectionSkipped || 0,
      mapMaxRun: stats.mapMaxRun || 0, mapFailCount: stats.mapFailCount || 0, minWidth: Number.isFinite(stats.minWidth) ? stats.minWidth : null,
      failureMinWidth: Number.isFinite(stats.failureMinWidth) ? stats.failureMinWidth : null,
      cautionMinWidth: Number.isFinite(stats.cautionMinWidth) ? stats.cautionMinWidth : null,
      failurePoints: stats.failurePoints || [], cautionPoints: stats.cautionPoints || [],
      censusExcludedSamples: stats.censusExcludedSamples || 0,
      mapFallbackAttempts: stats.mapFallbackAttempts || 0,
      mapFallbackUnavailable: stats.mapFallbackUnavailable || 0,
      mapFallbackUnavailablePoints: stats.mapFallbackUnavailablePoints || [],
      mapFallbackNotDetected: stats.mapFallbackNotDetected || 0,
      mapFallbackNotDetectedPoints: stats.mapFallbackNotDetectedPoints || [],
      intersectionSkippedPoints: stats.intersectionSkippedPoints || [],
      source: [stats.censusExcludedSamples ? '国交省道路交通センサス車線数' : '',
        stats.mapDrawn ? '標準地図画像補助（中央線なし方式）' : '地理院RdCL・基盤地図情報RdEdg画像照合'].filter(Boolean).join('・') };
  };
  const checkRoute = async (route, dimensions, options = {}) => {
    if (options.draw) bridge.hideCheckLayers?.();
    const allSamples = vectorSamples(route, dimensions), censusExcluded = new Map(), samples = [];
    for (const sample of allSamples) {
      if (route._censusLaneAt?.(sample.step, sample.point, sample.routeBearing) >= 2) {
        censusExcluded.set(sample.step, (censusExcluded.get(sample.step) || 0) + 1);
      } else samples.push(sample);
    }
    const report = text => {
      const routeStatus = document.getElementById('status');
      const checkLabel = route._trolleyCheckLabel ? `${route._trolleyCheckLabel}：` : '';
      if (routeStatus) routeStatus.textContent = checkLabel + text;
    };
    report(samples.length
      ? `道路中心線を取得しています（0/${samples.length}地点、国交省センサスで2車線以上の${allSamples.length-samples.length}地点を対象外）…`
      : `国交省センサスで2車線以上の${allSamples.length}地点を狭隘チェック対象外にしています…`);
    let centerlines = [], centerlineWarning = '';
    if (samples.length) {
      try {
        centerlines = await fetchCenterlines(samples.map(sample => sample.point), (loaded, total) => {
          report(`道路中心線タイルを取得しています（${loaded}/${total}）…`);
        });
      } catch (error) {
        centerlineWarning = error.message || '道路中心線を取得できませんでした';
        report(`道路中心線を取得できません。標準地図画像で補助確認しています：${centerlineWarning}`);
      }
    }
    const intersections = [...(route._trolleyIntersections || []), ...gsiIntersectionPoints(centerlines)];
    const stepStats = new Map();
    for (const step of route.steps || []) {
      if (!step._endpointExcluded && step._trolleyCheck?.status !== 'excluded') {
        stepStats.set(step, { samples: 0, fail: false, unknown: false, intersectionSkipped: 0, failurePoints: [], cautionPoints: [], failureSamples: [],
          failureWidths: [], cautionWidths: [],
          censusExcludedSamples: censusExcluded.get(step) || 0,
          mapFallbackAttempts: 0, mapFallbackUnavailable: 0, mapFallbackNotDetected: 0,
          mapFallbackUnavailablePoints: [], mapFallbackNotDetectedPoints: [], intersectionSkippedPoints: [] });
      }
    }
    const map = bridge.getMap(), bounds = map.getBounds();
    if (options.draw) {
      state.edgeLayer = window.L.geoJSON({ type: 'FeatureCollection', features: featuresInBounds(state.features, bounds) },
        { style: { color: '#d00000', weight: 2, opacity: 0.9 } }).addTo(map);
      state.routeLayer = window.L.geoJSON({ type: 'FeatureCollection', features: featuresInBounds(centerlines, bounds) },
        { style: { color: '#7626a8', weight: 2, opacity: 0.75 } }).addTo(map);
      state.footprints = window.L.featureGroup().addTo(map);
    }
    const showMark = mark => { if (options.draw) state.footprints.addLayer(mark); };
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      if (i % 100 === 0 || i === samples.length - 1) {
        bridge.moveRouteCheckProgress?.(sample.point);
        report(`車両形状を照合中（${i + 1}/${samples.length}地点、道路：${sample.step.name || sample.step.ref || '名称なし'}）…`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const stat = stepStats.get(sample.step) || { samples: 0, fail: false, unknown: false, intersectionSkipped: 0, failurePoints: [], cautionPoints: [], failureSamples: [],
        failureWidths: [], cautionWidths: [],
        censusExcludedSamples: censusExcluded.get(sample.step) || 0,
        mapFallbackAttempts: 0, mapFallbackUnavailable: 0, mapFallbackNotDetected: 0,
        mapFallbackUnavailablePoints: [], mapFallbackNotDetectedPoints: [], intersectionSkippedPoints: [] };
      stepStats.set(sample.step, stat);
      if (sample.turn > 30 && intersections.some(point => distanceBetween(sample.point, point) <= sample.intersectionRadius)) {
        stat.intersectionSkipped++;
        stat.intersectionSkippedPoints.push(sample.point);
        continue;
      }
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
      } else {
        rear = sample.rear;
        front = sample.front;
        origin = [(rear[0] + front[0]) / 2, (rear[1] + front[1]) / 2];
        bearing = routeBearing(rear, front);
        keepLeft = true;
      }
      let edges = lineSegmentsNear(origin, bearing), fit = edges.length
        ? imageFit(edges, dimensions.width, dimensions.length, keepLeft)
        : null;
      let fallbackUnavailable = false, fallbackNotDetected = false;
      if (!fit || fit.status === 'unknown') {
        // 道路縁で判定できない地点は、標準地図を中央線なしと同じキープレフト方式で確認する
        stat.mapDrawn = true;
        stat.mapFallbackAttempts++;
        const fallback = await mapDrawnEdges(origin, bearing, dimensions.length);
        fallbackUnavailable = fallback.unavailable;
        if (fallback.unavailable) stat.mapFallbackUnavailable++;
        if (fallback.segments.length) {
          const drawnFit = imageFit(fallback.segments, dimensions.width, dimensions.length, true);
          edges = fallback.segments;
          fit = drawnFit;
          if (fit.status === 'fail') stat.mapFailCount = (stat.mapFailCount || 0) + 1;
          if (fit.status === 'unknown' && !fallback.unavailable) {
            stat.mapFallbackNotDetected++;
            fallbackNotDetected = true;
          }
        } else {
          if (!fallback.unavailable) {
            stat.mapFallbackNotDetected++;
            fallbackNotDetected = true;
          }
        }
      }
      if (!fit || fit.status === 'unknown' || !edges.length) {
        const nearbyIntersection = intersections.some(point =>
          distanceBetween(origin, point) <= sample.intersectionRadius + 5);
        if (nearbyIntersection && !fallbackUnavailable) {
          if (fallbackNotDetected) stat.mapFallbackNotDetected--;
          stat.intersectionSkipped++;
          stat.intersectionSkippedPoints.push(origin);
          continue;
        }
        stat.unknown = true;
        if (fallbackUnavailable) stat.mapFallbackUnavailablePoints.push(origin);
        else stat.mapFallbackNotDetectedPoints.push(origin);
        if (bounds.contains([origin[1], origin[0]])) showMark(footprint(front, rear, bearing, dimensions.width, 0, '#687782'));
        continue;
      }
      if (fit.roadWidth != null) stat.minWidth = Math.min(stat.minWidth ?? Infinity, fit.roadWidth);
      if (fit.status === 'unknown') stat.unknown = true;
      else if (fit.status === 'fail') stat.failureSamples.push({ leg: sample.step._routeLegIndex ?? 0, station: sample.station, point: origin, step: sample.step, roadWidth: fit.roadWidth });
      if (bounds.contains([origin[1], origin[0]])) {
        const mark = footprint(front, rear, bearing, dimensions.width, fit.lateralShift,
          fit.status === 'pass' ? '#16843b' : fit.status === 'fail' ? '#ffbf00' : '#687782');
        showMark(mark);
        if (fit.status === 'fail') stepStats.get(sample.step).failureSamples.at(-1).mark = mark;
      }
      if ((i + 1) % 250 === 0) {
        report(`20m間隔で車両形状を照合しています（${i + 1}/${samples.length}地点）…`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    const failureSamples = [...stepStats.values()].flatMap(stats => stats.failureSamples);
    const runs = bridge.classifyFailureRuns(failureSamples);
    for (const run of runs) {
      for (const sample of run.samples) {
        const stats = stepStats.get(sample.step);
        stats.mapMaxRun = Math.max(stats.mapMaxRun || 0, run.lengthMeters);
        if (run.sustained) {
          stats.fail = true;
          stats.failurePoints.push(sample.point);
          if (sample.roadWidth != null) stats.failureWidths.push(sample.roadWidth);
          sample.mark?.setStyle({ color: '#d00000' });
        } else {
          stats.cautionPoints.push(sample.point);
          if (sample.roadWidth != null) stats.cautionWidths.push(sample.roadWidth);
        }
      }
      if (run.sustained && options.draw !== false) {
        const sample = run.samples[Math.floor(run.samples.length / 2)];
        bridge.moveRouteCheckProgress?.(sample.point);
        const widthText = sample.roadWidth != null ? `約${sample.roadWidth.toFixed(1)}m` : '測定できず';
        const popup = window.L.popup({ closeButton: false, autoClose: false, closeOnClick: false })
          .setLatLng([sample.point[1], sample.point[0]]).setContent(`<b>幅不足区間</b> 測定道路幅 ${widthText}`).openOn(map);
        report(`幅不足が続く区間を確認しました（測定道路幅 ${widthText}）。5秒止まって表示します…`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        map.closePopup(popup);
      }
    }
    for (const stats of stepStats.values()) {
      stats.failureMinWidth = stats.failureWidths.length ? Math.min(...stats.failureWidths) : null;
      stats.cautionMinWidth = stats.cautionWidths.length ? Math.min(...stats.cautionWidths) : null;
    }
    const stepResults = new Map();
    for (const step of route.steps || []) {
      const stats = stepStats.get(step);
      if (stats) stepResults.set(step, makeStepResult(stats, step._trolleyCheck, step.name || ''));
    }
    return { active: true, stepResults, sampleCount: allSamples.length, checkedSampleCount: samples.length,
      censusExcludedSampleCount: allSamples.length - samples.length, warning: centerlineWarning };
  };
  bridge.checkRoute = checkRoute;
  bridge.hasRoadEdges = () => state.features.length > 0;
  bridge.moveRouteCheckProgress = point => window.moveRouteCheckProgress?.(point);
  bridge.hideCheckLayers = () => {
    const map = bridge.getMap();
    for (const key of ['edgeLayer', 'routeLayer', 'footprints']) {
      if (state[key] && map.hasLayer(state[key])) map.removeLayer(state[key]);
      state[key] = null;
    }
  };
  let zipLibraryPromise;
  const loadZipLibrary = () => {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (zipLibraryPromise) return zipLibraryPromise;
    zipLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload = () => window.JSZip ? resolve(window.JSZip) : reject(new Error('ZIP解凍ライブラリを利用できません'));
      script.onerror = () => reject(new Error('ZIP解凍ライブラリを読み込めません。インターネット接続を確認してください'));
      document.head.append(script);
    });
    return zipLibraryPromise;
  };
  const parseGmlRoadEdges = text => {
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('GML/XMLを読み取れません');
    const roads = [...xml.getElementsByTagNameNS('*', 'RdEdg')];
    const features = [];
    for (const road of roads) {
      const location = [...road.children].find(child => child.localName === 'loc');
      if (!location) continue;
      const lists = [...location.getElementsByTagNameNS('*', 'posList')];
      const coordinateLists = lists.length
        ? lists.map(node => {
          const values = node.textContent.trim().split(/\s+/).map(Number);
          const dimension = Number(node.getAttribute('srsDimension') || node.getAttribute('dimension') || 2);
          if (dimension !== 2 || values.length < 4 || values.length % 2) return [];
          const points = [];
          for (let i = 0; i < values.length; i += 2) {
            const first = values[i], second = values[i + 1];
            if (first >= 20 && first <= 47 && second >= 120 && second <= 155) points.push([second, first]);
            else points.push([first, second]);
          }
          return points;
        })
        : [...location.getElementsByTagNameNS('*', 'pos')].map(node => {
          const values = node.textContent.trim().split(/\s+/).map(Number);
          if (values.length !== 2) return [];
          const [first, second] = values;
          return first >= 20 && first <= 47 && second >= 120 && second <= 155
            ? [[second, first]]
            : [[first, second]];
        });
      for (const coordinates of coordinateLists) {
        if (coordinates.length >= 2) features.push({
          type: 'Feature',
          properties: { class: 'RdEdg' },
          geometry: { type: 'LineString', coordinates }
        });
      }
    }
    return features;
  };
  const readRoadEdges = async file => {
    if (/\.zip$/i.test(file.name)) {
      const JSZip = await loadZipLibrary();
      const archive = await JSZip.loadAsync(file);
      const xmlFiles = Object.values(archive.files).filter(entry => !entry.dir && /\.xml$/i.test(entry.name));
      if (!xmlFiles.length) throw new Error('ZIP内にGML/XMLファイルがありません');
      const features = [];
      for (const entry of xmlFiles) features.push(...parseGmlRoadEdges(await entry.async('string')));
      if (!features.length) throw new Error('ZIP内に道路縁（RdEdg）の線データがありません');
      return features;
    }
    if (/\.xml$/i.test(file.name)) {
      const features = parseGmlRoadEdges(await file.text());
      if (!features.length) throw new Error('XML内に道路縁（RdEdg）の線データがありません');
      return features;
    }
    const geojson = JSON.parse(await file.text());
    return lineFeatures(geojson);
  };
  const loadEdges = async files => {
    if (!files.length) throw new Error('ダウンロードした道路縁ZIPまたはGeoJSONを選択してください');
    if (files.reduce((total, file) => total + file.size, 0) > 100 * 1024 * 1024) {
      throw new Error('選択ファイルの合計が100MBを超えています。ルート周辺の市町村だけ選んでください');
    }
    const features = [];
    for (const file of files) {
      if (file.size > 100 * 1024 * 1024) throw new Error(`${file.name} が大きすぎます（1ファイル100MB以下にしてください）`);
      features.push(...await readRoadEdges(file));
    }
    state.features = features;
    state.edges = state.features;
    indexEdges(state.features);
    return features;
  };
  const runCheck = async () => {
    const map = bridge.getMap();
    const files = [...document.getElementById('narrowEdgeFile').files];
    if (!files.length) throw new Error('先に奈良県の道路縁ZIPまたはGeoJSONを選択してください');
    const dimensions = bridge.getDimensions();
    await loadEdges(files);
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
    status(`全ルート照合：20m間隔 ${totals.samples}点。画像上で車両形状内に道路縁が侵入 ${totals.fail}区間、両側道路縁の内側に収まる ${totals.pass}区間、未判定 ${totals.unchecked}区間。交差点旋回をパス ${totals.skipped}点（直進は計測）。紫=RdCL、赤=RdEdg、緑=照合可、赤=形状内へ侵入、灰=未判定。`);
  };

  document.getElementById('narrowEdgeFile').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    state.features = [];
    state.edgeGrid.clear();
    state.edgeGlobal = [];
    const map = bridge.getMap();
    for (const key of ['edgeLayer', 'routeLayer', 'footprints']) {
      if (state[key]) map.removeLayer(state[key]);
      state[key] = null;
    }
    status('RdEdgデータを読み込んでいます。完了までは未判定です。');
    try {
      await loadEdges([...event.target.files]);
      status(`道路縁を読み込みました（線データ ${state.features.length}件）。ZIPはこのブラウザー内で解凍しました。`);
    } catch (error) {
      state.features = [];
      state.edgeGrid.clear();
      state.edgeGlobal = [];
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
