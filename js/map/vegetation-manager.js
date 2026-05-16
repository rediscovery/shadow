/**
 * vegetation-manager.js v2
 * - setGreenColor() / setSchoolColor() 追加
 * - SVGパターンをベース色から自動生成
 */
import { state } from '../state.js';

export const LUSE_SOURCE_ID           = 'petiteau-luse-green-surface';
export const LUSE_GREEN_FILL_LAYER    = 'petiteau-luse-green-fill';
export const LUSE_GREEN_PATTERN_LAYER = 'petiteau-luse-green-pattern';
export const LUSE_GREEN_OUTLINE_LAYER = 'petiteau-luse-green-outline';
export const LUSE_SCHOOL_FILL_LAYER    = 'petiteau-luse-schoolyard-fill';
export const LUSE_SCHOOL_PATTERN_LAYER = 'petiteau-luse-schoolyard-pattern';
export const LUSE_SCHOOL_OUTLINE_LAYER = 'petiteau-luse-schoolyard-outline';

const GREEN_PATTERN_IMAGE  = 'petiteau-park-svg-pattern';
const SCHOOL_PATTERN_IMAGE = 'petiteau-schoolyard-svg-pattern';

const GREEN_CLASSES  = ['park','green','grass','forest','wood','garden','cemetery','farmland'];
const SCHOOL_CLASSES = ['school','pitch','schoolyard','ground','school_ground','playground','校庭','グラウンド','学校'];

const CLASS_VALUE_EXPR = [
  'downcase', ['to-string', ['coalesce',
    ['get','petiteau_class'], ['get','class'], ['get','category'],
    ['get','type'], ['get','kind'], ['get','subclass'], 'unknown'
  ]]
];

const GREEN_FILTER  = ['match', CLASS_VALUE_EXPR, GREEN_CLASSES,  true, false];
const SCHOOL_FILTER = ['match', CLASS_VALUE_EXPR, SCHOOL_CLASSES, true, false];

// ── 色ユーティリティ ──────────────────────────────────────────

function _hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3
    ? h.split('').map(c => parseInt(c + c, 16))
    : [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  return n;
}

function _rgbToHex(r, g, b) {
  return '#' + [r,g,b].map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
}

/** 色を factor 倍明るく/暗く（factor < 1 = 暗く） */
function _scaleColor(hex, factor) {
  const [r,g,b] = _hexToRgb(hex);
  return _rgbToHex(r*factor, g*factor, b*factor);
}

/** 色を白方向に blend (ratio = 0〜1, 1=白) */
function _lighten(hex, ratio) {
  const [r,g,b] = _hexToRgb(hex);
  return _rgbToHex(r + (255-r)*ratio, g + (255-g)*ratio, b + (255-b)*ratio);
}

// ─────────────────────────────────────────────────────────────

export class VegetationManager {
  constructor(map) {
    this.map = map;
    this.meta = null;
    this._opacity          = 0.65;
    this._greenVisible     = true;
    this._schoolyardVisible = true;
    this._outlineVisible   = true;
    this._greenColor       = '#1ba66c';
    this._schoolColor      = '#c8ad6a';
  }

