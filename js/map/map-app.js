/**
 * map-app.js v47-lod2-altitude-label-from-scan-bounds
 * - LOD2 mesh raycast 優先版
 * - feature.id / setFeatureState() を使わない
 * - LOD2 ON 時は GLB mesh を先に raycast
 * - LOD2 mesh に当たれば footprint HIT へ進まない
 * - LOD2 mesh に当たらない場合だけ footprint HIT に fallback
 * - Footprint scan は raw footprint + MapLibre fill-extrusion top-down slice
 * - 建物クリック時は即 scan せず、建物上 UI（Height / Area / Bulk / LASER / SHADOW）で実行選択
 */
import { state } from '../state.js';
import { VegetationManager } from './vegetation-manager.js';
import { StyleTuner } from './style-tuner.js';
import { CameraController } from './camera-controller.js';
import { RoadGlbLayer } from '../glb/road-glb-layer.js';
import { GlbCombinedLayer } from '../glb/glb-combined-layer.js';
import { SelectedShadowLayer } from '../analysis/selected-shadow-layer.js';

const AREAS_JSON_URL = 'bldg_luse/areas.json';

const INITIAL_CENTER = [135.42834, 34.82156];
const INITIAL_ZOOM   = 16;
const INITIAL_PITCH  = 50;
const MAX_PITCH      = 60;
const PATHFINDER_MAX_PITCH = 80;
const IKEDA_SHARED_ORIGIN = [135.412500000175, 34.783333333767];

const HILLSHADE_TILE_URL  = 'https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png';
const HILLSHADE_SOURCE_ID = 'gsi-hillshade-source';
const HILLSHADE_LAYER_ID  = 'gsi-hillshade-underlay';
const HILLSHADE_OPACITY   = 0.18;

const FOOTPRINT_SOURCE    = 'petiteau-bldg-footprint';
const FOOTPRINT_FILL      = 'petiteau-bldg-footprint-fill';
const FOOTPRINT_LINE      = 'petiteau-bldg-footprint-line';
const FOOTPRINT_EXTRUSION = 'petiteau-bldg-footprint-extrusion';
const FOOTPRINT_EXTRUSION_ROOF = 'petiteau-bldg-footprint-extrusion-roof';
const FOOTPRINT_HIT       = 'petiteau-bldg-footprint-hit';

const SELECTED_BUILDING_SOURCE    = 'petiteau-selected-building-source';
const SELECTED_BUILDING_FILL      = 'petiteau-selected-building-fill';
const SELECTED_BUILDING_LINE      = 'petiteau-selected-building-line';
const SELECTED_BUILDING_BOTTOM_LINE = 'petiteau-selected-building-bottom-line';
const SELECTED_BUILDING_EXTRUSION = 'petiteau-selected-building-extrusion';
const SELECTED_BUILDING_HEIGHT_SCAN = 'petiteau-selected-building-height-scan';

const BG_LAYER_ID = 'petiteau-background';

const ZOOM_3D_THRESHOLD   = 15.6;
const ZOOM_LOD2_THRESHOLD = 15.6;

const FP_2D_FILL_COLOR     = '#ffffff';
const FP_3D_ROOF_COLOR     = '#ffffff';
const FP_3D_WALL_COLOR     = '#c5cbe2';
const FP_LINE_COLOR        = '#3d607b';
const FP_LINE_WIDTH        = 0.4;
const FP_3D_AMBIENT_COLOR  = '#f3f5fc';
const FP_3D_AMBIENT_STRENGTH = 0.0;
const FP_3D_ROOF_SUN_STRENGTH = 1.12;
const FP_3D_WALL_SUN_STRENGTH = 2.00;
const FP_3D_ROOF_CAP_THICKNESS_M = 0.08;
const DEFAULT_GROUND_COLOR = '#e7eaf3';

// 照明デフォルト（LOD1 / LOD2 分離）
const DEFAULT_LOD1_SUN_AZIMUTH       = 144;
const DEFAULT_LOD1_SUN_ELEVATION     = 54;
const DEFAULT_LOD1_SUN_INTENSITY     = 0.31;

const DEFAULT_LOD2_SUN_AZIMUTH       = 144;
const DEFAULT_LOD2_SUN_ELEVATION     = 54;
const DEFAULT_LOD2_SUN_INTENSITY     = 0.51;
const DEFAULT_LOD2_AMBIENT_INTENSITY = 1.50;
const DEFAULT_LOD2_FILL_COLOR = '#fcfdfd';
const DEFAULT_LOD2_FILL_INTENSITY = 2.00;
const DEFAULT_LOD2_RIM_COLOR = '#7790f3';
const DEFAULT_LOD2_RIM_INTENSITY = 1.20;
const DEFAULT_LOD2_SHADOW_SIZE = 2048;
const DEFAULT_LOD2_SHADOW_MIN_ZOOM = 19.0;

// LOD2 専用色
const DEFAULT_LOD2_ROOF_COLOR = '#fcfcfc';
const DEFAULT_LOD2_WALL_COLOR = '#ededf3';
const DEFAULT_LOD2_ROOF_SUN_STRENGTH = 0.96;
const DEFAULT_LOD2_WALL_SUN_STRENGTH = 0.65;
const DEFAULT_LOD2_OPACITY = 1.0;
const DEFAULT_LOD2_AMBIENT_COLOR = '#ffffff';
const DEFAULT_LOD2_AMBIENT_STRENGTH = 1.00;

const BASE_STYLE_URL = 'https://gsi-cyberjapan.github.io/gsivectortile-mapbox-gl-js/std.json';

// ═══════════════════════════════════════════════════════════════
// URL 絶対化
// ═══════════════════════════════════════════════════════════════

function absolutizeUrl(url, base) {
  if (!url || typeof url !== 'string') return url;
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function absolutizeTemplateUrl(url, base) {
  if (!url || typeof url !== 'string') return url;

  const placeholders = [];

  const protected_ = url.replace(/\{[^}]+\}/g, (m) => {
    const token = `__TPL_${placeholders.length}__`;
    placeholders.push([token, m]);
    return token;
  });

  try {
    let resolved = new URL(protected_, base).toString();

    for (const [token, original] of placeholders) {
      resolved = resolved.replaceAll(token, original);
    }

    return resolved;
  } catch {
    return url;
  }
}

// ═══════════════════════════════════════════════════════════════
// スタイル事前変換
// ═══════════════════════════════════════════════════════════════

function _layerText(layer) {
  return JSON.stringify({
    id: layer.id,
    type: layer.type,
    source: layer.source,
    sourceLayer: layer['source-layer'],
    filter: layer.filter,
    layout: layer.layout,
    paint: layer.paint,
    metadata: layer.metadata,
  }).toLowerCase();
}

function _looksLikeWater(t) {
  return /water|river|lake|stream|canal|coastline|海|河川|湖|水域/.test(t);
}

function _looksLikeVegetation(t) {
  return /park|forest|wood|green|grass|farmland|landuse|lc_|公園|森林|緑/.test(t);
}

function _looksLikeBuilding(t) {
  return /building|bldg|建物|建築|普通建物|堅ろう建物|無壁舎/.test(t);
}

function _looksLikeContour(t) {
  return /contour|等高線|isobath/.test(t);
}

function preProcessStyle(styleJson, baseUrl, groundColor = DEFAULT_GROUND_COLOR) {
  if (styleJson.sprite) styleJson.sprite = absolutizeUrl(styleJson.sprite, baseUrl);
  if (styleJson.glyphs) styleJson.glyphs = absolutizeTemplateUrl(styleJson.glyphs, baseUrl);

  if (styleJson.sources) {
    for (const src of Object.values(styleJson.sources)) {
      if (!src) continue;

      if (Array.isArray(src.tiles)) {
        src.tiles = src.tiles.map((u) => absolutizeTemplateUrl(u, baseUrl));
      }

      if (typeof src.url === 'string') {
        src.url = absolutizeUrl(src.url, baseUrl);
      }

      if (typeof src.data === 'string') {
        src.data = absolutizeUrl(src.data, baseUrl);
      }
    }
  }

  for (const layer of styleJson.layers || []) {
    if (!layer) continue;

    layer.paint  = layer.paint  || {};
    layer.layout = layer.layout || {};

    const t = _layerText(layer);

    if (layer.type === 'background') {
      layer.paint['background-color'] = groundColor;
      continue;
    }

    if (layer.type === 'hillshade') {
      layer.paint['hillshade-shadow-color']    = '#8a9098';
      layer.paint['hillshade-highlight-color'] = '#f0ede6';
      layer.paint['hillshade-exaggeration']    = 0.14;
      continue;
    }

    if (layer.type === 'fill') {
      if (_looksLikeWater(t)) {
        layer.paint['fill-color']   = '#9dd4e8';
        layer.paint['fill-opacity'] = 0.92;
      } else if (_looksLikeVegetation(t)) {
        layer.paint['fill-color']   = '#c8dfb0';
        layer.paint['fill-opacity'] = 0.65;
      } else if (_looksLikeBuilding(t)) {
        layer.paint['fill-color']   = '#f4f5f7';
        layer.paint['fill-opacity'] = 0.0;
      } else {
        layer.paint['fill-color']         = groundColor;
        layer.paint['fill-opacity']       = 1.0;
        layer.paint['fill-outline-color'] = groundColor;
      }
      continue;
    }

    if (layer.type === 'line') {
      if (_looksLikeWater(t)) {
        layer.paint['line-color']   = '#7ec8e3';
        layer.paint['line-opacity'] = 0.9;
      } else if (_looksLikeContour(t)) {
        layer.paint['line-color']   = '#9fbc6f';
        layer.paint['line-opacity'] = 0.48;

        if (!layer.paint['line-width']) {
          layer.paint['line-width'] = 0.5;
        }
      }
      continue;
    }
  }

  return styleJson;
}

// ═══════════════════════════════════════════════════════════════
// MapApp
// ═══════════════════════════════════════════════════════════════

export class MapApp {
  constructor() {
    this.map               = null;
    this.vegetationManager = null;
    this.tranLayer         = null;
    this.lod2Layer         = null;
    this.footprintScanLayer = null;
    this.selectedShadowLayer = null;
    this.styleTuner        = null;
    this.cameraController  = null;
    this._listeners        = {};
    this._lod2Active       = null;
    this._groundColor      = DEFAULT_GROUND_COLOR;
    this._glbDLon          = 0;
    this._glbDLat          = 0;
    this._clickHandlersAttached = false;
    this._heightScanStartToken = 0;

    const scanDefaultIsMobile =
      typeof window !== 'undefined' &&
      window.innerWidth <= 720;

    // レーザースキャン幅の初期値:
    // PC = 0.2m / mobile = 0.3m
    this._heightScanBandWidthM = scanDefaultIsMobile ? 0.3 : 0.2;
    this._heightScanColor = '#ffffff';

    // Footprint 疑似3D用の高さ走査状態。
    this._footprintHeightScanRaf = null;
    this._footprintHeightScanToken = 0;
    this._footprintHeightScanActive = false;

    // Footprint raw GeoJSON cache.
    // PMTiles は通常表示・クリック入口に使い、選択後の底面 footprint は
    // tile fragment ではなく丁単位 raw GeoJSON から取得する。
    this._rawFootprintIndex = null;
    this._rawFootprintIndexPromise = null;
    this._rawFootprintFeatureCache = new Map();
    this._rawFootprintMetadataCache = new Map();

    // Altitude / Height floating label.
    this._altitudeHeightMarker = null;
    this._altitudeHeightTimers = [];
    this._altitudeHeightLabelToken = 0;

    // 建物クリック後の小アクション UI（Height / LASER / SHADOW）。
    this._buildingActionMarker = null;
    this._buildingActionToken = 0;

    // 照明状態
    // LOD1 / Footprint 用 MapLibre light
    this._lod1SunAzimuth   = DEFAULT_LOD1_SUN_AZIMUTH;
    this._lod1SunElevation = DEFAULT_LOD1_SUN_ELEVATION;
    this._lod1SunIntensity = DEFAULT_LOD1_SUN_INTENSITY;

    // 既存コード互換用。MapLibre light はこの3値を参照する。
    this._sunAzimuth       = this._lod1SunAzimuth;
    this._sunElevation     = this._lod1SunElevation;
    this._sunIntensity     = this._lod1SunIntensity;

    // LOD2 / GLB 用 Three.js lighting
    this._lod2SunAzimuth   = DEFAULT_LOD2_SUN_AZIMUTH;
    this._lod2SunElevation = DEFAULT_LOD2_SUN_ELEVATION;
    this._lod2SunIntensity = DEFAULT_LOD2_SUN_INTENSITY;
    this._ambientIntensity = DEFAULT_LOD2_AMBIENT_INTENSITY;
    this._lod2FillColor = DEFAULT_LOD2_FILL_COLOR;
    this._lod2FillIntensity = DEFAULT_LOD2_FILL_INTENSITY;
    this._lod2RimColor = DEFAULT_LOD2_RIM_COLOR;
    this._lod2RimIntensity = DEFAULT_LOD2_RIM_INTENSITY;
    this._lod2ShadowSize = DEFAULT_LOD2_SHADOW_SIZE;

    this.footprintSourceLayer = 'bldg_footprint';

    this.footprintStyle = {
      // 2D footprint: PMTiles 平面表示用。疑似3Dとは分離する。
      fillColor:   FP_2D_FILL_COLOR,
      fillOpacity: 0.96,
      lineColor:   FP_LINE_COLOR,
      lineOpacity: 0.51,
      lineWidth:   FP_LINE_WIDTH,

      // 3D footprint: MapLibre fill-extrusion 用。
      // MapLibre は roof / wall の material 分離を持たないため、
      // wall 本体 layer + 薄い roof cap layer の2層で疑似的に分ける。
      extrusionRoofColor: FP_3D_ROOF_COLOR,
      extrusionWallColor: FP_3D_WALL_COLOR,
      extrusionOpacity: 0.96,
      extrusionAmbientColor: FP_3D_AMBIENT_COLOR,
      extrusionAmbientStrength: FP_3D_AMBIENT_STRENGTH,
      extrusionRoofSunStrength: FP_3D_ROOF_SUN_STRENGTH,
      extrusionWallSunStrength: FP_3D_WALL_SUN_STRENGTH,

      lod2RoofColor: DEFAULT_LOD2_ROOF_COLOR,
      lod2WallColor: DEFAULT_LOD2_WALL_COLOR,
      lod2RoofSunStrength: DEFAULT_LOD2_ROOF_SUN_STRENGTH,
      lod2WallSunStrength: DEFAULT_LOD2_WALL_SUN_STRENGTH,
      lod2Opacity: DEFAULT_LOD2_OPACITY,
      lod2AmbientColor: DEFAULT_LOD2_AMBIENT_COLOR,
      lod2AmbientStrength: DEFAULT_LOD2_AMBIENT_STRENGTH,
    };
  }

