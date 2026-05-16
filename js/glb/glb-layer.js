/**
 * glb-layer.js v2
 * - setOriginOffset(dLon, dLat) 追加
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class GlbLayer {
  constructor({ id, origin, altitude = 0 }) {
    this.id       = id;
    this.type     = 'custom';
    this.renderingMode = '3d';

    this.origin   = origin;
    this.altitude = altitude;

    this.map      = null;
    this.scene    = null;
    this.camera   = null;
    this.renderer = null;

    this._model   = null;
    this._visible = true;
    this._transform = null;
    this._dLon    = 0;
    this._dLat    = 0;

    this._loader  = new GLTFLoader();
  }

  // ── MapLibre lifecycle ─────────────────────────────────────────

  onAdd(map, gl) {
    this.map    = map;
    this.scene  = new THREE.Scene();
    this.camera = new THREE.Camera();

    this.renderer = new THREE.WebGLRenderer({
      canvas:    map.getCanvas(),
      context:   gl,
      antialias: true,
    });
    this.renderer.autoClear       = false;
    this.renderer.shadowMap.enabled = false;

    this._buildTransform();
  }

  render(gl, args) {
    if (!this._visible || !this.scene.children.length) return;

    const matrix = args.projectionMatrix ?? args;
    const { translateX: tx, translateY: ty, translateZ: tz, scale } = this._transform;

    const rotX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const modelMatrix = new THREE.Matrix4()
      .makeTranslation(tx, ty, tz)
      .scale(new THREE.Vector3(scale, -scale, scale))
      .multiply(rotX);

    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(modelMatrix);

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  onRemove() {
    if (this._model) {
      this._disposeObject(this._model);
      this.scene.remove(this._model);
      this._model = null;
    }
  }

  // ── 公開 API ──────────────────────────────────────────────────

  setVisible(visible) {
    this._visible = visible;
    if (this.map) this.map.triggerRepaint();
  }

  /**
   * 原点補正 Δlon / Δlat（度単位）
   */
  setOriginOffset(dLon, dLat) {
    this._dLon = Number(dLon) || 0;
    this._dLat = Number(dLat) || 0;
    this._buildTransform();
    if (this.map) this.map.triggerRepaint();
  }

  loadGlb(url) {
    return new Promise((resolve, reject) => {
      this._loader.load(
        url,
        (gltf) => {
          if (this._model) {
            this._disposeObject(this._model);
            this.scene.remove(this._model);
          }
          this._model = gltf.scene;
          this._configureModel(this._model);
          this.scene.add(this._model);
          if (this.map) this.map.triggerRepaint();
          resolve(gltf);
        },
        undefined,
        reject,
      );
    });
  }

  // ── 内部 ──────────────────────────────────────────────────────

  _buildTransform() {
    const lng = this.origin[0] + this._dLon;
    const lat = this.origin[1] + this._dLat;
    const mc  = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], this.altitude);
    this._transform = {
      translateX: mc.x,
      translateY: mc.y,
      translateZ: mc.z,
      scale:      mc.meterInMercatorCoordinateUnits(),
    };
  }

  _configureModel(root) {
    root.traverse((obj) => {
      obj.frustumCulled = true;
      if (obj.isMesh) {
        obj.castShadow    = false;
        obj.receiveShadow = false;
      }
    });
  }

  _disposeObject(object) {
    object.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.geometry?.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (!m) return;
        ['map','normalMap','roughnessMap','metalnessMap','emissiveMap',
         'aoMap','lightMap','bumpMap','specularMap','envMap'].forEach((slot) => {
          m[slot]?.dispose();
        });
        m.dispose();
      });
    });
  }
}