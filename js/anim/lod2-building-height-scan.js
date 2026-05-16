/**
 * lod2-building-height-scan.js
 *
 * Selected LOD2 building height-scan visualizer.
 *
 * Current responsibility:
 * - Scan one selected LOD2 building from highest Y to lowest Y in a fixed duration.
 * - Roof meshes: bright turquoise 0.1 m scan band.
 * - Wall meshes: slightly darker turquoise 0.1 m scan band.
 *
 * Future extension point:
 * - The same selected-mesh collection and Y sweep can be used for
 *   height-by-height section / floor-area analysis.
 */
import * as THREE from 'three';

const DEFAULT_DURATION_MS = 6000;
const DEFAULT_BAND_WIDTH_M = 0.1;
const DEFAULT_ROOF_COLOR = 0xffffff;
const DEFAULT_WALL_COLOR = 0xcfffff;

const vertexShader = `
  varying vec3 vWorldPosition;

  void main() {
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float uScanY;
  uniform float uBandWidth;
  uniform float uKind;
  uniform vec3 uRoofColor;
  uniform vec3 uWallColor;
  uniform float uOpacity;

  varying vec3 vWorldPosition;

  void main() {
    float distY = uScanY - vWorldPosition.y;

    if (distY < 0.0 || distY > uBandWidth) {
      discard;
    }

    vec3 color = uKind > 1.5 ? uRoofColor : uWallColor;
    gl_FragColor = vec4(color, uOpacity);
  }
`;

function meshKind(mesh) {
  const text = `${mesh?.name || ''} ${mesh?.parent?.name || ''}`.toLowerCase();

  if (text.includes('roof') || text.includes('roofs')) return 'roof';
  if (text.includes('wall') || text.includes('walls')) return 'wall';

  return 'body';
}

function validScanMesh(mesh) {
  if (!mesh?.isMesh || !mesh.geometry) return false;
  const kind = meshKind(mesh);
  // roof / wall / body を同じ scan session に入れる。
  // body や detail 名の mesh しか拾えない GLB でも、建物全体を地面まで走査する。
  return kind === 'roof' || kind === 'wall' || kind === 'body';
}

function normalizeThreeColor(value, fallback) {
  if (value instanceof THREE.Color) return value.clone();

  if (typeof value === 'string') {
    try {
      return new THREE.Color(value);
    } catch (_) {
      return new THREE.Color(fallback);
    }
  }

  const n = Number(value);
  return Number.isFinite(n)
    ? new THREE.Color(n)
    : new THREE.Color(fallback);
}

export class Lod2BuildingHeightScan {
  constructor({
    map = null,
    durationMs = DEFAULT_DURATION_MS,
    bandWidthM = DEFAULT_BAND_WIDTH_M,
    roofColor = DEFAULT_ROOF_COLOR,
    wallColor = DEFAULT_WALL_COLOR,
  } = {}) {
    this.map = map;

    this.durationMs = durationMs;
    this.bandWidthM = bandWidthM;
    this.roofColor = normalizeThreeColor(roofColor, DEFAULT_ROOF_COLOR);
    this.wallColor = normalizeThreeColor(wallColor, DEFAULT_WALL_COLOR);

    this._overlays = [];
    this._rafId = null;
    this._runToken = 0;
    this._active = false;
    this._bounds = null;
    this._scanY = null;
  }

  get active() {
    return this._active;
  }

  get currentY() {
    return this._scanY;
  }

  get bounds() {
    return this._bounds
      ? {
          minY: this._bounds.min.y,
          maxY: this._bounds.max.y,
        }
      : null;
  }

  /**
   * Future analysis hook:
   * return the currently selected building scan range in GLB-local meters.
   */
  getScanRange() {
    return this.bounds;
  }