  async load(area, areaBase) {
    const base       = `${areaBase}/luse/${area.city_code}_${area.city_slug}`;
    const geojsonUrl = `${base}_luse_green_surface.geojson`;
    const metaUrl    = `${base}_luse_green_surface_meta.json`;

    try {
      const res = await fetch(metaUrl);
      if (res.ok) this.meta = await res.json();
    } catch (err) {
      console.warn('[VegetationManager] meta load skipped:', err);
    }

    this._removeLayers();
    await this._ensureSvgPatternImages();

    this.map.addSource(LUSE_SOURCE_ID, { type: 'geojson', data: geojsonUrl });

    const insertBefore = this._findInsertionLayer();

    // 公園・緑地
    this.map.addLayer({
      id: LUSE_GREEN_FILL_LAYER, type: 'fill', source: LUSE_SOURCE_ID,
      filter: GREEN_FILTER,
      layout: { visibility: this._greenVisible ? 'visible' : 'none' },
      paint:  { 'fill-color': this._greenColor, 'fill-opacity': this._opacity },
    }, insertBefore);

    this.map.addLayer({
      id: LUSE_GREEN_PATTERN_LAYER, type: 'fill', source: LUSE_SOURCE_ID,
      filter: GREEN_FILTER,
      layout: { visibility: this._greenVisible ? 'visible' : 'none' },
      paint:  { 'fill-pattern': GREEN_PATTERN_IMAGE, 'fill-opacity': Math.min(1, this._opacity * 0.90) },
    }, insertBefore);

    this.map.addLayer({
      id: LUSE_GREEN_OUTLINE_LAYER, type: 'line', source: LUSE_SOURCE_ID,
      filter: GREEN_FILTER,
      layout: { visibility: (this._greenVisible && this._outlineVisible) ? 'visible' : 'none' },
      paint:  { 'line-color': this._greenColor, 'line-width': 0.6, 'line-opacity': 0.45 },
    }, insertBefore);

    // 校庭・グラウンド
    this.map.addLayer({
      id: LUSE_SCHOOL_FILL_LAYER, type: 'fill', source: LUSE_SOURCE_ID,
      filter: SCHOOL_FILTER,
      layout: { visibility: this._schoolyardVisible ? 'visible' : 'none' },
      paint:  { 'fill-color': this._schoolColor, 'fill-opacity': this._opacity },
    }, insertBefore);

    this.map.addLayer({
      id: LUSE_SCHOOL_PATTERN_LAYER, type: 'fill', source: LUSE_SOURCE_ID,
      filter: SCHOOL_FILTER,
      layout: { visibility: this._schoolyardVisible ? 'visible' : 'none' },
      paint:  { 'fill-pattern': SCHOOL_PATTERN_IMAGE, 'fill-opacity': Math.min(1, this._opacity * 0.85) },
    }, insertBefore);

    this.map.addLayer({
      id: LUSE_SCHOOL_OUTLINE_LAYER, type: 'line', source: LUSE_SOURCE_ID,
      filter: SCHOOL_FILTER,
      layout: { visibility: (this._schoolyardVisible && this._outlineVisible) ? 'visible' : 'none' },
      paint:  { 'line-color': this._schoolColor, 'line-width': 0.6, 'line-opacity': 0.45 },
    }, insertBefore);

    return this.meta;
  }

  // ── 公開 API ──────────────────────────────────────────────────

  setGreenVisible(visible) {
    this._greenVisible = visible;
    state.luseGreenEnabled = visible;
    this._applyVisibility();
  }

  setSchoolyardVisible(visible) {
    this._schoolyardVisible = visible;
    this._applyVisibility();
  }

  setVisible(visible) {
    this.setGreenVisible(visible);
    this.setSchoolyardVisible(visible);
  }

  setOpacity(opacity) {
    this._opacity = opacity;
    [
      [LUSE_GREEN_FILL_LAYER,    opacity],
      [LUSE_GREEN_PATTERN_LAYER, Math.min(1, opacity * 0.90)],
      [LUSE_SCHOOL_FILL_LAYER,   opacity],
      [LUSE_SCHOOL_PATTERN_LAYER,Math.min(1, opacity * 0.85)],
    ].forEach(([id, value]) => {
      if (this.map.getLayer(id)) this.map.setPaintProperty(id, 'fill-opacity', value);
    });
  }

  /** 公園・緑地 ベース色変更 */
  async setGreenColor(color) {
    if (!color) return;
    this._greenColor = color;
    if (this.map.getLayer(LUSE_GREEN_FILL_LAYER))
      this.map.setPaintProperty(LUSE_GREEN_FILL_LAYER, 'fill-color', color);
    if (this.map.getLayer(LUSE_GREEN_OUTLINE_LAYER))
      this.map.setPaintProperty(LUSE_GREEN_OUTLINE_LAYER, 'line-color', color);
    // SVGパターンを色に合わせて更新
    await this._updateGreenPattern();
  }

