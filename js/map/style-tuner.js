/**
 * style-tuner.js v13 (Update)
 * - 地図記号（symbol）を非表示
 * - 町名・駅名ラベルを最上層に移動 + 視認性向上のための縁取り(Halo)を追加
 * - 道路レイヤーIDを記憶 → on/off・色・透明度
 * - 暗い line を明るく補正
 */
export class StyleTuner {
  constructor(map) {
    this.map = map;
    this._roadLayerIds = [];
    this._roadColor    = '#b0b8c8';
    this._roadOpacity  = 1.0;
    this._roadVisible  = false;
  }

  apply() {
    const style = this.map.getStyle();
    if (!style || !Array.isArray(style.layers)) return;

    // 最上位に引き上げるレイヤーIDのリスト
    const topLayerIds = [];

    for (const layer of style.layers) {
      const t = JSON.stringify(layer).toLowerCase();

      // 建物を非表示
      if (this._looksLikeGsiBuilding(t)) {
        this._hide(layer.id);
        continue;
      }

      // GSI 道路 fill/line を非表示（symbol は残す）
      if (layer.type !== 'symbol' && this._looksLikeGsiRoad(t)) {
        this._hide(layer.id);
        this._roadLayerIds.push(layer.id);
        continue;
      }

      // symbol レイヤーの処理
      if (layer.type === 'symbol') {
        // 【駅名ラベルの判定】
        const isStationLabel = /station|駅名|駅ラベル/.test(t);
        // 【町名ラベルの判定】
        const isTownLabel = this._looksLikeTownLabel(t);

        if (isStationLabel || isTownLabel) {
          topLayerIds.push(layer.id);
          this._enhanceLabelVisibility(layer.id);
          continue; 
        }

        // 地図記号を非表示（駅名・町名等は除外済み）
        if (this._looksLikeMapSymbol(t)) {
          this._hide(layer.id);
          continue;
        }
        continue;
      }

      // 暗い line を明るく補正
      if (layer.type === 'line') {
        const color = layer.paint?.['line-color'];
        if (typeof color === 'string' && this._isDark(color)) {
          try { this.map.setPaintProperty(layer.id, 'line-color', '#b0b8c8'); } catch (_) {}
        }
      }
    }

    // 重なり順を GLB の上へ持ってくる
    for (const id of topLayerIds) {
      try { this.map.moveLayer(id); } catch (_) {}
    }
  }

  /**
   * ラベルの視認性を高める
   */
  _enhanceLabelVisibility(layerId) {
    try {
      this.map.setPaintProperty(layerId, 'text-halo-color', '#ffffff');
      this.map.setPaintProperty(layerId, 'text-halo-width', 2.0);
      this.map.setPaintProperty(layerId, 'text-color', '#333333');
    } catch (_) {}
  }

  // ── 道路レイヤー操作 API ──────────────────────────────────────

  setRoadVisible(visible) {
    this._roadVisible = visible;
    for (const id of this._roadLayerIds) {
      try {
        this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      } catch (_) {}
    }
    if (visible) this._applyRoadStyle();
    if (this.map) this.map.triggerRepaint();
  }

  setRoadColor(color) {
    if (!color) return;
    this._roadColor = color;
    if (this._roadVisible) this._applyRoadStyle();
    if (this.map) this.map.triggerRepaint();
  }

  setRoadOpacity(opacity) {
    this._roadOpacity = opacity;
    if (this._roadVisible) this._applyRoadStyle();
    if (this.map) this.map.triggerRepaint();
  }

  _applyRoadStyle() {
    for (const id of this._roadLayerIds) {
      try {
        const layer = this.map.getLayer(id);
        if (layer?.type === 'line') {
          this.map.setPaintProperty(id, 'line-color',   this._roadColor);
          this.map.setPaintProperty(id, 'line-opacity', this._roadOpacity);
        } else if (layer?.type === 'fill') {
          this.map.setPaintProperty(id, 'fill-color',   this._roadColor);
          this.map.setPaintProperty(id, 'fill-opacity', this._roadOpacity);
        }
      } catch (_) {}
    }
  }

  // ── 分類ヘルパー ─────────────────────────────────────────────

  _looksLikeGsiBuilding(t) {
    return /building|bldg|建物|普通建物|堅ろう建物|無壁舎|structure/.test(t);
  }

  _looksLikeGsiRoad(t) {
    if (/rail|railway|鉄道|軌道/.test(t)) return false;
    return /road|highway|street|道路|高速|国道|主要地方道|車道|徒歩道/.test(t);
  }

  _looksLikeMapSymbol(t) {
    if (this._looksLikeTownLabel(t)) return false;
    // 駅名を非表示対象から外す
    if (/roadname|road.name|道路名|路線名|鉄道|railway|station|駅名/.test(t)) return false;
    return (
      /symbol|記号|マーク|icon|sprite/.test(t) &&
      !/town|city|machi|chome|丁目|町|市|区|村|字|大字/.test(t)
    ) || /学校|病院|役所|神社|寺院|郵便|消防|警察|図書|博物|交番|駅(?!名)/.test(t);
  }

  _looksLikeTownLabel(t) {
    return /町|丁目|大字|字|chome|machi|oaza/.test(t) ||
           (/city|市|区|村/.test(t) && /label|name|名/.test(t));
  }

  _isDark(colorStr) {
    const m = colorStr.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    if (m) return Number(m[1]) < 150 && Number(m[2]) < 150 && Number(m[3]) < 150;
    const h = colorStr.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (h) return parseInt(h[1], 16) < 150 && parseInt(h[2], 16) < 150 && parseInt(h[3], 16) < 150;
    return false;
  }

  _hide(layerId) {
    try { this.map.setLayoutProperty(layerId, 'visibility', 'none'); } catch (_) {}
  }
}