  start(meshes, {
    durationMs = this.durationMs,
    bandWidthM = this.bandWidthM,
    roofColor = this.roofColor,
    wallColor = this.wallColor,
    scanColor = null,
    onComplete = null,
  } = {}) {
    this.stop();

    const targets = (Array.isArray(meshes) ? meshes : [])
      .filter(validScanMesh);

    if (!targets.length) return false;

    const bounds = this._computeBounds(targets);

    if (!bounds || bounds.isEmpty()) return false;

    this._bounds = bounds;
    this.durationMs = Math.max(1, Number(durationMs) || DEFAULT_DURATION_MS);
    this.bandWidthM = Math.max(0.001, Number(bandWidthM) || DEFAULT_BAND_WIDTH_M);

    if (scanColor !== null && scanColor !== undefined) {
      this.roofColor = normalizeThreeColor(scanColor, DEFAULT_ROOF_COLOR);
      this.wallColor = normalizeThreeColor(scanColor, DEFAULT_WALL_COLOR);
    } else {
      this.roofColor = normalizeThreeColor(roofColor, DEFAULT_ROOF_COLOR);
      this.wallColor = normalizeThreeColor(wallColor, DEFAULT_WALL_COLOR);
    }

    this._overlays = targets
      .map((mesh) => this._createOverlay(mesh))
      .filter(Boolean);

    if (!this._overlays.length) {
      this._bounds = null;
      return false;
    }

    this._active = true;
    const token = ++this._runToken;
    let startTime = null;

    const tick = (now) => {
      if (!this._active || token !== this._runToken) return;

      if (startTime === null) startTime = now;

      const elapsed = Math.max(0, now - startTime);
      const progress = Math.min(1, elapsed / this.durationMs);
      const maxY = this._bounds.max.y;
      const minY = this._bounds.min.y;

      this._scanY = maxY - (maxY - minY) * progress;
      this._setScanY(this._scanY);

      if (this.map) this.map.triggerRepaint();

      if (progress < 1) {
        this._rafId = requestAnimationFrame(tick);
      } else {
        this._active = false;
        this._rafId = null;
        this._removeOverlays();
        if (this.map) this.map.triggerRepaint();

        if (typeof onComplete === 'function') {
          onComplete({
            minY,
            maxY,
            durationMs: this.durationMs,
          });
        }
      }
    };

    this._rafId = requestAnimationFrame(tick);
    if (this.map) this.map.triggerRepaint();

    return true;
  }

  stop() {
    this._runToken += 1;
    this._active = false;

    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    this._removeOverlays();
    this._bounds = null;
    this._scanY = null;

    if (this.map) this.map.triggerRepaint();
  }

  setStyle({
    bandWidthM,
    roofColor,
    wallColor,
    scanColor,
  } = {}) {
    if (bandWidthM !== undefined) {
      this.bandWidthM = Math.max(0.001, Number(bandWidthM) || DEFAULT_BAND_WIDTH_M);
    }

    if (scanColor !== undefined && scanColor !== null) {
      this.roofColor = normalizeThreeColor(scanColor, DEFAULT_ROOF_COLOR);
      this.wallColor = normalizeThreeColor(scanColor, DEFAULT_WALL_COLOR);
    } else {
      if (roofColor !== undefined) {
        this.roofColor = normalizeThreeColor(roofColor, DEFAULT_ROOF_COLOR);
      }

      if (wallColor !== undefined) {
        this.wallColor = normalizeThreeColor(wallColor, DEFAULT_WALL_COLOR);
      }
    }

    for (const overlay of this._overlays) {
      const uniforms = overlay.material?.uniforms;
      if (!uniforms) continue;
      if (uniforms.uBandWidth) uniforms.uBandWidth.value = this.bandWidthM;
      if (uniforms.uRoofColor) uniforms.uRoofColor.value.copy(this.roofColor);
      if (uniforms.uWallColor) uniforms.uWallColor.value.copy(this.wallColor);
    }

    if (this.map) this.map.triggerRepaint();
  }

  _computeBounds(meshes) {
    const whole = new THREE.Box3();
    const box = new THREE.Box3();
    let hasBox = false;

    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      box.setFromObject(mesh);

      if (box.isEmpty()) continue;

      if (!hasBox) {
        whole.copy(box);
        hasBox = true;
      } else {
        whole.union(box);
      }
    }

    return hasBox ? whole : null;
  }

  _createOverlay(mesh) {
    const kind = meshKind(mesh);

    if (kind !== 'roof' && kind !== 'wall' && kind !== 'body') return null;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uScanY: { value: this._bounds.max.y },
        uBandWidth: { value: this.bandWidthM },
        // roof だけ明るく、wall/body は壁色で表示する。
        // uScanY は全 overlay で共通なので、屋根から地面まで1本で流れる。
        uKind: { value: kind === 'roof' ? 2.0 : 1.0 },
        uRoofColor: { value: this.roofColor.clone() },
        uWallColor: { value: this.wallColor.clone() },
        uOpacity: { value: 1.0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      // 手前の別建物を突き抜けて白ラインが見えないよう、
      // スキャン帯は通常の depth test に従わせる。
      // depthWrite は切り、スキャン線自体が後続描画を塞がないようにする。
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    const overlay = new THREE.Mesh(mesh.geometry.clone(), material);
    overlay.name = `petiteau-height-scan-${kind}-overlay`;
    overlay.renderOrder = 10000;
    overlay.frustumCulled = false;

    mesh.add(overlay);

    return overlay;
  }

  _setScanY(y) {
    for (const overlay of this._overlays) {
      const uniforms = overlay.material?.uniforms;
      if (uniforms?.uScanY) uniforms.uScanY.value = y;
      if (uniforms?.uBandWidth) uniforms.uBandWidth.value = this.bandWidthM;
    }
  }

  _removeOverlays() {
    for (const overlay of this._overlays) {
      if (overlay.parent) overlay.parent.remove(overlay);
      overlay.geometry?.dispose();
      overlay.material?.dispose?.();
    }

    this._overlays = [];
  }
}