  // ── 初期化 ──────────────────────────────────────────────────

  async init(containerId) {
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

    const baseUrl = new URL(BASE_STYLE_URL, location.href).toString();

    const res = await fetch(BASE_STYLE_URL);
    if (!res.ok) {
      throw new Error(`style fetch failed: ${res.status}`);
    }

    const rawStyle = await res.json();
    const tuned    = preProcessStyle(rawStyle, baseUrl, this._groundColor);

    this.map = new maplibregl.Map({
      container: containerId,
      style: tuned,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      pitch: INITIAL_PITCH,
      bearing: 0,
      maxPitch: MAX_PITCH,
      antialias: true,
    });

    window.__map = this.map;
    this.cameraController = new CameraController(this.map);

    await new Promise((resolve) => this.map.once('style.load', resolve));

    this.map.getCanvas().style.background = this._groundColor;

    if (!this.map.getLayer(BG_LAYER_ID)) {
      const firstLayerId = this.map.getStyle().layers[0]?.id;

      this.map.addLayer(
        {
          id: BG_LAYER_ID,
          type: 'background',
          paint: {
            'background-color': this._groundColor,
          },
        },
        firstLayerId,
      );
    }

    this.styleTuner = new StyleTuner(this.map);
    this.styleTuner.apply();

    this._applyMapLibreLight();
    this._insertHillshadeUnderlay();

    const areas = await this._loadAreas();

    if (!areas.length) {
      console.error('[MapApp] areas.json is empty');
      return;
    }

    await this._selectArea(areas[0]);

    this.map.on('zoom', () => this._onZoom());
    this._onZoom();

    this._emit('ready', {
      map: this.map,
      area: state.selectedArea,
    });
  }

  // ── 陰影起伏図 ───────────────────────────────────────────────

  _insertHillshadeUnderlay() {
    const map = this.map;

    if (!map.getSource(HILLSHADE_SOURCE_ID)) {
      map.addSource(HILLSHADE_SOURCE_ID, {
        type: 'raster',
        tiles: [HILLSHADE_TILE_URL],
        tileSize: 256,
        maxzoom: 16,
        attribution: '地理院タイル 陰影起伏図',
      });
    }

    if (map.getLayer(HILLSHADE_LAYER_ID)) {
      map.removeLayer(HILLSHADE_LAYER_ID);
    }

    const firstVectorLayer = (map.getStyle()?.layers ?? []).find(
      (l) => l.type !== 'background' && l.type !== 'raster',
    );

    map.addLayer(
      {
        id: HILLSHADE_LAYER_ID,
        type: 'raster',
        source: HILLSHADE_SOURCE_ID,
        paint: {
          'raster-opacity': HILLSHADE_OPACITY,
          'raster-resampling': 'linear',
        },
      },
      firstVectorLayer?.id,
    );
  }

  // ── エリア選択 ───────────────────────────────────────────────

  async _loadAreas() {
    try {
      const res = await fetch(AREAS_JSON_URL);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return await res.json();
    } catch (err) {
      console.error('[MapApp] Failed to load areas.json:', err);
      return [];
    }
  }

  async _selectArea(area) {
    state.selectedArea = area;
    state.areaBasePath = `bldg_luse/${area.path}`;

    const areaBase = state.areaBasePath;

    this.map.jumpTo({
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      pitch: INITIAL_PITCH,
      bearing: 0,
    });

    await this._addFootprintLayers(areaBase);
    this._setupFootprintScanLayer();

    this.vegetationManager = new VegetationManager(this.map);
    await this.vegetationManager.load(area, areaBase);

    await this._setupTranLayer(area, areaBase);
    await this._setupLod2Layer(area, areaBase);

    this._attachClickHandlers();

    this._emit('areaLoaded', { area });
  }

  // ── Footprint PMTiles ────────────────────────────────────────

  async _addFootprintLayers(areaBase) {
    const footprintRelUrl = `${areaBase}/bldg/footprint/bldg_footprint.pmtiles`;
    const footprintAbsUrl = new URL(footprintRelUrl, window.location.href).href;

    this.footprintSourceLayer = await this._detectFootprintSourceLayer(
      areaBase,
      footprintAbsUrl,
    );

    this._removeSelectedBuildingLayers();

    if (this.map.getSource(FOOTPRINT_SOURCE)) {
      [
        FOOTPRINT_HIT,
        FOOTPRINT_EXTRUSION,
        FOOTPRINT_LINE,
        FOOTPRINT_FILL,
      ].forEach((id) => {
        if (this.map.getLayer(id)) {
          this.map.removeLayer(id);
        }
      });

      this.map.removeSource(FOOTPRINT_SOURCE);
    }

    this.map.addSource(FOOTPRINT_SOURCE, {
      type: 'vector',
      url: `pmtiles://${footprintAbsUrl}`,
    });

    this.map.addLayer({
      id: FOOTPRINT_FILL,
      type: 'fill',
      source: FOOTPRINT_SOURCE,
      'source-layer': this.footprintSourceLayer,
      minzoom: 14,
      layout: {
        visibility: state.footprintEnabled ? 'visible' : 'none',
      },
      paint: {
        'fill-color': this._footprintFillColorExpr(),
        'fill-opacity': this._footprintFillOpacityExpr(),
      },
    });

    this.map.addLayer({
      id: FOOTPRINT_LINE,
      type: 'line',
      source: FOOTPRINT_SOURCE,
      'source-layer': this.footprintSourceLayer,
      minzoom: 14,
      layout: {
        visibility: state.footprintEnabled ? 'visible' : 'none',
      },
      paint: {
        'line-color': this._footprintLineColorExpr(),
        'line-width': this._footprintLineWidthExpr(),
        'line-opacity': this._footprintLineOpacityExpr(),
      },
    });

    this.map.addLayer({
      id: FOOTPRINT_EXTRUSION,
      type: 'fill-extrusion',
      source: FOOTPRINT_SOURCE,
      'source-layer': this.footprintSourceLayer,
      minzoom: 15,
      layout: {
        visibility: state.footprintEnabled ? 'visible' : 'none',
      },
      paint: {
        'fill-extrusion-color': this._footprintExtrusionWallColorExpr(),
        'fill-extrusion-height': this._footprintExtrusionHeightExpr(),
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': this.footprintStyle.extrusionOpacity,
      },
    });

    // Footprint 疑似3D roof cap layer。
    // MapLibre fill-extrusion は roof / wall 色を分離できないため、
    // 建物上部に薄い extrusion を重ねて roof 色として見せる。
    this.map.addLayer({
      id: FOOTPRINT_EXTRUSION_ROOF,
      type: 'fill-extrusion',
      source: FOOTPRINT_SOURCE,
      'source-layer': this.footprintSourceLayer,
      minzoom: 15,
      layout: {
        visibility: state.footprintEnabled ? 'visible' : 'none',
      },
      paint: {
        'fill-extrusion-color': this._footprintExtrusionRoofColorExpr(),
        'fill-extrusion-height': this._footprintExtrusionHeightExpr(),
        'fill-extrusion-base': this._footprintExtrusionRoofBaseExpr(),
        'fill-extrusion-opacity': this.footprintStyle.extrusionOpacity,
      },
    });

    // クリック判定専用 layer。
    // 表示用 footprint が OFF でも、LOD2 が ON なら fallback 選択に使える。
    this.map.addLayer({
      id: FOOTPRINT_HIT,
      type: 'fill',
      source: FOOTPRINT_SOURCE,
      'source-layer': this.footprintSourceLayer,
      minzoom: 14,
      layout: {
        visibility: 'visible',
      },
      paint: {
        'fill-color': '#000000',
        'fill-opacity': 0.01,
      },
    });

    this._addSelectedBuildingLayers();
  }

  _addSelectedBuildingLayers() {
    this._removeSelectedBuildingLayers();

    this.map.addSource(SELECTED_BUILDING_SOURCE, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });

    this.map.addLayer({
      id: SELECTED_BUILDING_FILL,
      type: 'fill',
      source: SELECTED_BUILDING_SOURCE,
      minzoom: 14,
      layout: {
        visibility: 'none',
      },
      paint: {
        'fill-color': '#00ffff',
        'fill-opacity': 0.42,
      },
    });

    this.map.addLayer({
      id: SELECTED_BUILDING_LINE,
      type: 'line',
      source: SELECTED_BUILDING_SOURCE,
      minzoom: 14,
      layout: {
        visibility: 'none',
      },
      paint: {
        'line-color': '#00d9e6',
        'line-width': 2.2,
        'line-opacity': 1.0,
      },
    });

    // Footprint 3D 選択時に、ターコイズ半透明 extrusion の下に
    // 底面 footprint を白線として見せる専用 layer。
    // SELECTED_BUILDING_EXTRUSION より前に置くことで、壁越しに底面線が見える。
    this.map.addLayer({
      id: SELECTED_BUILDING_BOTTOM_LINE,
      type: 'line',
      source: SELECTED_BUILDING_SOURCE,
      minzoom: 15,
      layout: {
        visibility: 'none',
      },
      paint: {
        'line-color': '#ffffff',
        'line-width': 1.25,
        'line-opacity': 0.95,
      },
    });

    // Raw footprint geometry を使った高さ方向 scan layer。
    // v42: depth-aware top -> bottom の下降 slice。
    // SELECTED_BUILDING_EXTRUSION より前に置き、ターコイズ建物越しに白い slice を見せる。
    this.map.addLayer({
      id: SELECTED_BUILDING_HEIGHT_SCAN,
      type: 'fill-extrusion',
      source: SELECTED_BUILDING_SOURCE,
      minzoom: 15,
      layout: {
        visibility: 'none',
      },
      paint: {
        'fill-extrusion-color': '#ffffff',
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.94,
        'fill-extrusion-vertical-gradient': false,
        'fill-extrusion-height-transition': { duration: 0, delay: 0 },
        'fill-extrusion-base-transition': { duration: 0, delay: 0 },
      },
    });

    this.map.addLayer({
      id: SELECTED_BUILDING_EXTRUSION,
      type: 'fill-extrusion',
      source: SELECTED_BUILDING_SOURCE,
      minzoom: 15,
      layout: {
        visibility: 'none',
      },
      paint: {
        'fill-extrusion-color': '#00f0ee',
        'fill-extrusion-height': [
          'coalesce',
          ['get', 'height'],
          ['get', 'measuredHeight'],
          ['get', 'h'],
          10,
        ],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.48,
      },
    });