  /** 校庭・グラウンド ベース色変更 */
  async setSchoolColor(color) {
    if (!color) return;
    this._schoolColor = color;
    if (this.map.getLayer(LUSE_SCHOOL_FILL_LAYER))
      this.map.setPaintProperty(LUSE_SCHOOL_FILL_LAYER, 'fill-color', color);
    if (this.map.getLayer(LUSE_SCHOOL_OUTLINE_LAYER))
      this.map.setPaintProperty(LUSE_SCHOOL_OUTLINE_LAYER, 'line-color', color);
    // SVGパターンを色に合わせて更新
    await this._updateSchoolPattern();
  }

  setOutlineVisible(visible) {
    this._outlineVisible = visible;
    this._applyVisibility();
  }

  getFeatureCount() {
    return this.meta?.feature_count ?? null;
  }

  // ── 内部 ──────────────────────────────────────────────────────

  _applyVisibility() {
    const pairs = [
      [LUSE_GREEN_FILL_LAYER,    this._greenVisible],
      [LUSE_GREEN_PATTERN_LAYER, this._greenVisible],
      [LUSE_GREEN_OUTLINE_LAYER, this._greenVisible && this._outlineVisible],
      [LUSE_SCHOOL_FILL_LAYER,   this._schoolyardVisible],
      [LUSE_SCHOOL_PATTERN_LAYER,this._schoolyardVisible],
      [LUSE_SCHOOL_OUTLINE_LAYER,this._schoolyardVisible && this._outlineVisible],
    ];
    pairs.forEach(([id, visible]) => {
      if (this.map.getLayer(id))
        this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    });
  }

  _removeLayers() {
    [
      LUSE_SCHOOL_OUTLINE_LAYER, LUSE_SCHOOL_PATTERN_LAYER, LUSE_SCHOOL_FILL_LAYER,
      LUSE_GREEN_OUTLINE_LAYER,  LUSE_GREEN_PATTERN_LAYER,  LUSE_GREEN_FILL_LAYER,
    ].forEach((id) => { if (this.map.getLayer(id)) this.map.removeLayer(id); });
    if (this.map.getSource(LUSE_SOURCE_ID)) this.map.removeSource(LUSE_SOURCE_ID);
  }

  async _ensureSvgPatternImages() {
    // 初回は強制追加（既存は削除してから）
    if (this.map.hasImage(GREEN_PATTERN_IMAGE))  this.map.removeImage(GREEN_PATTERN_IMAGE);
    if (this.map.hasImage(SCHOOL_PATTERN_IMAGE)) this.map.removeImage(SCHOOL_PATTERN_IMAGE);
    await Promise.all([
      this._addSvgPatternImage(GREEN_PATTERN_IMAGE,  this._parkPatternSvg(this._greenColor)),
      this._addSvgPatternImage(SCHOOL_PATTERN_IMAGE, this._schoolyardPatternSvg(this._schoolColor)),
    ]);
  }

  async _updateGreenPattern() {
    await this._replaceSvgPatternImage(GREEN_PATTERN_IMAGE, this._parkPatternSvg(this._greenColor));
    // fill-pattern を一度 null にしてから再設定（MapLibre のキャッシュ対策）
    if (this.map.getLayer(LUSE_GREEN_PATTERN_LAYER)) {
      this.map.setPaintProperty(LUSE_GREEN_PATTERN_LAYER, 'fill-pattern', null);
      this.map.setPaintProperty(LUSE_GREEN_PATTERN_LAYER, 'fill-pattern', GREEN_PATTERN_IMAGE);
    }
  }

  async _updateSchoolPattern() {
    await this._replaceSvgPatternImage(SCHOOL_PATTERN_IMAGE, this._schoolyardPatternSvg(this._schoolColor));
    if (this.map.getLayer(LUSE_SCHOOL_PATTERN_LAYER)) {
      this.map.setPaintProperty(LUSE_SCHOOL_PATTERN_LAYER, 'fill-pattern', null);
      this.map.setPaintProperty(LUSE_SCHOOL_PATTERN_LAYER, 'fill-pattern', SCHOOL_PATTERN_IMAGE);
    }
  }

