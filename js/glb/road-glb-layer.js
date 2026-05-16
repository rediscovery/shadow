/**
 * road-glb-layer.js v8
 * - setColor() / setOpacity() 追加
 */

import * as THREE from 'three';
import { GlbLayer } from './glb-layer.js';
import { state } from '../state.js';

const IKEDA_SHARED_ORIGIN  = [135.412500000175, 34.783333333767];
const TRAN_ALTITUDE_METERS = 0.35;
const TRAN_COLOR           = 0x8798a8;

export class RoadGlbLayer extends GlbLayer {
  constructor({ area, areaBase }) {
    super({
      id:       'petiteau-tran-glb',
      origin:   IKEDA_SHARED_ORIGIN,
      altitude: TRAN_ALTITUDE_METERS,
    });

    this.area     = area;
    this.areaBase = areaBase;
    this.metadata = null;
    this._loaded  = false;
    this.minZoom  = 14;

    this._colorHex = '#' + TRAN_COLOR.toString(16).padStart(6, '0');
    this._opacity  = 1.0;
  }

  render(gl, args) {
    if (this.map && this.map.getZoom() < this.minZoom) return;
    super.render(gl, args);
  }

  async init() {
    try {
      const metaUrl = `${this.areaBase}/${this.area.tran_metadata}`;
      const res = await fetch(metaUrl);
      if (res.ok) this.metadata = await res.json();
    } catch (err) {
      console.warn('[RoadGlbLayer] tran metadata not loaded:', err);
    }

    const glbUrl = `${this.areaBase}/${this.area.tran_glb}`;
    try {
      const gltf = await this.loadGlb(glbUrl);
      this._applyRoadMaterial(gltf.scene);
      this._loaded    = true;
      state.tranLoaded = true;
      if (this.map) this.map.triggerRepaint();
    } catch (err) {
      this._loaded    = false;
      state.tranLoaded = false;
      console.warn('[RoadGlbLayer] Failed to load tran GLB:', glbUrl, err);
    }

    return this.metadata;
  }

  isLoaded() { return this._loaded; }

  // ── 公開 API ─────────────────────────────────────────────────

  setColor(hexColor) {
    if (!hexColor) return;
    this._colorHex = hexColor;
    this._updateMaterials();
    if (this.map) this.map.triggerRepaint();
  }

  setOpacity(opacity) {
    this._opacity = Math.max(0, Math.min(1, Number(opacity)));
    this._updateMaterials();
    if (this.map) this.map.triggerRepaint();
  }

  // ── 内部 ─────────────────────────────────────────────────────

  _hexToInt(hex) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3
      ? h.split('').map(c => c + c).join('') : h, 16);
    return isFinite(n) ? n : TRAN_COLOR;
  }

  _makeMaterial() {
    return new THREE.MeshBasicMaterial({
      color:       this._hexToInt(this._colorHex),
      side:        THREE.DoubleSide,
      transparent: this._opacity < 1.0,
      opacity:     this._opacity,
      depthTest:   true,
      depthWrite:  true,
    });
  }

  _applyRoadMaterial(root) {
    const mat = this._makeMaterial();
    root.traverse((obj) => {
      obj.frustumCulled = true;
      obj.renderOrder   = 1;
      if (!obj.isMesh) return;
      obj.castShadow    = false;
      obj.receiveShadow = false;
      this._disposeMesh(obj);
      obj.material = mat.clone();
    });
  }

  _updateMaterials() {
    if (!this._model) return;
    this._model.traverse((obj) => {
      if (!obj.isMesh) return;
      const m = obj.material;
      if (!m) return;
      m.color.setHex(this._hexToInt(this._colorHex));
      m.opacity     = this._opacity;
      m.transparent = this._opacity < 1.0;
      m.needsUpdate = true;
    });
  }

  _disposeMesh(obj) {
    const oldMats = Array.isArray(obj.material) ? obj.material : [obj.material];
    oldMats.forEach((m) => {
      if (!m) return;
      ['map','normalMap','roughnessMap','metalnessMap','emissiveMap',
       'aoMap','lightMap','bumpMap','specularMap','envMap'].forEach((slot) => {
        if (m[slot]) m[slot].dispose?.();
      });
      m.dispose?.();
    });
  }
}