    this._ensureSelectedShadowLayer();
  }



  _ensureSelectedShadowLayer() {
    if (!this.map) return null;

    if (!this.selectedShadowLayer) {
      this.selectedShadowLayer = new SelectedShadowLayer(this.map, {
        // Step 1 layer order: put shadow above the GLB road custom layer
        // by moving it just below the LOD2 custom layer when available.
        beforeId: this.lod2Layer?.id || 'petiteau-lod2-hollow',
        opacity: 0.26,
      });
    }

    this.selectedShadowLayer.ensure();
    return this.selectedShadowLayer;
  }

  _placeSelectedShadowStackAboveRoad() {
    if (!this.map) return;

    const beforeId = this.lod2Layer?.id || 'petiteau-lod2-hollow';
    if (!this.map.getLayer(beforeId)) return;

    try {
      if (this.selectedShadowLayer?.setBeforeId) {
        this.selectedShadowLayer.setBeforeId(beforeId);
      }

      if (this.selectedShadowLayer?.layerId && this.map.getLayer(this.selectedShadowLayer.layerId)) {
        this.map.moveLayer(this.selectedShadowLayer.layerId, beforeId);
      }

      // Keep the selected building above the projected shadow and below LOD2.
      if (this.map.getLayer(SELECTED_BUILDING_EXTRUSION)) {
        this.map.moveLayer(SELECTED_BUILDING_EXTRUSION, beforeId);
      }
    } catch (err) {
      console.warn('[MapApp] selected shadow layer order update failed:', err);
    }
  }

  _applySelectedBuildingSelectionStyle() {
    if (!this.map?.getLayer(SELECTED_BUILDING_EXTRUSION)) return;

    try {
      this.map.setPaintProperty(SELECTED_BUILDING_EXTRUSION, 'fill-extrusion-color', '#00f0ee');
      this.map.setPaintProperty(SELECTED_BUILDING_EXTRUSION, 'fill-extrusion-opacity', 0.48);
    } catch (_) {}
  }

  _applySelectedBuildingShadowStyle() {
    if (!this.map?.getLayer(SELECTED_BUILDING_EXTRUSION)) return;

    try {
      // SHADOW is an analysis mode: remove the turquoise selection tint and
      // show the selected footprint as the normal opaque building volume.
      this.map.setPaintProperty(
        SELECTED_BUILDING_EXTRUSION,
        'fill-extrusion-color',
        this._footprintExtrusionWallColorExpr(),
      );
      this.map.setPaintProperty(SELECTED_BUILDING_EXTRUSION, 'fill-extrusion-opacity', 1.0);
      this.map.setLayoutProperty(SELECTED_BUILDING_EXTRUSION, 'visibility', 'visible');
    } catch (_) {}
  }

  _setupFootprintScanLayer() {
    // Footprint scan is now handled by MapLibre/raw-footprint bottom-line logic.
    // Keep this method as a no-op for backward compatibility so the old
    // Three.js-dependent FootprintScanLayer is not initialized.
    this.footprintScanLayer = null;
    this.selectedShadowLayer = null;
  }

  _removeSelectedBuildingLayers() {
    this.selectedShadowLayer?.remove?.();
    this.selectedShadowLayer = null;

    [
      SELECTED_BUILDING_HEIGHT_SCAN,
      SELECTED_BUILDING_EXTRUSION,
      SELECTED_BUILDING_BOTTOM_LINE,
      SELECTED_BUILDING_LINE,
      SELECTED_BUILDING_FILL,
    ].forEach((id) => {
      if (this.map?.getLayer(id)) {
        this.map.removeLayer(id);
      }
    });

    if (this.map?.getSource(SELECTED_BUILDING_SOURCE)) {
      this.map.removeSource(SELECTED_BUILDING_SOURCE);
    }
  }

  async _detectFootprintSourceLayer(areaBase, footprintAbsUrl) {
    const fromPmtiles = await this._sourceLayerFromPmtilesMetadata(footprintAbsUrl);
    if (fromPmtiles) return fromPmtiles;

    const fromSnippet = await this._sourceLayerFromSnippet(areaBase);
    if (fromSnippet) return fromSnippet;

    return 'bldg_footprint';
  }

  async _sourceLayerFromPmtilesMetadata(footprintAbsUrl) {
    try {
      if (!window.pmtiles?.PMTiles) return null;

      const archive  = new window.pmtiles.PMTiles(footprintAbsUrl);
      const metadata = await archive.getMetadata();
      const vl       = metadata?.vector_layers;

      if (Array.isArray(vl) && vl.length > 0 && vl[0]?.id) {
        return vl[0].id;
      }
    } catch (err) {
      console.warn('[MapApp] Could not read PMTiles metadata:', err);
    }

    return null;
  }

  async _sourceLayerFromSnippet(areaBase) {
    const candidates = [
      `${areaBase}/bldg/manifest/bldg_footprint_maplibre_snippet.json`,
      `${areaBase}/bldg/footprint/bldg_footprint_maplibre_snippet.json`,
    ];

    for (const url of candidates) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;

        const json = await res.json();
        if (json?.source_layer) return json.source_layer;
      } catch (_) {}
    }

    return null;
  }

  // ── GLB レイヤーセットアップ ──────────────────────────────────

  async _setupTranLayer(area, areaBase) {
    this.tranLayer = new RoadGlbLayer({
      area,
      areaBase,
    });

    this.map.addLayer(this.tranLayer);

    await this.tranLayer.init();

    this.tranLayer.setVisible(state.tranGlbEnabled ?? true);

    if (this._glbDLon !== 0 || this._glbDLat !== 0) {
      this.tranLayer.setOriginOffset(this._glbDLon, this._glbDLat);
    }
  }

  async _setupLod2Layer(area, areaBase) {
    const sharedOrigin = area.glbOrigin ?? IKEDA_SHARED_ORIGIN;

    this.lod2Layer = new GlbCombinedLayer({
      areaBase,
      sharedOrigin,
    });

    this.map.addLayer(this.lod2Layer);

    // GLBを追加した後にStyleTunerを再適用し、
    // 駅名・町名ラベルを建物より上のレイヤーに引き上げる
    if (this.styleTuner) {
      this.styleTuner.apply();
    }

    if (this.lod2Layer?.setBuildingColor) {
      this.lod2Layer.setBuildingColor(this.footprintStyle.lod2RoofColor);
    }

    if (this.lod2Layer?.setWallColor) {
      this.lod2Layer.setWallColor(this.footprintStyle.lod2WallColor);
    }

    this.lod2Layer.setLighting({
      azimuth: this._lod2SunAzimuth,
      elevation: this._lod2SunElevation,
      sunIntensity: this._lod2SunIntensity,
      ambientIntensity: this._ambientIntensity,
      fillColor: this._lod2FillColor,
      fillIntensity: this._lod2FillIntensity,
      rimFillColor: this._lod2RimColor,
      rimFillIntensity: this._lod2RimIntensity,
    });

    if (this.lod2Layer?.setShadowOptions) {
      this.lod2Layer.setShadowOptions({
        enabled: this._lod2ShadowSize > 0,
        mapSize: this._lod2ShadowSize,
        minZoom: DEFAULT_LOD2_SHADOW_MIN_ZOOM,
      });
    }

    if (this.lod2Layer?.setRenderTuning) {
      this.lod2Layer.setRenderTuning({
        roofSunStrength: this.footprintStyle.lod2RoofSunStrength,
        wallSunStrength: this.footprintStyle.lod2WallSunStrength,
        opacity: this.footprintStyle.lod2Opacity,
        ambientColor: this.footprintStyle.lod2AmbientColor,
        ambientStrength: this.footprintStyle.lod2AmbientStrength,
      });
    }

    const indexUrl = `${areaBase}/bldg/lod2_hollow_chome_index.json`;
    await this.lod2Layer.loadIndex(indexUrl);

    if (this._glbDLon !== 0 || this._glbDLat !== 0) {
      this.lod2Layer.setOriginOffset(this._glbDLon, this._glbDLat);
    }

    this._onZoom();
  }

  // ── MapLibre ライト（LOD1 fill-extrusion 用） ─────────────────

  _applyMapLibreLight() {
    try {
      const polar = 90 - this._sunElevation;
      const lightColor = this.footprintStyle?.extrusionAmbientColor || 'white';

      this.map.setLight({
        anchor: 'map',
        color: lightColor,
        intensity: this._sunIntensity,
        position: [1.5, this._sunAzimuth, polar],
      });
    } catch (err) {
      console.warn('[MapApp] setLight failed:', err);
    }
  }

  // ── ズーム連動 ───────────────────────────────────────────────

  _onZoom() {
    const zoom = this.map.getZoom();

    // v3: 表示は常に通常状態を維持する。
    // activeBuildingLayerMode は「選択可否」だけに使い、
    // footprint / LOD2 の表示切替には使わない。
    const footprintVisible = state.footprintEnabled;
    const hitEnabled = state.footprintEnabled;

    const show2D = footprintVisible && zoom >= 14 && zoom < ZOOM_3D_THRESHOLD;
    const show3D = footprintVisible && zoom >= ZOOM_3D_THRESHOLD;
    const showHit = hitEnabled && zoom >= 14;

    this._emit('zoomChange', { zoom });

    [FOOTPRINT_FILL, FOOTPRINT_LINE].forEach((id) => {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, 'visibility', show2D ? 'visible' : 'none');
      }
    });

    if (this.map.getLayer(FOOTPRINT_HIT)) {
      this.map.setLayoutProperty(
        FOOTPRINT_HIT,
        'visibility',
        showHit ? 'visible' : 'none',
      );
    }

    [FOOTPRINT_EXTRUSION, FOOTPRINT_EXTRUSION_ROOF].forEach((id) => {
      if (!this.map.getLayer(id)) return;

      this.map.setLayoutProperty(
        id,
        'visibility',
        show3D ? 'visible' : 'none',
      );

      if (show3D) {
        const lod2Active = zoom >= ZOOM_LOD2_THRESHOLD && state.lod2Enabled;

        // 初期表示と同じ見た目を維持するため、
        // LOD2 がある建物は footprint 疑似3Dから除外したまま。
        this.map.setFilter(
          id,
          this._buildFootprintExtrusionFilter(lod2Active),
        );
      }
    });

    const hasSelectedFeature =
      Boolean(this.map.getSource(SELECTED_BUILDING_SOURCE)) &&
      Boolean(state.selectedBuildingGeometry);

    if (this.map.getLayer(SELECTED_BUILDING_FILL)) {
      this.map.setLayoutProperty(
        SELECTED_BUILDING_FILL,
        'visibility',
        hasSelectedFeature && show2D ? 'visible' : 'none',
      );
    }

    if (this.map.getLayer(SELECTED_BUILDING_LINE)) {
      this.map.setLayoutProperty(
        SELECTED_BUILDING_LINE,
        'visibility',
        hasSelectedFeature && show2D ? 'visible' : 'none',
      );
    }

    if (this.map.getLayer(SELECTED_BUILDING_BOTTOM_LINE)) {
      // v42: The bottom footprint line is a 2D line layer and does not
      // participate in fill-extrusion depth. Keep it hidden in 3D mode so it
      // does not draw over foreground buildings. The visible scan is handled
      // only by the depth-aware SELECTED_BUILDING_HEIGHT_SCAN extrusion band.
      this.map.setLayoutProperty(
        SELECTED_BUILDING_BOTTOM_LINE,
        'visibility',
        'none',
      );
    }

    if (this.map.getLayer(SELECTED_BUILDING_EXTRUSION)) {
      this.map.setLayoutProperty(
        SELECTED_BUILDING_EXTRUSION,
        'visibility',
        hasSelectedFeature && zoom >= ZOOM_3D_THRESHOLD ? 'visible' : 'none',
      );
    }

    if (this.lod2Layer) {
      const lod2Active = zoom >= ZOOM_LOD2_THRESHOLD && state.lod2Enabled;

      if (this._lod2Active !== lod2Active) {
        this._lod2Active = lod2Active;
        this.lod2Layer.setVisible(lod2Active);
      }
    }
  }

  // ── 公開 API ─────────────────────────────────────────────────

  setShadowVisible(visible) {
    if (!this.map || !this.map.getLayer(HILLSHADE_LAYER_ID)) return;

    this.map.setPaintProperty(
      HILLSHADE_LAYER_ID,
      'raster-opacity',
      visible ? HILLSHADE_OPACITY : 0,
    );
  }

  setPitch(pitch) {
    if (!this.map) return;

    this.map.easeTo({
      pitch: Math.max(0, Math.min(MAX_PITCH, Number(pitch))),
      duration: 180,
    });
  }

  setLod2HeightScanBandWidth(widthM) {
    this._heightScanBandWidthM = Math.max(0.1, Math.min(0.5, Number(widthM) || 0.1));

    if (this.lod2Layer?.setHeightScanStyle) {
      this.lod2Layer.setHeightScanStyle({
        bandWidthM: this._heightScanBandWidthM,
        scanColor: this._heightScanColor,
      });
    }
  }

  setLod2HeightScanColor(color) {
    if (!color) return;

    this._heightScanColor = color;

    if (this.lod2Layer?.setHeightScanStyle) {
      this.lod2Layer.setHeightScanStyle({
        bandWidthM: this._heightScanBandWidthM,
        scanColor: this._heightScanColor,
      });
    }

    if (this.map?.getLayer(SELECTED_BUILDING_HEIGHT_SCAN)) {
      this.map.setPaintProperty(
        SELECTED_BUILDING_HEIGHT_SCAN,
        'fill-extrusion-color',
        this._heightScanColor,
      );
    }
  }

  setFootprintVisible(visible) {
    state.footprintEnabled = visible;
    if (!visible && state.activeBuildingLayerMode === 'footprint') {
      this._clearSelection();
    }
    this._onZoom();
  }

  setLod2Visible(visible) {
    state.lod2Enabled = visible;
    if (!visible && state.activeBuildingLayerMode === 'lod2') {
      this._clearSelection();
    }

    if (this.lod2Layer) {
      this.lod2Layer.setVisible(
        visible && this.map.getZoom() >= ZOOM_LOD2_THRESHOLD,
      );
    }

    this._onZoom();
  }

  setTranGlbVisible(visible) {
    state.tranGlbEnabled = visible;

    if (this.tranLayer) {
      this.tranLayer.setVisible(visible);
    }
  }

  setTranVisible(visible) {
    this.setTranGlbVisible(visible);
  }

  setTranGlbColor(color) {
    if (this.tranLayer) {
      this.tranLayer.setColor(color);
    }
  }

  setTranGlbOpacity(opacity) {
    if (this.tranLayer) {
      this.tranLayer.setOpacity(opacity);
    }
  }

  setGsiRoadVisible(visible) {
    if (this.styleTuner) {
      this.styleTuner.setRoadVisible(visible);
    }
  }

  setGsiRoadColor(color) {
    if (this.styleTuner) {
      this.styleTuner.setRoadColor(color);
    }
  }

  setGsiRoadOpacity(opacity) {
    if (this.styleTuner) {
      this.styleTuner.setRoadOpacity(opacity);
    }
  }

  setGlbOriginOffset(dLon, dLat) {
    this._glbDLon = Number(dLon) || 0;
    this._glbDLat = Number(dLat) || 0;

    if (this.tranLayer) {
      this.tranLayer.setOriginOffset(this._glbDLon, this._glbDLat);
    }

    if (this.lod2Layer) {
      this.lod2Layer.setOriginOffset(this._glbDLon, this._glbDLat);
    }
  }

  setLuseGreenVisible(visible) {
    if (this.vegetationManager) {
      this.vegetationManager.setGreenVisible(visible);
    }
  }

  setLuseSchoolyardVisible(visible) {
    if (this.vegetationManager) {
      this.vegetationManager.setSchoolyardVisible(visible);
    }
  }

  setLuseOpacity(opacity) {
    if (this.vegetationManager) {
      this.vegetationManager.setOpacity(opacity);
    }
  }

  setLuseGreenColor(color) {
    if (this.vegetationManager) {
      this.vegetationManager.setGreenColor(color);
    }
  }

  setLuseSchoolColor(color) {
    if (this.vegetationManager) {
      this.vegetationManager.setSchoolColor(color);
    }
  }

  // ── 照明 API（LOD1 / LOD2 分離） ───────────────────────────────

  setLod1SunAzimuth(deg) {
    this._lod1SunAzimuth = Number(deg);
    this._sunAzimuth = this._lod1SunAzimuth;
    this._applyMapLibreLight();
  }

  setLod1SunElevation(deg) {
    this._lod1SunElevation = Number(deg);
    this._sunElevation = this._lod1SunElevation;
    this._applyMapLibreLight();
  }

  setLod1SunIntensity(val) {
    this._lod1SunIntensity = Number(val);
    this._sunIntensity = this._lod1SunIntensity;
    this._applyMapLibreLight();
  }

  setLod2SunAzimuth(deg) {
    this._lod2SunAzimuth = Number(deg);
    if (this.lod2Layer?.setLighting) {
      this.lod2Layer.setLighting({ azimuth: this._lod2SunAzimuth });
    }
  }

  setLod2SunElevation(deg) {
    this._lod2SunElevation = Number(deg);
    if (this.lod2Layer?.setLighting) {
      this.lod2Layer.setLighting({ elevation: this._lod2SunElevation });
    }
  }

  setLod2SunIntensity(val) {
    this._lod2SunIntensity = Number(val);
    if (this.lod2Layer?.setLighting) {
      this.lod2Layer.setLighting({ sunIntensity: this._lod2SunIntensity });
    }
  }

  setLod2LightingAmbientIntensity(val) {
    this._ambientIntensity = Number(val);

    if (this.lod2Layer?.setLighting) {
      this.lod2Layer.setLighting({
        ambientIntensity: this._ambientIntensity,
      });
    }
  }

  // 後方互換: 旧UIや外部呼び出しでは LOD1/LOD2 を同時に動かす。
  setSunAzimuth(deg) {
    this.setLod1SunAzimuth(deg);
    this.setLod2SunAzimuth(deg);
  }

  setSunElevation(deg) {
    this.setLod1SunElevation(deg);
    this.setLod2SunElevation(deg);
  }

  setSunIntensity(val) {
    this.setLod1SunIntensity(val);
    this.setLod2SunIntensity(val);
  }

  setAmbientIntensity(val) {
    this.setLod2LightingAmbientIntensity(val);
  }

  setLod2FillColor(color) {
    this._lod2FillColor = color || DEFAULT_LOD2_FILL_COLOR;

    if (this.lod2Layer?.setLighting) {
      this.lod2Layer.setLighting({ fillColor: this._lod2FillColor });
    }
  }

  setLod2FillIntensity(val) {
    this._lod2FillIntensity = Number(val);

    if (this.lod2Layer?.setLighting) {
      this.lod2Layer.setLighting({ fillIntensity: this._lod2FillIntensity });
    }
  }

  setLod2RimColor(color) {
    this._lod2RimColor = color || DEFAULT_LOD2_RIM_COLOR;

    if (this.lod2Layer?.setLighting) {
      this.lod2Layer.setLighting({ rimFillColor: this._lod2RimColor });
    }
  }

  setLod2RimIntensity(val) {
    this._lod2RimIntensity = Number(val);

    if (this.lod2Layer?.setLighting) {
      this.lod2Layer.setLighting({ rimFillIntensity: this._lod2RimIntensity });
    }
  }

  setLod2ShadowQuality(size) {
    const s = Number(size) || 0;
    this._lod2ShadowSize = s;

    if (this.lod2Layer?.setShadowOptions) {
      this.lod2Layer.setShadowOptions({
        enabled: s > 0,
        mapSize: s,
        minZoom: DEFAULT_LOD2_SHADOW_MIN_ZOOM,
      });
    }
  }

  setLod2LightingAmbientColor(color) {
    this.setLod2AmbientColor(color);
  }

  // ── 地面色 ──────────────────────────────────────────────────

  setGroundColor(color) {
    if (!color) return;

    this._groundColor = color;

    if (this.map) {
      this.map.getCanvas().style.background = color;
    }

    if (this.map?.getLayer(BG_LAYER_ID)) {
      try {
        this.map.setPaintProperty(BG_LAYER_ID, 'background-color', color);
      } catch (_) {}
    }

    const style = this.map?.getStyle();

    if (style) {
      for (const layer of style.layers || []) {
        if (layer.type !== 'fill') continue;

        const t = _layerText(layer);

        if (!_looksLikeWater(t) && !_looksLikeVegetation(t) && !_looksLikeBuilding(t)) {
          try {
            this.map.setPaintProperty(layer.id, 'fill-color', color);
            this.map.setPaintProperty(layer.id, 'fill-outline-color', color);
          } catch (_) {}
        }
      }
    }
  }

  // ── Footprint / LOD2 色 API ─────────────────────────────────

  setFootprintFillColor(color) {
    // 2D footprint fill only. 3D extrusion color is independent.
    this.footprintStyle.fillColor = color;
    this._applyFootprintStyle();
  }

  setFootprintFillOpacity(opacity) {
    // 2D footprint opacity only. 3D extrusion opacity is independent.
    this.footprintStyle.fillOpacity = Number(opacity);
    this._applyFootprintStyle();
  }

  setFootprint3dFillColor(color) {
    // Backward compatible alias. Treat old single 3D color as roof color.
    this.setFootprint3dRoofColor(color);
  }

  setFootprint3dRoofColor(color) {
    if (!color) return;
    this.footprintStyle.extrusionRoofColor = color;
    this._applyFootprintStyle();
  }

  setFootprint3dWallColor(color) {
    if (!color) return;
    this.footprintStyle.extrusionWallColor = color;
    this._applyFootprintStyle();
  }

  setFootprint3dRoofSunStrength(strength) {
    this.footprintStyle.extrusionRoofSunStrength = Number(strength);
    this._applyFootprintStyle();
  }

  setFootprint3dWallSunStrength(strength) {
    this.footprintStyle.extrusionWallSunStrength = Number(strength);
    this._applyFootprintStyle();
  }

  setFootprint3dOpacity(opacity) {
    this.footprintStyle.extrusionOpacity = Number(opacity);
    this._applyFootprintStyle();
  }

  setFootprint3dAmbientColor(color) {
    if (!color) return;
    this.footprintStyle.extrusionAmbientColor = color;
    this._applyMapLibreLight();
    this._applyFootprintStyle();
  }

  setFootprint3dAmbientStrength(strength) {
    this.footprintStyle.extrusionAmbientStrength = Number(strength);
    this._applyFootprintStyle();
  }

  setFootprintLineColor(color) {
    this.footprintStyle.lineColor = color;
    this._applyFootprintStyle();
  }

  setFootprintLineOpacity(opacity) {
    this.footprintStyle.lineOpacity = Number(opacity);
    this._applyFootprintStyle();
  }

  setFootprintLineWidth(width) {
    this.footprintStyle.lineWidth = Number(width);
    this._applyFootprintStyle();
  }

  setLod2RoofColor(color) {
    if (!color) return;

    this.footprintStyle.lod2RoofColor = color;

    if (this.lod2Layer?.setBuildingColor) {
      this.lod2Layer.setBuildingColor(color);
    }
  }

  setLod2WallColor(color) {
    if (!color) return;

    this.footprintStyle.lod2WallColor = color;

    if (this.lod2Layer?.setWallColor) {
      this.lod2Layer.setWallColor(color);
    }
  }

  setLod2RoofSunStrength(strength) {
    this.footprintStyle.lod2RoofSunStrength = Number(strength);
    if (this.lod2Layer?.setRenderTuning) {
      this.lod2Layer.setRenderTuning({ roofSunStrength: this.footprintStyle.lod2RoofSunStrength });
    }
  }

  setLod2WallSunStrength(strength) {
    this.footprintStyle.lod2WallSunStrength = Number(strength);
    if (this.lod2Layer?.setRenderTuning) {
      this.lod2Layer.setRenderTuning({ wallSunStrength: this.footprintStyle.lod2WallSunStrength });
    }
  }

  setLod2Opacity(opacity) {
    this.footprintStyle.lod2Opacity = Number(opacity);
    if (this.lod2Layer?.setRenderTuning) {
      this.lod2Layer.setRenderTuning({ opacity: this.footprintStyle.lod2Opacity });
    }
  }

  setLod2AmbientColor(color) {
    if (!color) return;
    this.footprintStyle.lod2AmbientColor = color;
    if (this.lod2Layer?.setRenderTuning) {
      this.lod2Layer.setRenderTuning({ ambientColor: this.footprintStyle.lod2AmbientColor });
    }
  }

  setLod2AmbientStrength(strength) {
    this.footprintStyle.lod2AmbientStrength = Number(strength);
    if (this.lod2Layer?.setRenderTuning) {
      this.lod2Layer.setRenderTuning({ ambientStrength: this.footprintStyle.lod2AmbientStrength });
    }
  }


  _footprintFillColorExpr() {
    return this.footprintStyle.fillColor;
  }

  _footprintFillOpacityExpr() {
    return this.footprintStyle.fillOpacity;
  }

  _footprintExtrusionHeightExpr() {
    return [
      'coalesce',
      ['get', 'height'],
      ['get', 'measuredHeight'],
      ['get', 'h'],
      10,
    ];
  }

  _footprintExtrusionRoofBaseExpr() {
    const h = this._footprintExtrusionHeightExpr();
    return [
      'case',
      ['<', h, FP_3D_ROOF_CAP_THICKNESS_M],
      0,
      ['-', h, FP_3D_ROOF_CAP_THICKNESS_M],
    ];
  }

  _footprintExtrusionRoofColorExpr() {
    return this._applyFootprintSunBoost(
      this._applyFootprintAmbientBoost(
        this.footprintStyle.extrusionRoofColor,
        this.footprintStyle.extrusionAmbientColor,
        this.footprintStyle.extrusionAmbientStrength,
      ),
      this.footprintStyle.extrusionRoofSunStrength,
    );
  }

  _footprintExtrusionWallColorExpr() {
    return this._applyFootprintSunBoost(
      this._applyFootprintAmbientBoost(
        this.footprintStyle.extrusionWallColor,
        this.footprintStyle.extrusionAmbientColor,
        this.footprintStyle.extrusionAmbientStrength,
      ),
      this.footprintStyle.extrusionWallSunStrength,
    );
  }

  _footprintExtrusionColorExpr() {
    // Backward compatible alias.
    return this._footprintExtrusionRoofColorExpr();
  }

  _applyFootprintSunBoost(hex, strength) {
    const rgb = this._hexToRgb(hex) || this._hexToRgb('#ffffff');
    const s = Math.max(0, Math.min(2.0, Number(strength) || 0));

    const out = ['r', 'g', 'b'].map((k) => {
      let v = rgb[k];
      if (s <= 1.0) {
        // 0〜100%: 黒方向へ減光。
        v = v * s;
      } else {
        // 100〜200%: 白方向へ増光。
        v = v + (255 - v) * (s - 1.0);
      }
      return Math.round(Math.max(0, Math.min(255, v)));
    });

    return this._rgbToHex(out[0], out[1], out[2]);
  }

  _applyFootprintAmbientBoost(baseHex, ambientHex, strength) {
    const base = this._hexToRgb(baseHex) || this._hexToRgb('#ffffff');
    const amb  = this._hexToRgb(ambientHex) || this._hexToRgb('#dfe8ff');
    const s = Math.max(0, Math.min(1.8, Number(strength) || 0));

    // 0〜100%: ambient 色へ最大45%だけ寄せる。
    // 100%超: 白方向へ持ち上げて、青みを足しても沈まないようにする。
    const mix = Math.min(s, 1.0) * 0.45;
    const lift = Math.max(0, s - 1.0) * 0.25;

    const out = ['r', 'g', 'b'].map((k) => {
      let v = base[k] * (1 - mix) + amb[k] * mix;
      v = v + (255 - v) * lift;
      return Math.round(Math.max(0, Math.min(255, v)));
    });

    return this._rgbToHex(out[0], out[1], out[2]);
  }

  _hexToRgb(hex) {
    if (typeof hex !== 'string') return null;
    const h = hex.trim().replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  _rgbToHex(r, g, b) {
    return `#${[r, g, b]
      .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
      .join('')}`;
  }

  _footprintLineColorExpr() {
    return this.footprintStyle.lineColor;
  }

  _footprintLineOpacityExpr() {
    return this.footprintStyle.lineOpacity;
  }

  _footprintLineWidthExpr() {
    return this.footprintStyle.lineWidth;
  }

  _applyFootprintStyle() {
    if (!this.map) return;

    if (this.map.getLayer(FOOTPRINT_FILL)) {
      this.map.setPaintProperty(
        FOOTPRINT_FILL,
        'fill-color',
        this._footprintFillColorExpr(),
      );

      this.map.setPaintProperty(
        FOOTPRINT_FILL,
        'fill-opacity',
        this._footprintFillOpacityExpr(),
      );
    }

    if (this.map.getLayer(FOOTPRINT_LINE)) {
      this.map.setPaintProperty(
        FOOTPRINT_LINE,
        'line-color',
        this._footprintLineColorExpr(),
      );

      this.map.setPaintProperty(
        FOOTPRINT_LINE,
        'line-opacity',
        this._footprintLineOpacityExpr(),
      );

      this.map.setPaintProperty(
        FOOTPRINT_LINE,
        'line-width',
        this._footprintLineWidthExpr(),
      );
    }

    if (this.map.getLayer(FOOTPRINT_EXTRUSION)) {
      this.map.setPaintProperty(
        FOOTPRINT_EXTRUSION,
        'fill-extrusion-color',
        this._footprintExtrusionWallColorExpr(),
      );

      this.map.setPaintProperty(
        FOOTPRINT_EXTRUSION,
        'fill-extrusion-opacity',
        this.footprintStyle.extrusionOpacity,
      );
    }

    if (this.map.getLayer(FOOTPRINT_EXTRUSION_ROOF)) {
      this.map.setPaintProperty(
        FOOTPRINT_EXTRUSION_ROOF,
        'fill-extrusion-color',
        this._footprintExtrusionRoofColorExpr(),
      );

      this.map.setPaintProperty(
        FOOTPRINT_EXTRUSION_ROOF,
        'fill-extrusion-opacity',
        this.footprintStyle.extrusionOpacity,
      );
    }
  }

  // ── 選択 ────────────────────────────────────────────────────

  _attachClickHandlers() {
    if (this._clickHandlersAttached) return;
    this._clickHandlersAttached = true;

    this.map.on('click', (e) => {
      const lod2Pick = this._pickLod2Mesh(e.point);

      if (lod2Pick) {
        this._selectLod2Mesh(lod2Pick, e.lngLat);
        return;
      }

      const layerIds = this._clickableBuildingLayerIds();

      if (!layerIds.length) {
        this._clearSelection();
        return;
      }

      const features = this.map.queryRenderedFeatures(e.point, {
        layers: layerIds,
      });

      if (!features?.length) {
        this._clearSelection();
        return;
      }

      const feature = features[0];

      this._selectBuilding(feature, e.lngLat);
    });

    this.map.on('mousemove', (e) => {
      const lod2Pick = this._pickLod2Mesh(e.point);

      if (lod2Pick) {
        this.map.getCanvas().style.cursor = 'pointer';
        return;
      }

      const layerIds = this._clickableBuildingLayerIds();

      if (!layerIds.length) {
        this.map.getCanvas().style.cursor = '';
        return;
      }

      const features = this.map.queryRenderedFeatures(e.point, {
        layers: layerIds,
      });

      this.map.getCanvas().style.cursor = features?.length ? 'pointer' : '';
    });

    this.map.on('mouseleave', () => {
      this.map.getCanvas().style.cursor = '';
    });
  }

  _clickableBuildingLayerIds() {
    // 選択中の種類でロックしない。
    // 毎クリックで LOD2 hit が無ければ footprint hit を許可する。
    // これにより LOD2 ⇄ footprint 間を自由に移動できる。
    return [
      FOOTPRINT_HIT,
      FOOTPRINT_EXTRUSION,
      FOOTPRINT_FILL,
    ].filter((id) => this.map.getLayer(id));
  }

  _pickLod2Mesh(point) {
    if (!this.lod2Layer?.raycastPick) return null;
    if (!state.lod2Enabled) return null;
    // 選択中の種類でロックしない。
    // 毎クリックで LOD2 側も常に再判定する。
    if (this.map.getZoom() < ZOOM_LOD2_THRESHOLD) return null;

    return this.lod2Layer.raycastPick(point);
  }

  _selectLod2Mesh(pick, lngLat) {
    if (!pick?.mesh) return;

    const center = this.map.getCenter();

    if (!state.previousCameraState) {
      state.previousCameraState = {
        center: [center.lng, center.lat],
        zoom: this.map.getZoom(),
        bearing: this.map.getBearing(),
        pitch: this.map.getPitch(),
      };
    }

    // LOD2 建物が主選択。表示は変えず、以後は footprint 側の選択だけ止める。
    this._stopSelectedFootprintHeightScan();
    state.activeBuildingLayerMode = 'lod2';
    state.selectedBuildingId = pick.id ?? null;
    state.selectedFootprintMi = null;
    state.selectedBuildingGeometry = null;
    state.selectedBuildingProperties = pick.properties ?? {};

    this._clearSelectedBuildingFeature();

    // 丁全体 highlight は消す。
    if (this.lod2Layer?.clearHighlight) {
      this.lod2Layer.clearHighlight();
    }

    // LOD2 は mesh 命中を起点に、同じ building id の roof / wall / body をまとめて選択表示する。
    if (this.lod2Layer?.highlightBuildingFromPick) {
      this.lod2Layer.highlightBuildingFromPick(pick);
    } else if (this.lod2Layer?.highlightMesh) {
      this.lod2Layer.highlightMesh(pick.mesh);
    }

    state.selectedChomeId = pick.chomeCode ?? null;

    // LOD2 選択では bbox へ寄るが、ユーザーが回転した方位・pitch は維持する。
    // fitBounds() は bearing / pitch を戻しやすいため使わず、cameraForBounds() で
    // center / zoom だけを求め、easeTo() へ現在の bearing / pitch を明示的に渡す。
    const lod2Bbox = this.lod2Layer?.getBuildingLngLatBboxFromPick?.(pick);
    const cameraMoved = this.cameraController?.fitBuildingBboxKeepView(lod2Bbox) ?? false;

    // 建物クリックでは即レーザースキャンしない。
    // まず建物上の小 UI を出し、LASER / SHADOW をユーザーに選ばせる。
    this._showBuildingActionMenu({
      mode: 'lod2',
      properties: state.selectedBuildingProperties ?? {},
      lngLat,
      waitForMoveEnd: cameraMoved,
    });

    this._onZoom();

    this._emit('selectionChange', {
      type: 'lod2_mesh',
      lngLat,
      properties: pick.properties ?? {},
      lod2Pick: pick,
    });
  }

  _ensureBuildingActionStyle() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('petiteau-building-action-style')) return;

    const style = document.createElement('style');
    style.id = 'petiteau-building-action-style';
    style.textContent = `
      .petiteau-building-action {
        transform: translate(-50%, -14px);
        min-width: 154px;
        color: #f4ffff;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1;
        pointer-events: auto;
        user-select: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      }
      .petiteau-building-action-info {
        width: 100%;
        box-sizing: border-box;
        padding: 7px 10px 8px;
        border: 1px solid rgba(0, 240, 238, 0.50);
        border-radius: 12px;
        background: rgba(7, 13, 24, 0.76);
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.34), 0 0 18px rgba(0, 240, 238, 0.14);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .petiteau-building-action-height {
        margin: 0 0 5px;
        color: #f4ffff;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.03em;
        text-align: center;
        white-space: nowrap;
        text-shadow: 0 0 8px rgba(0, 240, 238, 0.52), 0 1px 3px rgba(0, 0, 0, 0.8);
      }
      .petiteau-building-action-metric {
        margin: 0 0 5px;
        color: rgba(244, 255, 255, 0.94);
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.025em;
        text-align: center;
        white-space: nowrap;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.78);
      }
      .petiteau-building-action-metric:last-child {
        margin-bottom: 0;
      }
      .petiteau-building-action-bulk-line {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      .petiteau-building-action-more {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: 999px;
        border: 1px solid rgba(0, 240, 238, 0.50);
        background: rgba(0, 240, 238, 0.12);
        color: #ffffff;
        font-size: 12px;
        font-weight: 800;
        line-height: 1;
      }
      .petiteau-building-action-row {
        display: flex;
        gap: 10px;
        justify-content: center;
        align-items: center;
      }
      .petiteau-building-action-btn {
        appearance: none;
        border: 1px solid rgba(0, 240, 238, 0.62);
        border-radius: 11px;
        padding: 8px 11px;
        min-width: 64px;
        background: rgba(0, 196, 220, 0.70);
        color: #f4ffff;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.06em;
        cursor: pointer;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.24), 0 0 14px rgba(0, 240, 238, 0.18);
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.64);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
      }
      .petiteau-building-action-btn:hover {
        background: rgba(0, 220, 238, 0.82);
        border-color: rgba(244, 255, 255, 0.72);
      }
      .petiteau-building-action-btn:active {
        transform: translateY(1px);
      }
      @media (max-width: 720px) {
        .petiteau-building-action {
          min-width: 146px;
          gap: 7px;
        }
        .petiteau-building-action-info {
          padding: 6px 8px 7px;
          border-radius: 11px;
        }
        .petiteau-building-action-btn {
          min-width: 58px;
          padding: 7px 9px;
          font-size: 9px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  _showBuildingActionMenu({
    mode = null,
    properties = {},
    geometry = null,
    lngLat = null,
    waitForMoveEnd = false,
  } = {}) {
    if (!this.map) return;

    const token = ++this._buildingActionToken;

    const show = () => {
      if (token !== this._buildingActionToken) return;
      if (mode && state.activeBuildingLayerMode !== mode) return;

      const actionLngLat = this._altitudeHeightLabelLngLat({ geometry, lngLat, properties });
      if (!actionLngLat) return;

      this._clearBuildingActionMenu({ keepToken: true });

      const heightInfo = this._selectedLabelHeightInfo(properties);
      const fallbackHeight = mode === 'lod2'
        ? Number(this.lod2Layer?.getSelectedBuildingHeightInfo?.()?.heightM)
        : NaN;
      const height = Number.isFinite(heightInfo.value) && heightInfo.value > 0
        ? heightInfo.value
        : fallbackHeight;
      const heightText = Number.isFinite(height) && height > 0
        ? 'Height ' + height.toFixed(1) + ' m'
        : 'Height -- m';

      // LOD2 pick では footprint geometry がここに無いことがある。
      // v21 では LOD2 選択時にも面積算出を試み、環境によって選択 UI / scan が詰まるケースがあった。
      // まずは LOD2 の既存挙動を優先し、Area / Bulk は footprint 選択時だけ算出する。
      // LOD2 の Area / Bulk は次段階で LOD2 pick から footprint 相当 geometry を取得できる経路を追加する。
      const areaInfo = mode === 'footprint'
        ? this._selectedBuildingAreaInfo({ geometry, properties })
        : { value: NaN, source: null };
      const areaM2 = areaInfo.value;
      const bulkM3 = Number.isFinite(areaM2) && areaM2 > 0 && Number.isFinite(height) && height > 0
        ? areaM2 * height
        : NaN;
      const areaText = Number.isFinite(areaM2) && areaM2 > 0
        ? 'Area ' + this._formatAreaMeters2(areaM2)
        : 'Area -- m²';
      const bulkText = Number.isFinite(bulkM3) && bulkM3 > 0
        ? 'Bulk ' + this._formatBulkMeters3(bulkM3)
        : 'Bulk -- m³';

      this._ensureBuildingActionStyle();

      const root = document.createElement('div');
      root.className = 'petiteau-building-action';
      root.addEventListener('click', (ev) => ev.stopPropagation());
      root.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      root.addEventListener('mousedown', (ev) => ev.stopPropagation());
      root.addEventListener('touchstart', (ev) => ev.stopPropagation(), { passive: true });

      const heightEl = document.createElement('div');
      heightEl.className = 'petiteau-building-action-height';
      heightEl.textContent = heightText;

      const areaEl = document.createElement('div');
      areaEl.className = 'petiteau-building-action-metric';
      areaEl.textContent = areaText;

      const info = document.createElement('div');
      info.className = 'petiteau-building-action-info';

      const bulkLine = document.createElement('div');
      bulkLine.className = 'petiteau-building-action-metric petiteau-building-action-bulk-line';

      const bulkTextEl = document.createElement('span');
      bulkTextEl.textContent = bulkText;

      const moreEl = document.createElement('span');
      moreEl.className = 'petiteau-building-action-more';
      moreEl.textContent = '+';
      moreEl.title = 'more';
      bulkLine.append(bulkTextEl, moreEl);

      const row = document.createElement('div');
      row.className = 'petiteau-building-action-row';

      const laserBtn = document.createElement('button');
      laserBtn.type = 'button';
      laserBtn.className = 'petiteau-building-action-btn';
      laserBtn.textContent = 'LASER';
      laserBtn.title = 'レーザースキャン';
      laserBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this._runSelectedBuildingLaserFromAction(mode);
      });

      const shadowBtn = document.createElement('button');
      shadowBtn.type = 'button';
      shadowBtn.className = 'petiteau-building-action-btn';
      shadowBtn.textContent = 'SHADOW';
      shadowBtn.title = '日影（次段階）';
      shadowBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this._runSelectedBuildingShadowFromAction(mode);
      });

      row.append(laserBtn, shadowBtn);
      info.append(heightEl, areaEl, bulkLine);
      root.append(info, row);

      this._buildingActionMarker = new maplibregl.Marker({
        element: root,
        anchor: 'bottom',
        offset: [0, -8],
      })
        .setLngLat(actionLngLat)
        .addTo(this.map);
    };

    if (waitForMoveEnd) {
      this.map.once('moveend', show);
    } else {
      requestAnimationFrame(show);
    }
  }

  _clearBuildingActionMenu({ keepToken = false } = {}) {
    if (!keepToken) {
      this._buildingActionToken += 1;
    }

    if (this._buildingActionMarker) {
      this._buildingActionMarker.remove();
      this._buildingActionMarker = null;
    }
  }

  _runSelectedBuildingLaserFromAction(mode = null) {
    if (!this.map) return;
    if (mode && state.activeBuildingLayerMode !== mode) return;

    this._clearBuildingActionMenu();

    if (state.activeBuildingLayerMode === 'lod2') {
      this._scheduleSelectedLod2HeightScan({
        waitForMoveEnd: false,
        lngLat: null,
      });
      return;
    }

    if (state.activeBuildingLayerMode === 'footprint') {
      this._scheduleSelectedFootprintHeightScan({ waitForMoveEnd: false });
    }
  }

  _runSelectedBuildingShadowFromAction(mode = null) {
    if (!this.map) return;
    if (mode && state.activeBuildingLayerMode !== mode) return;

    this._clearBuildingActionMenu();

    if (state.activeBuildingLayerMode === 'lod2') {
      console.info('[BuildingAction] LOD2 selected-building shadow: footprint geometry is not available yet.');
      this._emit('buildingAction', {
        action: 'shadow',
        mode: state.activeBuildingLayerMode,
        properties: state.selectedBuildingProperties ?? {},
        geometry: null,
      });
      return;
    }

    if (state.activeBuildingLayerMode !== 'footprint' || !state.selectedBuildingGeometry) {
      console.warn('[BuildingAction] Footprint selected-building shadow skipped: geometry is not available.');
      return;
    }

    const properties = state.selectedBuildingProperties ?? {};
    const heightM = this._selectedFootprintHeightMeters(properties);

    // Correct order:
    // 1) remove turquoise selection look
    // 2) restore selected building to normal opaque footprint volume
    // 3) draw projected shadow
    this._applySelectedBuildingShadowStyle();

    const layer = this._ensureSelectedShadowLayer();
    const ok = layer?.show?.({
      geometry: state.selectedBuildingGeometry,
      heightM,
      sunAzimuthDeg: this._lod1SunAzimuth,
      sunElevationDeg: this._lod1SunElevation,
      opacity: 0.26,
    });

    this._placeSelectedShadowStackAboveRoad();

    if (ok) {
      console.info('[BuildingAction] Footprint selected-building projected shadow enabled.');
    } else {
      console.warn('[BuildingAction] Footprint selected-building projected shadow failed.');
    }

    this._emit('buildingAction', {
      action: 'shadow',
      mode: state.activeBuildingLayerMode,
      properties,
      geometry: state.selectedBuildingGeometry,
    });
  }

  /**
   * LOD2 建物選択後、カメラ fit が終わってから高さ走査を1回だけ発動する。
   * 選択が変わった場合は古い待機を無効化する。
   */
  _scheduleSelectedLod2HeightScan({ waitForMoveEnd = true, lngLat = null } = {}) {
    if (!this.map || !this.lod2Layer?.startSelectedBuildingHeightScan) return;

    const token = ++this._heightScanStartToken;

    const start = () => {
      if (token !== this._heightScanStartToken) return;
      if (state.activeBuildingLayerMode !== 'lod2') return;

      requestAnimationFrame(() => {
        if (token !== this._heightScanStartToken) return;
        if (state.activeBuildingLayerMode !== 'lod2') return;

        const durationMs = 5000;
        const properties = state.selectedBuildingProperties ?? {};
        const scanInfo = this.lod2Layer?.getSelectedBuildingHeightInfo?.() ?? null;
        const scanHeightM = Number(scanInfo?.heightM);
        const scanAltitudeM = Number(scanInfo?.altitudeM);
        const heightM = Number.isFinite(scanHeightM) && scanHeightM > 0
          ? scanHeightM
          : this._selectedFootprintHeightMeters(properties);

        this.lod2Layer.startSelectedBuildingHeightScan({
          durationMs,
          bandWidthM: this._heightScanBandWidthM,
          scanColor: this._heightScanColor,
          onComplete: () => {
            if (token !== this._heightScanStartToken) return;
            if (state.activeBuildingLayerMode !== 'lod2') return;
            this._clearSelectionAfterLaserScan();
          },
        });

        // LOD2 は raw footprint metadata が無い場合でも、レーザー走査に使う
        // 選択 mesh の world Y 範囲から Height / Altitude を表示できる。
        const labelProperties = {
          ...properties,
          ...(Number.isFinite(scanAltitudeM) ? {
            __lod2_scan_top_altitude: scanAltitudeM,
          } : {}),
          ...(Number.isFinite(scanHeightM) && scanHeightM > 0 ? {
            __lod2_scan_height: scanHeightM,
          } : {}),
        };

        // Height は建物上アクション UI 側に集約する。
        // レーザースキャン中の一時 Height ラベルは出さない。
      });
    };

    if (waitForMoveEnd) {
      this.map.once('moveend', start);
    } else {
      start();
    }
  }


  _scheduleAltitudeHeightLabel({
    durationMs = 2400,
    properties = {},
    heightM = null,
    geometry = null,
    lngLat = null,
  } = {}) {
    if (!this.map) return;

    this._clearAltitudeHeightLabel();

    const labelLngLat = this._altitudeHeightLabelLngLat({ geometry, lngLat, properties });
    if (!labelLngLat) return;

    // v46: ラベル値は scan 用 heightM ではなく、raw metadata を優先して解決する。
    // scan 用 height は描画都合の display height / h を許容するが、
    // 表示ラベルは measured_height と roof_elevation_max を優先する。
    const altitudeInfo = this._selectedTopAltitudeInfo(properties);
    const heightInfo = this._selectedLabelHeightInfo(properties);
    const altitude = altitudeInfo.value;
    const height = heightInfo.value;

    const lines = [];
    // UI 表示は Height のみ。Altitude は内部値としては残すが表示しない。
    if (Number.isFinite(height) && height > 0) {
      lines.push(`Height ${height.toFixed(1)} m`);
    }

    if (!lines.length) return;

    console.info(
      `[AltitudeLabel] mi=${state.selectedFootprintMi ?? properties?.mi ?? 'unknown'} ` +
      `altitude=${Number.isFinite(altitude) ? altitude.toFixed(1) : 'n/a'}(${altitudeInfo.source ?? 'none'}) ` +
      `height=${Number.isFinite(height) ? height.toFixed(1) : 'n/a'}(${heightInfo.source ?? 'none'})`
    );

    const token = ++this._altitudeHeightLabelToken;
    const showAtMs = Math.max(0, Number(durationMs) - 2000);
    const hideAtMs = Math.max(showAtMs + 1, Number(durationMs) + 1000);

    const markerEl = document.createElement('div');
    markerEl.className = 'petiteau-altitude-height-anchor';
    markerEl.style.pointerEvents = 'none';

    const textEl = document.createElement('div');
    textEl.className = 'petiteau-altitude-height-label';
    textEl.style.pointerEvents = 'none';
    textEl.style.whiteSpace = 'nowrap';
    textEl.style.color = '#f4ffff';
    textEl.style.fontSize = '12px';
    textEl.style.lineHeight = '1.35';
    textEl.style.fontWeight = '500';
    textEl.style.letterSpacing = '0.02em';
    textEl.style.textAlign = 'center';
    textEl.style.textShadow = [
      '0 0 4px rgba(0, 0, 0, 0.95)',
      '0 0 8px rgba(0, 240, 238, 0.78)',
      '0 0 14px rgba(0, 240, 238, 0.48)',
    ].join(', ');
    textEl.style.opacity = '0';
    textEl.style.transform = 'translate(-50%, -64px) scale(0.96)';
    textEl.style.transition = 'opacity 480ms ease, transform 480ms ease';
    textEl.innerHTML = lines.map((line) => this._escapeHtml(line)).join('<br>');

    markerEl.appendChild(textEl);

    this._altitudeHeightMarker = new maplibregl.Marker({
      element: markerEl,
      anchor: 'bottom',
      offset: [0, 0],
    })
      .setLngLat(labelLngLat)
      .addTo(this.map);

    const showTimer = window.setTimeout(() => {
      if (token !== this._altitudeHeightLabelToken) return;
      textEl.style.opacity = '1';
      textEl.style.transform = 'translate(-50%, -74px) scale(1)';
    }, showAtMs);

    const hideTimer = window.setTimeout(() => {
      if (token !== this._altitudeHeightLabelToken) return;
      textEl.style.opacity = '0';
      textEl.style.transform = 'translate(-50%, -86px) scale(0.98)';
    }, hideAtMs);

    const removeTimer = window.setTimeout(() => {
      if (token !== this._altitudeHeightLabelToken) return;
      this._clearAltitudeHeightLabel();
    }, hideAtMs + 620);

    this._altitudeHeightTimers.push(showTimer, hideTimer, removeTimer);
  }

  _clearAltitudeHeightLabel() {
    this._altitudeHeightLabelToken += 1;

    for (const timer of this._altitudeHeightTimers) {
      clearTimeout(timer);
    }
    this._altitudeHeightTimers = [];

    if (this._altitudeHeightMarker) {
      this._altitudeHeightMarker.remove();
      this._altitudeHeightMarker = null;
    }
  }

  _selectedTopAltitudeMeters(properties = {}) {
    return this._selectedTopAltitudeInfo(properties).value;
  }

  _selectedTopAltitudeInfo(properties = {}) {
    return this._firstFinitePropertyNumber(properties, [
      '__lod2_scan_top_altitude',
      'roof_elevation_max',
      'roofElevationMax',
      'raw_z_max',
      'rawZMax',
      'elevation_max',
      'elevationMax',
      'top_altitude',
      'topAltitude',
      'altitude',
      'z_max',
      'zMax',
    ]);
  }

  _selectedLabelHeightMeters(properties = {}) {
    return this._selectedLabelHeightInfo(properties).value;
  }

  _selectedLabelHeightInfo(properties = {}) {
    return this._firstFinitePropertyNumber(properties, [
      // User-facing label: prefer measured height from raw metadata.
      '__lod2_scan_height',
      'measured_height',
      'measuredHeight',
      'bldg_measuredHeight',
      'building_height',
      'buildingHeight',
      // Then accepted metadata/display values.
      'height',
      'display_height',
      'displayHeight',
      'display_height_m',
      // Last fallback: PMTiles / render shorthand.
      'h',
      'HEIGHT',
      'render_height',
      'extrusionHeight',
    ]);
  }

  _firstFinitePropertyNumber(properties = {}, keys = []) {
    for (const key of keys) {
      const n = this._toFiniteHeightNumber(properties?.[key]);
      if (Number.isFinite(n) && n > 0) {
        return { value: n, source: key };
      }
      if (Number.isFinite(n) && key.includes('elevation')) {
        return { value: n, source: key };
      }
    }

    return { value: NaN, source: null };
  }

  _altitudeHeightLabelLngLat({ geometry = null, lngLat = null, properties = {} } = {}) {
    const repLng = Number(properties?.representative_lon ?? properties?.representativeLng ?? properties?.lon);
    const repLat = Number(properties?.representative_lat ?? properties?.representativeLat ?? properties?.lat);

    if (Number.isFinite(repLng) && Number.isFinite(repLat)) {
      return [repLng, repLat];
    }

    if (lngLat) {
      if (Number.isFinite(lngLat.lng) && Number.isFinite(lngLat.lat)) {
        return [lngLat.lng, lngLat.lat];
      }
      if (Array.isArray(lngLat) && lngLat.length >= 2) {
        const lng = Number(lngLat[0]);
        const lat = Number(lngLat[1]);
        if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
      }
    }

    const bbox = this._geometryToBbox(geometry);
    if (bbox) {
      return [
        (bbox[0] + bbox[2]) * 0.5,
        (bbox[1] + bbox[3]) * 0.5,
      ];
    }

    return null;
  }

  _escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  _selectedBuildingAreaInfo({ geometry = null, properties = {} } = {}) {
    const fromGeometry = this._geometryAreaMeters2(geometry);
    if (Number.isFinite(fromGeometry) && fromGeometry > 0) {
      return { value: fromGeometry, source: 'geometry' };
    }

    const keys = [
      'area',
      'area_m2',
      'areaM2',
      'footprint_area',
      'footprintArea',
      'footprint_area_m2',
      'bldg_footprint_area',
      'measuredArea',
      'measured_area',
      'buildingArea',
      'building_area',
      '建築面積',
      '面積',
    ];

    for (const key of keys) {
      const n = this._toFiniteAreaNumber(properties?.[key]);
      if (Number.isFinite(n) && n > 0) {
        return { value: n, source: key };
      }
    }

    return { value: NaN, source: null };
  }

  _geometryAreaMeters2(geometry = null) {
    if (!geometry || !geometry.type || !geometry.coordinates) return NaN;

    if (geometry.type === 'Polygon') {
      return this._polygonAreaMeters2(geometry.coordinates);
    }

    if (geometry.type === 'MultiPolygon') {
      let sum = 0;
      for (const polygon of geometry.coordinates || []) {
        const a = this._polygonAreaMeters2(polygon);
        if (Number.isFinite(a) && a > 0) sum += a;
      }
      return sum > 0 ? sum : NaN;
    }

    if (geometry.type === 'Feature') {
      return this._geometryAreaMeters2(geometry.geometry);
    }

    return NaN;
  }

  _polygonAreaMeters2(rings = []) {
    if (!Array.isArray(rings) || !rings.length) return NaN;

    let total = 0;
    for (let i = 0; i < rings.length; i += 1) {
      const ringArea = Math.abs(this._ringAreaMeters2(rings[i]));
      if (!Number.isFinite(ringArea)) continue;
      total += i === 0 ? ringArea : -ringArea;
    }

    return total > 0 ? total : NaN;
  }

  _ringAreaMeters2(ring = []) {
    if (!Array.isArray(ring) || ring.length < 3) return NaN;

    let latSum = 0;
    let lngSum = 0;
    let count = 0;

    for (const coord of ring) {
      if (!Array.isArray(coord) || coord.length < 2) continue;
      const lng = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      lngSum += lng;
      latSum += lat;
      count += 1;
    }

    if (count < 3) return NaN;

    const refLng = lngSum / count;
    const refLat = latSum / count;
    const metrics = this._metersPerDegreeAtLat(refLat);
    if (!metrics) return NaN;

    let area2 = 0;
    let prev = null;
    const projected = [];

    for (const coord of ring) {
      if (!Array.isArray(coord) || coord.length < 2) continue;
      const lng = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const p = [
        (lng - refLng) * metrics.lon,
        (lat - refLat) * metrics.lat,
      ];
      projected.push(p);
      prev = p;
    }

    if (projected.length < 3) return NaN;

    for (let i = 0; i < projected.length; i += 1) {
      const a = projected[i];
      const b = projected[(i + 1) % projected.length];
      area2 += a[0] * b[1] - b[0] * a[1];
    }

    return area2 * 0.5;
  }

  _metersPerDegreeAtLat(latDeg) {
    const lat = Number(latDeg);
    if (!Number.isFinite(lat)) return null;

    const rad = lat * Math.PI / 180;
    const mPerDegLat = 111132.92
      - 559.82 * Math.cos(2 * rad)
      + 1.175 * Math.cos(4 * rad)
      - 0.0023 * Math.cos(6 * rad);
    const mPerDegLon = 111412.84 * Math.cos(rad)
      - 93.5 * Math.cos(3 * rad)
      + 0.118 * Math.cos(5 * rad);

    if (!Number.isFinite(mPerDegLat) || !Number.isFinite(mPerDegLon) || mPerDegLon <= 0) {
      return null;
    }

    return { lat: mPerDegLat, lon: mPerDegLon };
  }

  _toFiniteAreaNumber(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : NaN;
    }

    if (typeof value === 'string') {
      const cleaned = value
        .replace(/平方メートル|㎡|m2|m²|平米|\s/g, '')
        .replace(/,/g, '');
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : NaN;
    }

    return NaN;
  }

  _formatAreaMeters2(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '-- m²';
    if (n < 1000) return `${n.toFixed(1)} m²`;
    return `${Math.round(n).toLocaleString('en-US')} m²`;
  }

  _formatBulkMeters3(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '-- m³';
    if (n < 100) return `${n.toFixed(1)} m³`;
    return `${Math.round(n).toLocaleString('en-US')} m³`;
  }

  _selectedFootprintHeightMeters(properties = {}) {
    const keys = [
      'display_height',
      'displayHeight',
      'display_height_m',
      'height',
      'measuredHeight',
      'measured_height',
      'bldg_measuredHeight',
      'h',
      'HEIGHT',
      'render_height',
      'extrusionHeight',
    ];

    for (const key of keys) {
      const value = properties?.[key];
      const n = this._toFiniteHeightNumber(value);
      if (Number.isFinite(n) && n > 0) {
        return Math.max(0.1, n);
      }
    }

    return 10;
  }

  _toFiniteHeightNumber(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : NaN;
    }

    if (typeof value === 'string') {
      const cleaned = value
        .replace(/[ｍmメートル\s]/g, '')
        .replace(/,/g, '');
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : NaN;
    }

    return NaN;
  }

  /**
   * Footprint 疑似3D建物選択後、カメラ fit が終わってから高さ走査を1回だけ発動する。
   * v42: raw footprint geometry を使い、最終仕様に近い top -> bottom の下降 slice を検証する。
   */
  _scheduleSelectedFootprintHeightScan({ waitForMoveEnd = true } = {}) {
    if (!this.map) return;
    if (!state.selectedBuildingGeometry) return;

    const token = ++this._footprintHeightScanToken;

    const start = () => {
      if (token !== this._footprintHeightScanToken) return;
      if (state.activeBuildingLayerMode !== 'footprint') return;

      requestAnimationFrame(() => {
        if (token !== this._footprintHeightScanToken) return;
        if (state.activeBuildingLayerMode !== 'footprint') return;

        const properties = state.selectedBuildingProperties ?? {};
        const heightM = this._selectedFootprintHeightMeters(properties);

        console.info(
          `[FootprintScan] START direction=top-down mi=${state.selectedFootprintMi ?? 'unknown'} height=${heightM.toFixed(2)}`
        );

        const durationMs = 1400;

        // Height は建物上アクション UI 側に集約する。
        // レーザースキャン中の一時 Height ラベルは出さない。

        this._startSelectedFootprintHeightScan({
          heightM,
          durationMs,
          bandWidthM: Math.max(0.28, this._heightScanBandWidthM),
          color: this._heightScanColor,
          direction: 'down',
          onComplete: () => {
            // _startSelectedFootprintHeightScan() owns its own RAF token.
            // Do not compare with the outer schedule token here: starting the
            // scan intentionally increments _footprintHeightScanToken, so that
            // check prevented Footprint selection from being cleared at scan end.
            if (state.activeBuildingLayerMode !== 'footprint') return;
            this._clearSelectionAfterLaserScan();
          },
        });
      });
    };

    if (waitForMoveEnd) {
      this.map.once('moveend', start);
    } else {
      start();
    }
  }

  _startSelectedFootprintHeightScan({
    heightM,
    durationMs = 2400,
    bandWidthM = this._heightScanBandWidthM,
    color = this._heightScanColor,
    direction = 'up',
    onComplete = null,
  } = {}) {
    this._stopSelectedFootprintHeightScan();

    if (!this.map?.getLayer(SELECTED_BUILDING_HEIGHT_SCAN)) return;

    const h = Math.max(0.1, Number(heightM) || 10);
    const band = Math.max(0.1, Math.min(0.8, Number(bandWidthM) || 0.28));
    const duration = Math.max(1, Number(durationMs) || 2400);
    const scanDirection = direction === 'down' ? 'down' : 'up';

    this._footprintHeightScanActive = true;
    const token = ++this._footprintHeightScanToken;
    let startTime = null;

    this.map.setPaintProperty(
      SELECTED_BUILDING_HEIGHT_SCAN,
      'fill-extrusion-color',
      color,
    );
    this.map.setPaintProperty(
      SELECTED_BUILDING_HEIGHT_SCAN,
      'fill-extrusion-opacity',
      0.92,
    );
    this.map.setLayoutProperty(
      SELECTED_BUILDING_HEIGHT_SCAN,
      'visibility',
      'visible',
    );

    const tick = (now) => {
      if (
        token !== this._footprintHeightScanToken ||
        !this._footprintHeightScanActive ||
        state.activeBuildingLayerMode !== 'footprint'
      ) {
        return;
      }

      if (startTime === null) startTime = now;

      const elapsed = Math.max(0, now - startTime);
      const progress = Math.min(1, elapsed / duration);

      let base;
      let scanHeight;

      if (scanDirection === 'down') {
        const top = h - h * progress;
        base = Math.max(0, top - band);
        scanHeight = Math.max(base + 0.01, top);
      } else {
        base = Math.min(h, h * progress);
        scanHeight = Math.min(h, base + band);
        if (scanHeight <= base) {
          scanHeight = Math.min(h, base + 0.01);
        }
      }

      this.map.setPaintProperty(
        SELECTED_BUILDING_HEIGHT_SCAN,
        'fill-extrusion-base',
        base,
      );
      this.map.setPaintProperty(
        SELECTED_BUILDING_HEIGHT_SCAN,
        'fill-extrusion-height',
        scanHeight,
      );

      if (progress < 1) {
        this._footprintHeightScanRaf = requestAnimationFrame(tick);
      } else {
        this._footprintHeightScanActive = false;
        this._footprintHeightScanRaf = null;
        if (typeof onComplete === 'function') {
          onComplete();
        } else {
          this._stopSelectedFootprintHeightScan();
        }
      }
    };

    this._footprintHeightScanRaf = requestAnimationFrame(tick);
  }

  _stopSelectedFootprintHeightScan() {
    this._footprintHeightScanToken += 1;
    this._footprintHeightScanActive = false;

    if (this._footprintHeightScanRaf !== null) {
      cancelAnimationFrame(this._footprintHeightScanRaf);
      this._footprintHeightScanRaf = null;
    }

    if (this.footprintScanLayer?.stop) {
      this.footprintScanLayer.stop();
    }

    // 旧 MapLibre fill-extrusion scan layer が残っている版からの移行時だけ安全に隠す。
    if (this.map?.getLayer(SELECTED_BUILDING_HEIGHT_SCAN)) {
      this.map.setLayoutProperty(
        SELECTED_BUILDING_HEIGHT_SCAN,
        'visibility',
        'none',
      );
    }
  }

  async _selectBuilding(feature, lngLat) {
    if (!feature?.geometry) {
      console.warn('[MapApp] clicked feature has no geometry:', feature);
      return;
    }

    const center = this.map.getCenter();

    state.previousCameraState = {
      center: [center.lng, center.lat],
      zoom: this.map.getZoom(),
      bearing: this.map.getBearing(),
      pitch: this.map.getPitch(),
    };

    // Footprint 建物が主選択。表示は変えず、以後は LOD2 側の選択だけ止める。
    state.activeBuildingLayerMode = 'footprint';
    this._heightScanStartToken += 1;

    if (this.lod2Layer?.clearMeshSelection) {
      this.lod2Layer.clearMeshSelection();
    }

    const selectedMi = this._footprintMi(feature);

    const fallbackSelectedFeatures = this._collectFootprintBuildingFeatures(feature);
    let selectedFeatures = fallbackSelectedFeatures;
    let mergedFeature = this._mergeFootprintFeatures(fallbackSelectedFeatures, feature);

    // 最小実験: 選択後の精密 geometry だけ、丁単位 raw GeoJSON へ差し替える。
    // PMTiles は通常表示とクリック入口として維持する。
    const rawFeature = await this._findRawFootprintFeatureForClickedFeature(feature, lngLat);

    if (rawFeature?.geometry) {
      selectedFeatures = [rawFeature];
      mergedFeature = rawFeature;
      console.info(
        `[RawFootprint] HIT mi=${selectedMi} chome=${rawFeature.properties?.__rawChomeId ?? 'unknown'}`
      );
    } else {
      console.info(`[RawFootprint] FALLBACK mi=${selectedMi}`);
    }

    state.selectedBuildingId = null;
    state.selectedFootprintMi = selectedMi;
    state.selectedBuildingGeometry = mergedFeature.geometry;
    state.selectedBuildingProperties = {
      ...(feature.properties ?? {}),
      ...(mergedFeature.properties ?? {}),
    };

    this._setSelectedBuildingFeature(mergedFeature);

    // footprint 選択中は LOD2 を使わないため、丁単位 highlight は出さない。
    state.selectedChomeId = null;

    // Footprint 選択でも bbox へ寄るが、ユーザーが回転した方位・pitch は維持する。
    const footprintBbox = this._featuresToBbox(selectedFeatures)
      ?? this._geometryToBbox(mergedFeature.geometry);
    const cameraMoved = this.cameraController?.fitBuildingBboxKeepView(footprintBbox) ?? false;

    // 建物クリックでは即レーザースキャンしない。
    // まず建物上の小 UI を出し、LASER / SHADOW をユーザーに選ばせる。
    this._showBuildingActionMenu({
      mode: 'footprint',
      properties: state.selectedBuildingProperties ?? {},
      geometry: state.selectedBuildingGeometry,
      lngLat,
      waitForMoveEnd: cameraMoved,
    });

    this._onZoom();

    this._emit('selectionChange', {
      feature,
      lngLat,
      properties: feature.properties,
    });
  }



  _buildFootprintExtrusionFilter(lod2Active) {
    const filters = [];

    if (lod2Active) {
      filters.push(['!=', ['get', 'l2'], 1]);
    }

    if (state.selectedFootprintMi !== null && state.selectedFootprintMi !== undefined) {
      filters.push(['!=', ['get', 'mi'], state.selectedFootprintMi]);
    }

    if (!filters.length) return null;
    if (filters.length === 1) return filters[0];

    return ['all', ...filters];
  }

  _footprintMi(feature) {
    const raw = feature?.properties?.mi;

    if (raw === null || raw === undefined || raw === '') return null;

    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }

  /**
   * PMTiles / vector tile 化でタイル境界に分かれた footprint を、
   * mi を建物単位キーとして viewer 側で再集合する。
   */
  _collectFootprintBuildingFeatures(clickedFeature) {
    const mi = this._footprintMi(clickedFeature);

    if (mi === null) {
      return [this._plainGeoJsonFeature(clickedFeature)];
    }

    let sourceFeatures = [];

    try {
      sourceFeatures = this.map.querySourceFeatures(FOOTPRINT_SOURCE, {
        sourceLayer: this.footprintSourceLayer,
        filter: ['==', ['get', 'mi'], mi],
      }) ?? [];
    } catch (err) {
      console.warn('[MapApp] querySourceFeatures for footprint mi failed:', mi, err);
    }

    const candidates = sourceFeatures.length
      ? sourceFeatures
      : [clickedFeature];

    const unique = [];
    const seen = new Set();

    for (const f of candidates) {
      if (!f?.geometry) continue;

      const plain = this._plainGeoJsonFeature(f);
      const key = JSON.stringify(plain.geometry);

      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(plain);
    }

    return unique.length
      ? unique
      : [this._plainGeoJsonFeature(clickedFeature)];
  }

  async _findRawFootprintFeatureForClickedFeature(clickedFeature, lngLat) {
    const mi = this._footprintMi(clickedFeature);

    if (mi === null || mi === undefined) {
      return null;
    }

    const index = await this._loadRawFootprintIndex();
    if (!Array.isArray(index) || !index.length) {
      return null;
    }

    const probe = this._rawFootprintProbePoint(clickedFeature, lngLat);
    const candidates = this._rawFootprintChomeCandidates(index, probe);

    for (const entry of candidates) {
      const fc = await this._loadRawFootprintFeatureCollection(entry);
      const feature = this._findFeatureByMi(fc, mi);

      if (!feature) continue;

      const metadata = await this._loadRawFootprintMetadataForMi(entry, mi);

      return {
        type: 'Feature',
        geometry: feature.geometry,
        properties: {
          ...(clickedFeature.properties ?? {}),
          ...(feature.properties ?? {}),
          ...(metadata ?? {}),
          __rawFootprint: true,
          __rawChomeId: entry.id ?? null,
          __rawChomeName: entry.name ?? null,
        },
      };
    }

    return null;
  }

  async _loadRawFootprintIndex() {
    if (this._rawFootprintIndex) {
      return this._rawFootprintIndex;
    }

    if (this._rawFootprintIndexPromise) {
      return this._rawFootprintIndexPromise;
    }

    const root = this._rawFootprintRootPath();
    const url = `${root}/bldg_chome_index.json`;

    this._rawFootprintIndexPromise = fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((json) => {
        this._rawFootprintIndex = Array.isArray(json) ? json : [];
        return this._rawFootprintIndex;
      })
      .catch((err) => {
        console.warn('[MapApp] raw footprint index load failed:', url, err);
        this._rawFootprintIndex = [];
        return [];
      });

    return this._rawFootprintIndexPromise;
  }

  async _loadRawFootprintFeatureCollection(entry) {
    if (!entry?.id) return null;

    const cacheKey = entry.id;
    if (this._rawFootprintFeatureCache.has(cacheKey)) {
      return this._rawFootprintFeatureCache.get(cacheKey);
    }

    const root = this._rawFootprintRootPath();
    const rel = entry.footprint || `footprint/${entry.id}_bldg_footprint.geojson`;
    const url = `${root}/${rel}`;

    const promise = fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .catch((err) => {
        console.warn('[MapApp] raw footprint GeoJSON load failed:', url, err);
        return null;
      });

    this._rawFootprintFeatureCache.set(cacheKey, promise);
    return promise;
  }

  async _loadRawFootprintMetadataForMi(entry, mi) {
    if (!entry?.id) return null;

    const metadata = await this._loadRawFootprintMetadata(entry);
    if (!metadata || typeof metadata !== 'object') return null;

    if (Object.prototype.hasOwnProperty.call(metadata, mi)) {
      return metadata[mi];
    }

    const miText = String(mi);
    if (Object.prototype.hasOwnProperty.call(metadata, miText)) {
      return metadata[miText];
    }

    for (const [key, value] of Object.entries(metadata)) {
      if (this._sameFootprintMi(key, mi)) {
        return value;
      }
    }

    return null;
  }

  async _loadRawFootprintMetadata(entry) {
    if (!entry?.id) return null;

    const cacheKey = entry.id;
    if (this._rawFootprintMetadataCache.has(cacheKey)) {
      return this._rawFootprintMetadataCache.get(cacheKey);
    }

    const root = this._rawFootprintRootPath();
    const rel = entry.metadata || `metadata/${entry.id}_bldg_metadata.json`;
    const url = `${root}/${rel}`;

    const promise = fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .catch((err) => {
        console.warn('[MapApp] raw footprint metadata load failed:', url, err);
        return null;
      });

    this._rawFootprintMetadataCache.set(cacheKey, promise);
    return promise;
  }

  _rawFootprintRootPath() {
    const areaBase = state.areaBasePath || '';
    return `${areaBase}/bldg/footprint_geojson`;
  }

  _rawFootprintProbePoint(feature, lngLat) {
    const bbox = this._geometryToBbox(feature?.geometry);

    if (bbox) {
      return [
        (bbox[0] + bbox[2]) * 0.5,
        (bbox[1] + bbox[3]) * 0.5,
      ];
    }

    if (lngLat) {
      if (Number.isFinite(lngLat.lng) && Number.isFinite(lngLat.lat)) {
        return [lngLat.lng, lngLat.lat];
      }

      if (Array.isArray(lngLat) && lngLat.length >= 2) {
        return [Number(lngLat[0]), Number(lngLat[1])];
      }
    }

    return null;
  }

  _rawFootprintChomeCandidates(index, point) {
    if (!point) return index;

    const [lng, lat] = point;

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return index;
    }

    const contains = [];
    const nearest = [];

    for (const entry of index) {
      const bbox = entry?.bbox;
      if (!Array.isArray(bbox) || bbox.length < 4) continue;

      const [w, s, e, n] = bbox.map(Number);
      if (![w, s, e, n].every(Number.isFinite)) continue;

      const inside = lng >= w && lng <= e && lat >= s && lat <= n;
      const area = Math.max(1e-12, (e - w) * (n - s));
      const dx = lng < w ? w - lng : lng > e ? lng - e : 0;
      const dy = lat < s ? s - lat : lat > n ? lat - n : 0;
      const dist2 = dx * dx + dy * dy;

      if (inside) {
        contains.push({ entry, area });
      } else {
        nearest.push({ entry, dist2, area });
      }
    }

    if (contains.length) {
      contains.sort((a, b) => a.area - b.area);
      return contains.map((x) => x.entry);
    }

    nearest.sort((a, b) => a.dist2 - b.dist2 || a.area - b.area);
    return nearest.slice(0, 5).map((x) => x.entry);
  }

  _findFeatureByMi(featureCollection, mi) {
    const features = featureCollection?.features;
    if (!Array.isArray(features)) return null;

    for (const feature of features) {
      if (this._sameFootprintMi(feature?.properties?.mi, mi)) {
        return feature;
      }
    }

    return null;
  }

  _sameFootprintMi(a, b) {
    if (a === b) return true;

    const na = Number(a);
    const nb = Number(b);

    if (Number.isFinite(na) && Number.isFinite(nb)) {
      return na === nb;
    }

    return String(a) === String(b);
  }

  _plainGeoJsonFeature(feature) {
    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        ...(feature.properties ?? {}),
      },
    };
  }

  /**
   * 複数 fragment を、選択表示用の 1 feature に戻す。
   * 元データは 1棟 1 feature だが、vector tile ではタイル境界で fragment 化されるため、
   * viewer の選択表示だけ MultiPolygon にまとめ直す。
   */
  _mergeFootprintFeatures(features, fallbackFeature) {
    const list = Array.isArray(features) && features.length
      ? features
      : [this._plainGeoJsonFeature(fallbackFeature)];

    const polygons = [];

    for (const feature of list) {
      const geom = feature?.geometry;
      if (!geom) continue;

      if (geom.type === 'Polygon') {
        polygons.push(geom.coordinates);
      } else if (geom.type === 'MultiPolygon') {
        polygons.push(...geom.coordinates);
      }
    }

    const baseProps = {
      ...(fallbackFeature?.properties ?? list[0]?.properties ?? {}),
    };

    if (!polygons.length) {
      return this._plainGeoJsonFeature(fallbackFeature);
    }

    return {
      type: 'Feature',
      geometry: polygons.length === 1
        ? { type: 'Polygon', coordinates: polygons[0] }
        : { type: 'MultiPolygon', coordinates: polygons },
      properties: baseProps,
    };
  }

  _featuresToBbox(features) {
    if (!Array.isArray(features) || !features.length) return null;

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;

    for (const feature of features) {
      const bbox = this._geometryToBbox(feature?.geometry);
      if (!bbox) continue;

      minLng = Math.min(minLng, bbox[0]);
      minLat = Math.min(minLat, bbox[1]);
      maxLng = Math.max(maxLng, bbox[2]);
      maxLat = Math.max(maxLat, bbox[3]);
    }

    if (
      !Number.isFinite(minLng) ||
      !Number.isFinite(minLat) ||
      !Number.isFinite(maxLng) ||
      !Number.isFinite(maxLat)
    ) {
      return null;
    }

    return [minLng, minLat, maxLng, maxLat];
  }

  _setSelectedBuildingFeature(feature) {
    this._applySelectedBuildingSelectionStyle();
    this.selectedShadowLayer?.hide?.();
    const source = this.map.getSource(SELECTED_BUILDING_SOURCE);

    if (!source) return;

    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: feature.geometry,
          properties: {
            ...(feature.properties ?? {}),
          },
        },
      ],
    });
  }

  _clearSelectedBuildingFeature() {
    this._hideSelectedBuildingLayers();
    this.selectedShadowLayer?.hide?.();

    const source = this.map.getSource(SELECTED_BUILDING_SOURCE);

    if (!source) return;

    source.setData({
      type: 'FeatureCollection',
      features: [],
    });
  }

  _geometryToBbox(geometry) {
    if (!geometry) return null;

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;

    const visitCoord = (coord) => {
      if (!Array.isArray(coord) || coord.length < 2) return;

      const lng = Number(coord[0]);
      const lat = Number(coord[1]);

      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    };

    const walk = (coords) => {
      if (!Array.isArray(coords)) return;

      if (
        coords.length >= 2 &&
        typeof coords[0] === 'number' &&
        typeof coords[1] === 'number'
      ) {
        visitCoord(coords);
        return;
      }

      for (const c of coords) {
        walk(c);
      }
    };

    walk(geometry.coordinates);

    if (
      !Number.isFinite(minLng) ||
      !Number.isFinite(minLat) ||
      !Number.isFinite(maxLng) ||
      !Number.isFinite(maxLat)
    ) {
      return null;
    }

    return [minLng, minLat, maxLng, maxLat];
  }

  _hideSelectedBuildingLayers() {
    const selectedLayerIds = [
      SELECTED_BUILDING_FILL,
      SELECTED_BUILDING_LINE,
      SELECTED_BUILDING_BOTTOM_LINE,
      SELECTED_BUILDING_HEIGHT_SCAN,
      SELECTED_BUILDING_EXTRUSION,
    ];

    for (const id of selectedLayerIds) {
      if (!this.map?.getLayer(id)) continue;
      try {
        this.map.setLayoutProperty(id, 'visibility', 'none');
      } catch (_) {}
    }

    if (this.map?.getLayer(SELECTED_BUILDING_HEIGHT_SCAN)) {
      try {
        this.map.setPaintProperty(SELECTED_BUILDING_HEIGHT_SCAN, 'fill-extrusion-base', 0);
        this.map.setPaintProperty(SELECTED_BUILDING_HEIGHT_SCAN, 'fill-extrusion-height', 0);
      } catch (_) {}
    }
  }

  _clearSelectionAfterLaserScan() {
    // レーザースキャン終了後は、クリック選択状態を残さず通常表示へ戻す。
    this._clearSelection();
    state.previousCameraState = null;
    this._emit('selectionChange', null);
  }

  goBack() {
    if (!state.previousCameraState) return;

    const prev = state.previousCameraState;

    this.map.easeTo({
      center: prev.center,
      zoom: prev.zoom,
      bearing: prev.bearing,
      pitch: prev.pitch,
      duration: 600,
    });

    this._clearSelection();

    state.previousCameraState = null;

    this._emit('selectionChange', null);
  }

  _clearSelection() {
    this._heightScanStartToken += 1;
    this._clearBuildingActionMenu();
    this._stopSelectedFootprintHeightScan();
    this._clearAltitudeHeightLabel();

    state.activeBuildingLayerMode = null;
    state.selectedBuildingId = null;
    state.selectedFootprintMi = null;
    state.selectedBuildingGeometry = null;
    state.selectedBuildingProperties = null;

    this._clearSelectedBuildingFeature();
    this._hideSelectedBuildingLayers();

    if (this.lod2Layer?.clearMeshSelection) {
      this.lod2Layer.clearMeshSelection();
    }

    if (state.selectedChomeId && this.lod2Layer) {
      this.lod2Layer.clearHighlight();
      state.selectedChomeId = null;
    }

    this._onZoom();
  }

  _findChomeAtLngLat(lng, lat) {
    if (this.lod2Layer?.findChomeAtLngLat) {
      return this.lod2Layer.findChomeAtLngLat(lng, lat);
    }

    for (const entry of this.lod2Layer?._chomeIndex ?? []) {
      const [w, s, e, n] = entry.bbox;

      if (lng >= w && lng <= e && lat >= s && lat <= n) {
        return entry.chome_code;
      }
    }

    return null;
  }

  // ── Event emitter ───────────────────────────────────────────

  on(event, handler) {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }

    this._listeners[event].push(handler);

    return this;
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach((h) => h(data));
  }
}