  async _replaceSvgPatternImage(name, svgText) {
    if (this.map.hasImage(name)) this.map.removeImage(name);
    await this._addSvgPatternImage(name, svgText);
  }

  _addSvgPatternImage(name, svgText) {
    if (this.map.hasImage(name)) return Promise.resolve();
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
    return new Promise((resolve, reject) => {
      const img = new Image(32, 32);
      img.onload = () => {
        try {
          if (!this.map.hasImage(name)) this.map.addImage(name, img, { pixelRatio: 1 });
          resolve();
        } catch (err) { reject(err); }
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  /**
   * 公園パターン: ベース色の暗めのノイズ
   */
  _parkPatternSvg(baseColor) {
    const dark1 = _scaleColor(baseColor, 0.45);
    const dark2 = _scaleColor(baseColor, 0.35);
    const dark3 = _scaleColor(baseColor, 0.55);
    const hi    = _lighten(baseColor, 0.25);
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="none"/>
  <circle cx="4"  cy="6"  r="1.0" fill="${dark1}" opacity="0.20"/>
  <circle cx="17" cy="4"  r="0.9" fill="${dark2}" opacity="0.22"/>
  <circle cx="28" cy="10" r="1.2" fill="${dark3}" opacity="0.18"/>
  <circle cx="9"  cy="23" r="1.0" fill="${dark1}" opacity="0.20"/>
  <circle cx="25" cy="25" r="1.4" fill="${dark2}" opacity="0.17"/>
  <circle cx="14" cy="28" r="0.9" fill="${dark3}" opacity="0.19"/>
  <path d="M6 15l4-2M13 18l5 1M21 14l4-3M2 29l5-1M18 30l4-2"
        stroke="${dark1}" stroke-width="0.8" stroke-linecap="round" opacity="0.22"/>
  <path d="M3 11l3 1M12 8l4-1M23 18l5 1M8 30l3-2"
        stroke="${dark2}" stroke-width="0.7" stroke-linecap="round" opacity="0.18"/>
  <path d="M9 7l2 1M19 11l2-1M26 21l2 1"
        stroke="${hi}"   stroke-width="0.45" stroke-linecap="round" opacity="0.10"/>
</svg>`;
  }

  /**
   * 校庭パターン: ベース色の明るめ（粉っぽい）ノイズ
   */
  _schoolyardPatternSvg(baseColor) {
    const light1 = _lighten(baseColor, 0.55);
    const light2 = _lighten(baseColor, 0.40);
    const dark1  = _scaleColor(baseColor, 0.75);
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="none"/>
  <circle cx="5"  cy="5"  r="0.8" fill="${light1}" opacity="0.22"/>
  <circle cx="13" cy="7"  r="0.65" fill="${light2}" opacity="0.18"/>
  <circle cx="24" cy="4"  r="0.75" fill="${light1}" opacity="0.20"/>
  <circle cx="28" cy="15" r="0.7"  fill="${light2}" opacity="0.18"/>
  <circle cx="7"  cy="19" r="0.9"  fill="${light1}" opacity="0.17"/>
  <circle cx="18" cy="22" r="0.7"  fill="${light2}" opacity="0.20"/>
  <circle cx="27" cy="28" r="0.8"  fill="${light1}" opacity="0.16"/>
  <circle cx="10" cy="27" r="0.7"  fill="${light2}" opacity="0.18"/>
  <path d="M3 12h6M12 15h8M20 10h5M6 27h8M18 29h7"
        stroke="${light1}" stroke-width="0.65" stroke-linecap="round" opacity="0.18"/>
  <path d="M2 24h5M10 25h9M22 21h6"
        stroke="${dark1}"  stroke-width="0.55" stroke-linecap="round" opacity="0.12"/>
</svg>`;
  }

  _findInsertionLayer() {
    const style = this.map.getStyle();
    if (!style?.layers) return undefined;
    const keywords = ['road','tunnel','building','bldg','highway'];
    for (const layer of style.layers) {
      const id = String(layer.id || '').toLowerCase();
      if (keywords.some((kw) => id.includes(kw))) return layer.id;
    }
    return undefined;
  }
}