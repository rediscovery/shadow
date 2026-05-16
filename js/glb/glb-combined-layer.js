/**
 * glb-combined-layer.js v20 cyber shadow trial
 * - LOD2 hollow GLB 用 Three.js custom layer
 * - MeshLambertMaterial 維持
 * - cyber lighting + zoom19以上PC限定 shadow trial
 * - FrontSide 維持
 * - 太陽光 DirectionalLight
 * - 青い補助光 FillLight
 * - LOD2 mesh raycast 選択対応
 * - roof / wall / body mesh 単位で選択可能
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { state } from '../state.js';
import { Lod2BuildingHeightScan } from '../anim/lod2-building-height-scan.js';

const IKEDA_SHARED_ORIGIN = [135.412500000175, 34.783333333767];

// FPS ガード: この値を下回ると shadow / footprint mesh を強制 OFF にする。
const MIN_SHADOW_FPS_THRESHOLD = 20;
// shadow camera の最小・最大距離 (meters)。
const SHADOW_CAM_MIN_D = 100;
const SHADOW_CAM_MAX_D = 1200;
// デフォルト建物高さ (m) / ExtrudeGeometry の最小奥行き (m)
const DEFAULT_BUILDING_HEIGHT_M = 10;
const MIN_EXTRUSION_DEPTH_M = 0.5;

export class GlbCombinedLayer {
  constructor({ areaBase, sharedOrigin = IKEDA_SHARED_ORIGIN }) {
    this.id            = 'petiteau-lod2-hollow';
    this.type          = 'custom';
    this.renderingMode = '3d';

    this.areaBase     = areaBase;
    this.sharedOrigin = sharedOrigin;

    this.map      = null;
    this.scene    = null;
    this.camera   = null;
    this.renderer = null;

    this._chomeIndex    = [];
    this._loaded        = new Map();
    this._loading       = new Set();
    this._pendingUnload = new Map();

    this._visible          = true;
    this._transform        = null;
    this._highlightedChome = null;

    // LOD2 roof/body 色
    this._buildingColorHex = '#fcfcfc';

    // LOD2 wall 色
    this._wallColorHex = '#ededf3';

    // LOD2 通常表示 material 調整。
    // 屋根/壁ごとの太陽光は、Three.js の単一ライトでは分離できないため、
    // material 色の明度係数として疑似的に反映する。
    this._lod2RoofSunStrength = 0.96;
    this._lod2WallSunStrength = 0.65;
    this._lod2Opacity = 1.0;
    this._lod2AmbientColorHex = '#ffffff';
    this._lod2AmbientStrength = 1.00;

    this._dLon = 0;
    this._dLat = 0;

    // 太陽光
    this._sunAzimuth   = 144;
    this._sunElevation = 54;

    // Petiteau 側では map-app.js から上書きされる
    this._sunIntensity = 0.51;

    // 環境光
    this._ambientIntensity = 1.50;

    // 青い補助光
    this._fillIntensity = 2.00;
    this._fillColorHex = '#fcfdfd';

    // サイバー感のための低コストな紫リムライト。
    this._rimFillIntensity = 1.20;
    this._rimFillColorHex = '#7790f3';

    // v26: shadow map は重いので、PCかつ zoom19以上だけ試験的に有効化する。
    this._shadowMapEnabled = true;
    this._shadowMinZoom = 19.0;
    this._shadowMapSize = 2048;
    this._shadowCameraSize = 2600;
    this._shadowActive = false;
    this._isMobileRuntime = (typeof window !== 'undefined') && (
      window.innerWidth <= 720 ||
      /iPhone|iPad|iPod|Android/i.test(window.navigator?.userAgent || '')
    );

    // shadow を出すため、通常時の自己発光は抑える。
    // 選択中だけは視認性維持のため少し上げる。
    this._emissiveIntensity = 0.06;

    this._ambientLight     = null;
    this._directionalLight = null;
    this._fillLight        = null;
    this._rimFillLight     = null;

    this.UNLOAD_DELAY = 10000;
    this.minZoom      = 15.6;

    this._loader = new GLTFLoader();

    // LOD2 mesh raycast 用
    this._raycaster = new THREE.Raycaster();
    this._pointerNdc = new THREE.Vector2();
    this._rayNear = new THREE.Vector3();
    this._rayFar = new THREE.Vector3();
    this._rayDirection = new THREE.Vector3();
    this._selectedMesh = null;
    this._selectedMeshOverlay = null;
    this._selectedBuildingOverlays = [];
    this._selectedBuildingMeshes = [];
    this._selectedMaterialBackups = [];

    // LOD2 1棟選択表示。Footprint 3D の透明水色に寄せる。
    // overlay を重ねるのではなく、選択中 mesh の material を一時的に透明化する。
    // roof/body と wall で色を分け、Footprint 3D と同じく壁を少し暗く見せる。
    this._selectionOverlayColor = 0x00f0ee;
    this._selectionOverlayWallColor = 0x00c8c8;
    this._selectionOverlayOpacity = 0.48;
    this._selectionOverlayWallOpacity = 0.46;

    // 選択建物専用の高さ走査。
    // 将来は高さ別断面 / 床面積解析の表示基盤として拡張する。
    this._heightScan = new Lod2BuildingHeightScan();

    const scanDefaultIsMobile =
      typeof window !== 'undefined' &&
      window.innerWidth <= 720;

    // レーザースキャン幅の初期値:
    // PC = 0.2m / mobile = 0.3m
    this._heightScanBandWidthM = scanDefaultIsMobile ? 0.3 : 0.2;
    this._heightScanColor = '#ffffff';

    this._boundUpdateViewport = () => this._updateViewport();
  }

  // ── MapLibre lifecycle ─────────────────────────────────────────

  onAdd(map, gl) {
    this.map    = map;
    this.scene  = new THREE.Scene();
    this.camera = new THREE.Camera();

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });

    this.renderer.autoClear = false;

    // shadow map は PC + zoom19 以上のみ render 時に動的ON。
    // 初期状態はOFFにして、低zoom/mobileの負荷を避ける。
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // MapLibre 上でも色が沈みにくいよう SRGBColorSpace
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    if (this._heightScan) {
      this._heightScan.map = map;
    }

    // 環境光
    this._ambientLight = new THREE.AmbientLight(
      this._hexToThreeColor(this._lod2AmbientColorHex),
      this._ambientIntensity * this._lod2AmbientStrength,
    );
    this.scene.add(this._ambientLight);

    // 主太陽光
    this._directionalLight = new THREE.DirectionalLight(
      0xffffff,
      this._sunIntensity,
    );
    this._directionalLight.castShadow = false;
    this._configureShadowLight();
    this.scene.add(this._directionalLight);

    // 青い補助光
    this._fillLight = new THREE.DirectionalLight(
      this._hexToThreeColor(this._fillColorHex),
      this._fillIntensity,
    );
    this._fillLight.castShadow = false;
    this.scene.add(this._fillLight);

    this._rimFillLight = new THREE.DirectionalLight(
      this._hexToThreeColor(this._rimFillColorHex),
      this._rimFillIntensity,
    );
    this._rimFillLight.castShadow = false;
    this.scene.add(this._rimFillLight);

    this._updateLightPosition();

    this._buildTransform();

    map.on('moveend', this._boundUpdateViewport);
    map.on('zoomend', this._boundUpdateViewport);

    this._updateViewport();
  }

  render(gl, args) {
    if (!this._visible || !this.scene || !this.scene.children.length) return;
    if (this.map && this.map.getZoom() < this.minZoom) return;
    if (!this._transform) return;

    // ── FPS monitoring ─────────────────────────────────────────
    const now = performance.now();
    const delta = now - (this._lastFrameTime || now);
    this._lastFrameTime = now;
    const instantFps = delta > 0 ? 1000 / delta : 60;

    this._fpsHistory = this._fpsHistory ?? [];
    this._fpsHistory.push(instantFps);
    if (this._fpsHistory.length > 60) this._fpsHistory.shift();

    const avgFps = this._fpsHistory.reduce((a, b) => a + b, 0) / this._fpsHistory.length;

    if (avgFps < MIN_SHADOW_FPS_THRESHOLD && !this._fpsGuardTriggered && (this._shadowActive || this._footprintMeshGroup)) {
      console.warn(`[GlbCombinedLayer] FPS dropped to ${avgFps.toFixed(1)}. Disabling shadow.`);
      this._forceShadowOff();
      this._fpsGuardTriggered = true;
    }
    // ───────────────────────────────────────────────────────────

    const matrix = args.projectionMatrix ?? args;
    const { translateX, translateY, translateZ, scale } = this._transform;

    const rotX = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(1, 0, 0),
      Math.PI / 2,
    );

    const modelMatrix = new THREE.Matrix4()
      .makeTranslation(translateX, translateY, translateZ)
      .scale(new THREE.Vector3(scale, -scale, scale))
      .multiply(rotX);

    this.camera.projectionMatrix = new THREE.Matrix4()
      .fromArray(matrix)
      .multiply(modelMatrix);

    // raycaster 用に projectionMatrixInverse を更新する。
    // MapLibre custom layer では projectionMatrix に modelMatrix まで含めているため、
    // 逆行列を明示更新しないと Three.js raycaster が正しく飛ばない。
    this.camera.projectionMatrixInverse
      .copy(this.camera.projectionMatrix)
      .invert();

    this.camera.matrixWorld.identity();
    this.camera.matrixWorldInverse.identity();

    this._updateShadowActivation();

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  onRemove() {
    if (this.map) {
      this.map.off('moveend', this._boundUpdateViewport);
      this.map.off('zoomend', this._boundUpdateViewport);
    }

    this.clearMeshSelection();

    for (const code of Array.from(this._loaded.keys())) {
      this._disposeChome(code);
    }

    this._pendingUnload.forEach((tid) => clearTimeout(tid));
    this._pendingUnload.clear();
  }

  // ── 公開 API ──────────────────────────────────────────────────

  async loadIndex(indexUrl) {
    try {
      const res = await fetch(indexUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      this._chomeIndex = await res.json();

      if (this.map) this._updateViewport();
    } catch (err) {
      console.warn('[GlbCombinedLayer] Failed to load chome index:', indexUrl, err);
    }
  }

  setVisible(visible) {
    this._visible = visible;

    if (!visible) {
      this.clearMeshSelection();

      for (const code of Array.from(this._loaded.keys())) {
        this._scheduleUnload(code, 0);
      }
    } else {
      this._updateViewport();
    }

    if (this.map) this.map.triggerRepaint();
  }

  setOriginOffset(dLon, dLat) {
    this._dLon = Number(dLon) || 0;
    this._dLat = Number(dLat) || 0;

    this._buildTransform();

    if (this.map) this.map.triggerRepaint();
  }

  setLighting({
    azimuth,
    elevation,
    sunIntensity,
    ambientIntensity,
    fillIntensity,
    fillColor,
    rimFillIntensity,
    rimFillColor,
    emissiveIntensity,
  } = {}) {
    if (azimuth !== undefined) {
      this._sunAzimuth = Number(azimuth);
    }

    if (elevation !== undefined) {
      this._sunElevation = Number(elevation);
    }

    if (sunIntensity !== undefined) {
      this._sunIntensity = Number(sunIntensity);
      if (this._directionalLight) {
        this._directionalLight.intensity = this._sunIntensity;
      }
    }

    if (ambientIntensity !== undefined) {
      this._ambientIntensity = Number(ambientIntensity);
      if (this._ambientLight) {
        this._ambientLight.intensity = this._ambientIntensity * this._lod2AmbientStrength;
      }
    }

    if (fillIntensity !== undefined) {
      this._fillIntensity = Number(fillIntensity);
      if (this._fillLight) {
        this._fillLight.intensity = this._fillIntensity;
      }
    }

    if (fillColor) {
      this._fillColorHex = fillColor;
      if (this._fillLight) {
        this._fillLight.color.setHex(this._hexToThreeColor(this._fillColorHex));
      }
    }

    if (rimFillIntensity !== undefined) {
      this._rimFillIntensity = Number(rimFillIntensity);
      if (this._rimFillLight) {
        this._rimFillLight.intensity = this._rimFillIntensity;
      }
    }

    if (rimFillColor) {
      this._rimFillColorHex = rimFillColor;
      if (this._rimFillLight) {
        this._rimFillLight.color.setHex(this._hexToThreeColor(this._rimFillColorHex));
      }
    }

    if (emissiveIntensity !== undefined) {
      this._emissiveIntensity = Number(emissiveIntensity);
      this._refreshMaterials();
    }

    this._updateLightPosition();
    this._fitShadowCameraToLoaded();

    if (this.map) this.map.triggerRepaint();
  }

  setShadowOptions({ enabled, mapSize, minZoom } = {}) {
    if (enabled !== undefined) {
      this._shadowMapEnabled = Boolean(enabled);
    }

    if (mapSize !== undefined) {
      const size = Number(mapSize);
      this._shadowMapSize = size > 0 ? size : 0;
      this._configureShadowLight();
    }

    if (minZoom !== undefined) {
      this._shadowMinZoom = Number(minZoom);
    }

    this._updateShadowActivation();

    if (this.map) this.map.triggerRepaint();
  }

  highlightChome(chomeCode) {
    this.clearMeshSelection();

    this._highlightedChome = chomeCode;

    for (const [code, data] of this._loaded) {
      const selected = code === chomeCode;

      data.group.traverse((obj) => {
        if (obj.isMesh) this._applyLod2Material(obj, selected);
      });
    }

    if (this.map) this.map.triggerRepaint();
  }

  clearHighlight() {
    this.clearMeshSelection();

    this._highlightedChome = null;

    for (const data of this._loaded.values()) {
      data.group.traverse((obj) => {
        if (obj.isMesh) this._applyLod2Material(obj, false);
      });
    }

    if (this.map) this.map.triggerRepaint();
  }

  setBuildingColor(hexColor) {
    if (!hexColor) return;

    this._buildingColorHex = hexColor;
    this._refreshMaterials();

    if (this.map) this.map.triggerRepaint();
  }

  setWallColor(hexColor) {
    if (!hexColor) return;

    this._wallColorHex = hexColor;
    this._refreshMaterials();

    if (this.map) this.map.triggerRepaint();
  }

  setRenderTuning({
    roofSunStrength,
    wallSunStrength,
    opacity,
    ambientColor,
    ambientStrength,
  } = {}) {
    if (roofSunStrength !== undefined) {
      this._lod2RoofSunStrength = Math.max(0, Math.min(2, Number(roofSunStrength) || 0));
    }

    if (wallSunStrength !== undefined) {
      this._lod2WallSunStrength = Math.max(0, Math.min(2, Number(wallSunStrength) || 0));
    }

    if (opacity !== undefined) {
      this._lod2Opacity = Math.max(0, Math.min(1, Number(opacity)));
    }

    if (ambientColor) {
      this._lod2AmbientColorHex = ambientColor;
      if (this._ambientLight) {
        this._ambientLight.color.setHex(this._hexToThreeColor(this._lod2AmbientColorHex));
      }
    }

    if (ambientStrength !== undefined) {
      this._lod2AmbientStrength = Math.max(0, Math.min(2, Number(ambientStrength) || 0));
    }

    if (this._ambientLight) {
      this._ambientLight.intensity = this._ambientIntensity * this._lod2AmbientStrength;
    }

    this._refreshMaterials();

    if (this.map) this.map.triggerRepaint();
  }


  totalLoadedBytes() {
    let total = 0;

    for (const d of this._loaded.values()) {
      total += d.sizeBytes || 0;
    }

    return total;
  }

  /**
   * 現在選択中の LOD2 建物 mesh 群を返す。
   * 高さ走査 / 将来の断面解析で共通利用する。
   */
  getSelectedBuildingMeshes() {
    return [...this._selectedBuildingMeshes];
  }


  /**
   * 現在選択中の LOD2 建物の world Y 範囲を返す。
   * Altitude / Height ラベルは、metadata が無い場合でもこの scan bounds を使える。
   * - altitudeM: 選択 mesh 群の最高 Y
   * - heightM  : 最高 Y - 最低 Y
   */
  getSelectedBuildingHeightInfo() {
    const targets = this._selectedBuildingMeshes
      .filter((mesh) => mesh?.isMesh && mesh.geometry);

    if (!targets.length) return null;

    const bounds = new THREE.Box3();
    const meshBox = new THREE.Box3();
    let found = false;

    for (const mesh of targets) {
      if (!mesh.geometry.boundingBox) {
        mesh.geometry.computeBoundingBox();
      }

      if (!mesh.geometry.boundingBox) continue;

      mesh.updateWorldMatrix(true, false);
      meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);

      if (!Number.isFinite(meshBox.min.y) || !Number.isFinite(meshBox.max.y)) {
        continue;
      }

      if (!found) {
        bounds.copy(meshBox);
        found = true;
      } else {
        bounds.union(meshBox);
      }
    }

    if (!found || bounds.isEmpty()) return null;

    const minY = bounds.min.y;
    const maxY = bounds.max.y;
    const heightM = maxY - minY;

    if (!Number.isFinite(heightM) || heightM <= 0) return null;

    return {
      minY,
      maxY,
      heightM,
      altitudeM: maxY,
      source: 'lod2_selected_mesh_world_bounds',
    };
  }

  /**
   * 選択建物を最高点から最低点まで一度だけ走査する。
   */
  startSelectedBuildingHeightScan(options = {}) {
    if (!this._heightScan || !this._selectedBuildingMeshes.length) {
      return false;
    }

    return this._heightScan.start(
      this._selectedBuildingMeshes,
      {
        bandWidthM: this._heightScanBandWidthM,
        scanColor: this._heightScanColor,
        ...options,
      },
    );
  }

  stopSelectedBuildingHeightScan() {
    this._heightScan?.stop();
  }

  setHeightScanStyle({
    bandWidthM,
    scanColor,
  } = {}) {
    if (bandWidthM !== undefined) {
      this._heightScanBandWidthM = Math.max(0.1, Math.min(0.5, Number(bandWidthM) || 0.1));
    }

    if (scanColor) {
      this._heightScanColor = scanColor;
    }

    this._heightScan?.setStyle({
      bandWidthM: this._heightScanBandWidthM,
      scanColor: this._heightScanColor,
    });

    if (this.map) this.map.triggerRepaint();
  }


  /**
   * 選択した LOD2 建物の平面 bbox を lng/lat で返す。
   * roof / wall / body のどれをクリックしても、同じ building id の mesh 群をまとめる。
   *
   * @returns {[number, number, number, number] | null}
   *          [west, south, east, north]
   */
  getBuildingLngLatBboxFromPick(pick) {
    if (!pick?.mesh || !this._transform) return null;

    const meshes = this._collectWholeBuildingMeshesFromPick(pick);
    return this._lngLatBboxFromMeshes(meshes);
  }

  _collectBuildingMeshesForBbox(buildingId, chomeCode = null, fallbackMesh = null) {
    return this._collectWholeBuildingMeshes({ buildingId, chomeCode, fallbackMesh });
  }

  /**
   * LOD2 の「1棟」だけを拾う。
   * 丁 GLB の root / chome group までは絶対に選択対象にしない。
   */
  _collectWholeBuildingMeshesFromPick(pick) {
    if (!pick?.mesh) return [];

    const buildingId = this._resolveBuildingId(pick.mesh) || pick.id || this._resolveMeshId(pick.mesh);
    const chomeCode = pick.chomeCode || this._resolveChomeCode(pick.mesh);

    return this._collectWholeBuildingMeshes({
      buildingId,
      chomeCode,
      fallbackMesh: pick.mesh,
    });
  }

  _collectWholeBuildingMeshes({ buildingId, chomeCode = null, fallbackMesh = null } = {}) {
    const targetId = buildingId ? String(buildingId) : null;
    const targets = [];

    if (targetId) {
      const scanGroups = [];

      // クリックした丁の中だけを探索する。ここを全 loaded に広げると、別丁や広域選択に化けやすい。
      if (chomeCode && this._loaded.has(chomeCode)) {
        scanGroups.push(this._loaded.get(chomeCode).group);
      } else {
        const owner = this._findLoadedGroupForMesh(fallbackMesh);
        if (owner) scanGroups.push(owner);
      }

      for (const group of scanGroups) {
        group.traverse((obj) => {
          if (!obj.isMesh) return;
          if (String(obj.name || '').startsWith('petiteau-selected-lod2-')) return;

          const objBuildingId = this._resolveBuildingId(obj) || this._resolveMeshId(obj);
          if (String(objBuildingId || '') === targetId) {
            targets.push(obj);
          }
        });
      }
    }

    // building_id が取れない GLB では、丁全体へ広げず、命中 mesh だけに留める。
    if (!targets.length && fallbackMesh?.isMesh) {
      targets.push(fallbackMesh);
    }

    return targets;
  }

  _findLoadedGroupForMesh(mesh) {
    if (!mesh) return null;

    for (const data of this._loaded.values()) {
      const group = data?.group;
      if (!group) continue;

      let cur = mesh;
      while (cur) {
        if (cur === group) return group;
        cur = cur.parent;
      }
    }

    return null;
  }

  /**
   * GLB local bbox → lng/lat bbox
   * GLB local axis: x = East, y = Up, z = -North
   */
  _lngLatBboxFromMeshes(meshes) {
    if (!Array.isArray(meshes) || !meshes.length || !this._transform) {
      return null;
    }

    const wholeBox = new THREE.Box3();
    const meshBox  = new THREE.Box3();
    let hasBox = false;

    for (const mesh of meshes) {
      if (!mesh?.isMesh || !mesh.geometry) continue;

      mesh.updateWorldMatrix(true, false);
      meshBox.setFromObject(mesh);

      if (meshBox.isEmpty()) continue;

      if (!hasBox) {
        wholeBox.copy(meshBox);
        hasBox = true;
      } else {
        wholeBox.union(meshBox);
      }
    }

    if (!hasBox || wholeBox.isEmpty()) return null;

    const { translateX, translateY, scale } = this._transform;

    const corners = [
      [wholeBox.min.x, wholeBox.min.z],
      [wholeBox.min.x, wholeBox.max.z],
      [wholeBox.max.x, wholeBox.min.z],
      [wholeBox.max.x, wholeBox.max.z],
    ];

    let west  = Infinity;
    let south = Infinity;
    let east  = -Infinity;
    let north = -Infinity;

    for (const [x, z] of corners) {
      const mc = new maplibregl.MercatorCoordinate(
        translateX + x * scale,
        translateY + z * scale,
        0,
      );

      const lngLat = mc.toLngLat();

      west  = Math.min(west,  lngLat.lng);
      south = Math.min(south, lngLat.lat);
      east  = Math.max(east,  lngLat.lng);
      north = Math.max(north, lngLat.lat);
    }

    if (
      !Number.isFinite(west) ||
      !Number.isFinite(south) ||
      !Number.isFinite(east) ||
      !Number.isFinite(north)
    ) {
      return null;
    }

    return [west, south, east, north];
  }

  raycastPick(point) {
    if (!this.map || !this.camera || !this.scene) return null;
    if (!this._visible) return null;
    if (this.map.getZoom() < this.minZoom) return null;

    const canvas = this.map.getCanvas();
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;

    if (!width || !height) return null;

    this._pointerNdc.set(
      (point.x / width) * 2 - 1,
      -(point.y / height) * 2 + 1,
    );

    // MapLibre custom layer では THREE.Camera に perspective / orthographic の型が無いため、
    // Raycaster.setFromCamera() は使えない。
    // render() で作った projectionMatrix には MapLibre 投影 × GLB modelMatrix が含まれているので、
    // その逆行列から NDC の near / far 点を GLB ローカル座標へ戻し、ray を直接組み立てる。
    if (!this.camera.projectionMatrixInverse) return null;

    this._rayNear
      .set(this._pointerNdc.x, this._pointerNdc.y, -1)
      .applyMatrix4(this.camera.projectionMatrixInverse);

    this._rayFar
      .set(this._pointerNdc.x, this._pointerNdc.y, 1)
      .applyMatrix4(this.camera.projectionMatrixInverse);

    this._rayDirection
      .subVectors(this._rayFar, this._rayNear)
      .normalize();

    this._raycaster.set(this._rayNear, this._rayDirection);

    const targets = [];

    for (const data of this._loaded.values()) {
      if (data?.group) targets.push(data.group);
    }

    if (!targets.length) return null;

    const hits = this._raycaster
      .intersectObjects(targets, true)
      .filter((hit) => {
        return hit.object?.isMesh &&
          hit.object !== this._selectedMeshOverlay &&
          !String(hit.object?.name || '').startsWith('petiteau-selected-lod2-');
      });

    if (!hits.length) return null;

    const hit = hits[0];
    const mesh = hit.object;

    return {
      hit,
      mesh,
      point: hit.point,
      faceIndex: hit.faceIndex,
      kind: this._meshKind(mesh),
      id: this._resolveBuildingId(mesh) || this._resolveMeshId(mesh),
      meshId: this._resolveMeshId(mesh),
      chomeCode: this._resolveChomeCode(mesh),
      properties: this._buildMeshPickProperties(mesh, hit),
    };
  }

  /**
   * LOD2 を「1棟単位」で選択表示する。
   * roof / wall / body のどれに当たっても、同じ building id の mesh 群だけをまとめる。
   * building id が不明な場合は、丁全体へ広げず hit mesh だけに留める。
   */
  highlightBuildingFromPick(pick) {
    if (!pick?.mesh) return;

    const targets = this._collectWholeBuildingMeshesFromPick(pick);
    this._highlightMeshes(targets, pick.mesh);
  }

  highlightBuildingById(buildingId, chomeCode = null, fallbackMesh = null) {
    const targets = this._collectWholeBuildingMeshes({
      buildingId,
      chomeCode,
      fallbackMesh,
    });

    this._highlightMeshes(targets, fallbackMesh);
  }

  _highlightMeshes(meshes, primaryMesh = null) {
    this.clearMeshSelection();

    const targets = Array.from(new Set(
      (meshes || []).filter((m) => m?.isMesh && m.geometry),
    ));

    if (!targets.length) return;

    this._selectedBuildingMeshes = [...targets];

    for (const mesh of targets) {
      this._applySelectionMaterial(mesh);
    }

    this._selectedMesh = primaryMesh || targets[0] || null;

    if (this.map) this.map.triggerRepaint();
  }

  highlightMesh(mesh) {
    this.clearMeshSelection();

    if (!mesh?.isMesh || !mesh.geometry) return;

    this._applySelectionMaterial(mesh);
    this._selectedMesh = mesh;

    if (this.map) this.map.triggerRepaint();
  }

  _applySelectionMaterial(mesh) {
    if (!mesh?.isMesh || !mesh.geometry) return;

    const originalMaterial = mesh.material;
    const kind = this._meshKind(mesh);
    const isWall = kind === 'wall';

    const selectionMaterial = new THREE.MeshBasicMaterial({
      color: isWall
        ? this._selectionOverlayWallColor
        : this._selectionOverlayColor,
      transparent: true,
      opacity: isWall
        ? this._selectionOverlayWallOpacity
        : this._selectionOverlayOpacity,
      depthTest: true,
      // 選択中の透明LOD2本体が、自分自身の奥側スキャン線を隠さないようにする。
      // 手前の別建物は通常 material が depthWrite=true なので、scan 側の depthTest=true で隠れる。
      depthWrite: false,
      side: THREE.FrontSide,
    });

    selectionMaterial.name = isWall
      ? 'petiteau-selected-lod2-wall-transparent-material'
      : 'petiteau-selected-lod2-roof-transparent-material';

    this._selectedMaterialBackups.push({
      mesh,
      originalMaterial,
      selectionMaterial,
    });

    mesh.material = selectionMaterial;
    mesh.renderOrder = 0;
  }

  clearMeshSelection() {
    this.stopSelectedBuildingHeightScan();

    for (const entry of this._selectedMaterialBackups || []) {
      if (!entry?.mesh) continue;

      if (entry.mesh.material === entry.selectionMaterial) {
        entry.mesh.material = entry.originalMaterial;
      }

      entry.selectionMaterial?.dispose?.();
    }

    const overlays = [
      ...(this._selectedBuildingOverlays || []),
      this._selectedMeshOverlay,
    ].filter(Boolean);

    for (const overlay of new Set(overlays)) {
      if (overlay.parent) {
        overlay.parent.remove(overlay);
      }

      if (overlay.geometry) overlay.geometry.dispose();

      const mats = Array.isArray(overlay.material)
        ? overlay.material
        : [overlay.material];

      mats.forEach((m) => m?.dispose?.());
    }

    this._selectedMesh = null;
    this._selectedMeshOverlay = null;
    this._selectedBuildingOverlays = [];
    this._selectedBuildingMeshes = [];
    this._selectedMaterialBackups = [];

    if (this.map) this.map.triggerRepaint();
  }

  findChomeAtLngLat(lng, lat) {
    for (const entry of this._chomeIndex ?? []) {
      if (!entry || !Array.isArray(entry.bbox)) continue;

      const [w, s, e, n] = entry.bbox;

      if (lng >= w && lng <= e && lat >= s && lat <= n) {
        return entry.chome_code;
      }
    }

    return null;
  }

  // ── LOD2 mesh 選択補助 ───────────────────────────────────────

  _resolveChomeCode(mesh) {
    let cur = mesh;

    while (cur) {
      if (cur.userData?.chomeCode) return cur.userData.chomeCode;
      cur = cur.parent;
    }

    return null;
  }

  _resolveBuildingId(mesh) {
    let cur = mesh;

    while (cur) {
      const ud = cur.userData || {};

      // 1棟の親IDを最優先する。面ID / 部品IDである id / gml_id より先に見る。
      const direct =
        ud.building_id ??
        ud.bldg_id ??
        ud.parent_gml_id ??
        ud.parent_id ??
        ud.buildingGmlId ??
        ud.buildingId ??
        ud.bldgGmlId;

      if (direct) return this._normalizeBuildingId(direct);

      const name = String(cur.name || '');
      const normalizedFromName = this._normalizeBuildingId(name);

      // chome / scene / root のような大きすぎる名前は採用しない。
      if (normalizedFromName && !this._looksLikeLod2RootName(normalizedFromName)) {
        return normalizedFromName;
      }

      cur = cur.parent;
    }

    const meshId = this._resolveMeshId(mesh);
    return meshId ? this._normalizeBuildingId(meshId) : null;
  }

  _normalizeBuildingId(value) {
    let s = String(value || '').trim();
    if (!s) return null;

    // GLTF node suffix / mesh suffix を落とす。
    s = s.replace(/\.(?:roof|wall|body|solid|surface|mesh)(?:[._:-]?\d+)?$/i, '');
    s = s.replace(/[_:-](?:roof|roofs|wall|walls|body|solid|surface|mesh)(?:[._:-]?\d+)?$/i, '');

    // CityGML の building id に続く lod2Solid / boundedBy / surface 系の枝番を落とす。
    s = s.replace(/([a-z0-9_.:-]*bldg[a-z0-9_.:-]*?)(?:[_:-](?:lod\d+)?(?:roof|wall|solid|surface|boundedby|boundary|opening).*)$/i, '$1');

    // 変換ツール由来の parent_ / child_ / part_ 以降を落とす。
    s = s.replace(/(?:[_:-](?:parent|child|part|polygon|poly|face|tri|surface)[_:-]?\d+.*)$/i, '');

    // UUID風 id の後ろに roof/wall などが付いているケース。
    s = s.replace(/([0-9a-f]{8}-[0-9a-f-]{27,})(?:[_:-].*)$/i, '$1');

    return s || null;
  }

  _looksLikeLod2RootName(name) {
    const s = String(name || '').toLowerCase();
    return (
      s === 'scene' ||
      s === 'root' ||
      s.includes('chome') ||
      s.includes('gltf') ||
      /^\d{8,}(?:_bldg)?$/.test(s)
    );
  }

  _resolveMeshId(mesh) {
    let cur = mesh;

    while (cur) {
      if (cur.userData?.id) return String(cur.userData.id);
      if (cur.userData?.gml_id) return String(cur.userData.gml_id);
      if (cur.userData?.building_id) return String(cur.userData.building_id);
      if (cur.userData?.bldg_id) return String(cur.userData.bldg_id);

      const name = String(cur.name || '');

      const bldgMatch = name.match(/(bldg_[a-z0-9\-_]+)/i);
      if (bldgMatch) return bldgMatch[1];

      const gmlMatch = name.match(/([a-zA-Z0-9_.:-]*bldg[a-zA-Z0-9_.:-]*)/i);
      if (gmlMatch) return gmlMatch[1];

      cur = cur.parent;
    }

    return null;
  }

  _buildMeshPickProperties(mesh, hit) {
    const kind = this._meshKind(mesh);
    const id = this._resolveMeshId(mesh);
    const buildingId = this._resolveBuildingId(mesh) || id;
    const chomeCode = this._resolveChomeCode(mesh);

    return {
      petiteau_selection_mode: 'lod2_mesh',
      lod2_kind: kind,
      lod2_mesh_name: mesh.name || '',
      lod2_parent_name: mesh.parent?.name || '',
      lod2_id: id,
      lod2_building_id: buildingId,
      chome_code: chomeCode,
      face_index: hit.faceIndex ?? null,
    };
  }

  // ── 照明内部 ──────────────────────────────────────────────────

  _updateLightPosition() {
    this._updateSunLightPosition();
    this._updateFillLightPosition();
    this._updateRimFillLightPosition();
  }

  _updateSunLightPosition() {
    if (!this._directionalLight) return;

    const az = this._sunAzimuth * Math.PI / 180;
    const el = this._sunElevation * Math.PI / 180;

    // GLBローカル空間:
    // x = East
    // y = Up
    // z = -North
    const x = Math.sin(az) * Math.cos(el);
    const y = Math.sin(el);
    const z = -Math.cos(az) * Math.cos(el);

    this._directionalLight.position.set(x, y, z).normalize();
  }

  _updateFillLightPosition() {
    if (!this._fillLight) return;

    // 太陽の反対側から、少し低めにシアン補助光を当てる。
    const az = (this._sunAzimuth + 180) * Math.PI / 180;
    const el = Math.max(18, this._sunElevation * 0.52) * Math.PI / 180;

    const x = Math.sin(az) * Math.cos(el);
    const y = Math.sin(el);
    const z = -Math.cos(az) * Math.cos(el);

    this._fillLight.position.set(x, y, z).normalize();
  }

  _updateRimFillLightPosition() {
    if (!this._rimFillLight) return;

    // 建物側面に紫の縁取りを少し出す低コスト rim light。
    const az = (this._sunAzimuth + 105) * Math.PI / 180;
    const el = Math.max(12, this._sunElevation * 0.35) * Math.PI / 180;

    const x = Math.sin(az) * Math.cos(el);
    const y = Math.sin(el);
    const z = -Math.cos(az) * Math.cos(el);

    this._rimFillLight.position.set(x, y, z).normalize();
  }


  _configureShadowLight() {
    if (!this._directionalLight?.shadow) return;

    const shadow = this._directionalLight.shadow;
    shadow.mapSize.width = this._shadowMapSize;
    shadow.mapSize.height = this._shadowMapSize;
    shadow.bias = -0.0001;
    shadow.normalBias = 0.02;

    const d = this._shadowCameraSize;
    const cam = shadow.camera;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.near = 0.1;
    cam.far = d * 4;
    cam.updateProjectionMatrix();
  }

  _shouldUseShadowMap() {
    if (!this._shadowMapEnabled || this._shadowMapSize <= 0 || this._isMobileRuntime) return false;
    if (!this.map) return false;
    return this.map.getZoom() >= this._shadowMinZoom;
  }

  _updateShadowActivation() {
    const active = this._shouldUseShadowMap();
    if (active === this._shadowActive) return;

    this._shadowActive = active;

    if (this.renderer) {
      this.renderer.shadowMap.enabled = active;
      this.renderer.shadowMap.needsUpdate = true;
    }

    if (this._directionalLight) {
      this._directionalLight.castShadow = active;
    }

    for (const data of this._loaded.values()) {
      data.group.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = active;
        obj.receiveShadow = active;
      });
    }

    if (active) this._fitShadowCameraToLoaded();
  }

  _fitShadowCameraToLoaded() {
    if (!this._directionalLight?.shadow || !this._loaded?.size) return;

    const box = new THREE.Box3();
    let hasObject = false;
    for (const data of this._loaded.values()) {
      if (!data?.group) continue;
      box.expandByObject(data.group);
      hasObject = true;
    }
    if (!hasObject || box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1) * 0.65;
    const d = Math.max(600, Math.min(4200, radius));

    if (!this._directionalLight.target.parent) {
      this.scene?.add(this._directionalLight.target);
    }
    this._directionalLight.target.position.copy(center);
    this._directionalLight.target.updateMatrixWorld();

    const cam = this._directionalLight.shadow.camera;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.near = 0.1;
    cam.far = Math.max(1200, d * 4);
    cam.updateProjectionMatrix();
    this._directionalLight.shadow.needsUpdate = true;
  }

  // ── 内部 ──────────────────────────────────────────────────────

  _buildTransform() {
    const lng = this.sharedOrigin[0] + this._dLon;
    const lat = this.sharedOrigin[1] + this._dLat;

    const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);

    this._transform = {
      translateX: mc.x,
      translateY: mc.y,
      translateZ: mc.z,
      scale: mc.meterInMercatorCoordinateUnits(),
    };
  }

  _refreshMaterials() {
    for (const [code, data] of this._loaded) {
      const selected =
        this._highlightedChome !== null &&
        code === this._highlightedChome;

      data.group.traverse((obj) => {
        if (obj.isMesh) this._applyLod2Material(obj, selected);
      });
    }
  }

  _updateViewport() {
    if (!this.map) return;

    const zoom = this.map.getZoom();

    if (zoom < this.minZoom || !this._visible) {
      for (const code of Array.from(this._loaded.keys())) {
        if (!this._pendingUnload.has(code)) {
          this._scheduleUnload(code, this.UNLOAD_DELAY);
        }
      }
      return;
    }

    const bounds = this.map.getBounds();

    const vbbox = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];

    for (const entry of this._chomeIndex) {
      if (!entry || !Array.isArray(entry.bbox)) continue;

      const code = entry.chome_code;
      const intersects = this._bboxIntersects(vbbox, entry.bbox);

      if (intersects) {
        if (this._pendingUnload.has(code)) {
          clearTimeout(this._pendingUnload.get(code));
          this._pendingUnload.delete(code);
        }

        if (!this._loaded.has(code) && !this._loading.has(code)) {
          this._loadChome(entry);
        }
      } else if (this._loaded.has(code) && !this._pendingUnload.has(code)) {
        this._scheduleUnload(code, this.UNLOAD_DELAY);
      }
    }
  }

  _loadChome(entry) {
    const { chome_code, glb, size_bytes } = entry;
    const glbUrl = `${this.areaBase}/bldg/${glb}`;

    this._loading.add(chome_code);

    this._loader.load(
      glbUrl,
      (gltf) => {
        this._loading.delete(chome_code);

        if (this._pendingUnload.has(chome_code) || !this._visible) {
          this._disposeGltf(gltf);
          this._pendingUnload.delete(chome_code);
          return;
        }

        const group = gltf.scene;

        group.userData.chomeCode = chome_code;

        group.traverse((obj) => {
          obj.userData.chomeCode = chome_code;
        });

        this._configureGroup(group);

        group.position.set(0, 0, 0);

        this.scene.add(group);

        const data = {
          group,
          url: glbUrl,
          sizeBytes: size_bytes || 0,
        };

        this._loaded.set(chome_code, data);
        state.loadedChomeGlbs.set(chome_code, data);

        this._updateShadowActivation();
        this._fitShadowCameraToLoaded();

        if (this.map) this.map.triggerRepaint();
      },
      undefined,
      (err) => {
        this._loading.delete(chome_code);
        console.warn('[GlbCombinedLayer] Failed to load chome GLB:', glbUrl, err);
      },
    );
  }

  _scheduleUnload(chomeCode, delay = this.UNLOAD_DELAY) {
    if (this._pendingUnload.has(chomeCode)) return;

    const tid = setTimeout(() => {
      this._pendingUnload.delete(chomeCode);
      this._disposeChome(chomeCode);
    }, delay);

    this._pendingUnload.set(chomeCode, tid);
  }

  _disposeChome(chomeCode) {
    const data = this._loaded.get(chomeCode);
    if (!data) return;

    this.scene.remove(data.group);
    this._disposeObject(data.group);

    this._loaded.delete(chomeCode);
    state.loadedChomeGlbs.delete(chomeCode);

    if (this.map) this.map.triggerRepaint();
  }

  _disposeGltf(gltf) {
    this._disposeObject(gltf.scene);
  }

  _configureGroup(group) {
    group.traverse((obj) => {
      obj.frustumCulled = true;

      if (obj.isMesh) {
        // 実際に shadow map を有効化するかは zoom/mobile で動的制御。
        // ここでは shadow 対象になれるようフラグだけ立てる。
        obj.castShadow = true;
        obj.receiveShadow = true;

        if (obj.geometry) {
          // 法線再計算。反転はしない。
          obj.geometry.computeVertexNormals();
        }

        this._applyLod2Material(obj, false);
      }
    });
  }

  _meshKind(obj) {
    const text = `${obj.name || ''} ${obj.parent?.name || ''}`.toLowerCase();

    if (text.includes('roof') || text.includes('roofs')) return 'roof';
    if (text.includes('wall') || text.includes('walls')) return 'wall';

    return 'body';
  }

  _hexToThreeColor(hexColor) {
    const hex = String(hexColor || '#f4f5f7').replace('#', '');

    const n = parseInt(
      hex.length === 3
        ? hex.split('').map((c) => c + c).join('')
        : hex,
      16,
    );

    return Number.isFinite(n) ? n : 0xf4f5f7;
  }


  _lod2MaterialDisplayColor(baseColor, kind) {
    const sunStrength = kind === 'wall'
      ? this._lod2WallSunStrength
      : this._lod2RoofSunStrength;

    const out = baseColor.clone().multiplyScalar(Math.max(0, sunStrength));
    out.r = Math.min(1, out.r);
    out.g = Math.min(1, out.g);
    out.b = Math.min(1, out.b);

    // 色つき環境光の見た目補正。100% = 約18%だけ環境光色を混ぜる。
    // 200%でも破綻しないよう最大 36% に制限する。
    const ambientMix = Math.max(0, Math.min(0.36, this._lod2AmbientStrength * 0.18));
    if (ambientMix > 0) {
      const ambient = new THREE.Color(this._hexToThreeColor(this._lod2AmbientColorHex));
      out.lerp(ambient, ambientMix);
    }

    return out;
  }

  _applyLod2Material(obj, selected) {
    const kind = this._meshKind(obj);

    let color = this._hexToThreeColor(this._buildingColorHex);

    if (kind === 'wall') {
      color = this._hexToThreeColor(this._wallColorHex);
    }

    if (selected) {
      if (kind === 'roof') {
        color = 0x74b9ff;
      } else if (kind === 'wall') {
        color = 0x2d8cff;
      } else {
        color = 0x4a90d9;
      }
    }

    if (obj.material) {
      const oldMats = Array.isArray(obj.material)
        ? obj.material
        : [obj.material];

      oldMats.forEach((m) => {
        if (!m) return;

        [
          'map',
          'normalMap',
          'roughnessMap',
          'metalnessMap',
          'emissiveMap',
          'aoMap',
          'lightMap',
          'bumpMap',
          'specularMap',
          'envMap',
        ].forEach((slot) => {
          if (m[slot]) m[slot].dispose();
        });

        m.dispose?.();
      });
    }

    const baseColor = new THREE.Color(color);
    const displayColor = selected
      ? baseColor
      : this._lod2MaterialDisplayColor(baseColor, kind);
    const materialOpacity = selected ? 1.0 : this._lod2Opacity;
    const isTransparent = materialOpacity < 0.999;

    obj.material = new THREE.MeshStandardMaterial({
      color: displayColor,

      emissive: displayColor,
      emissiveIntensity: selected
        ? Math.max(this._emissiveIntensity, 0.18)
        : this._emissiveIntensity * Math.max(0.25, Math.min(1.0, this._lod2AmbientStrength)),

      roughness: 0.42,
      metalness: 0.02,

      side: THREE.FrontSide,

      transparent: isTransparent,
      opacity: materialOpacity,

      depthTest: true,
      depthWrite: !isTransparent,

      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    obj.material.needsUpdate = true;
    obj.userData._petiteauMaterialReplaced = true;
  }

  // ── Footprint 3D mesh（shadow map 参加用） ─────────────────────

  /**
   * GeoJSON FeatureCollection を Three.js ExtrudeGeometry に変換して
   * scene に追加する。既存 shadow map にそのまま参加できる。
   */
  setFootprintMeshes(featureCollection, {
    color = 0xfafafa,
    wallColor = 0xdde0f0,
    opacity = 1.0,
  } = {}) {
    this._clearFootprintMeshes();

    if (!this.scene || !this._transform) return;
    if (!featureCollection?.features?.length) return;

    // Reset FPS guard so the new mesh set can re-trigger if FPS drops.
    this._fpsGuardTriggered = false;

    const group = new THREE.Group();
    group.name = 'petiteau-footprint-extruded';

    for (const feature of featureCollection.features) {
      const geom = feature.geometry;
      if (!geom) continue;

      const heightM = this._footprintHeightFromProps(feature.properties ?? {});
      const polygons = geom.type === 'Polygon'
        ? [geom.coordinates]
        : geom.type === 'MultiPolygon'
          ? geom.coordinates
          : [];

      for (const polygonCoords of polygons) {
        const mesh = this._buildFootprintExtrudedMesh(
          polygonCoords, heightM, color, wallColor, opacity,
        );
        if (mesh) group.add(mesh);
      }
    }

    this._footprintMeshGroup = group;
    this.scene.add(group);

    this._updateShadowActivation();
    this._fitShadowCameraToLoaded();

    if (this.map) this.map.triggerRepaint();
  }

  /**
   * `map-app.js` からの委譲経路。`setFootprintMeshes()` のラッパー。
   */
  showFootprintShadowMesh({ geometry, heightM, color, wallColor, opacity = 1.0 } = {}) {
    if (!geometry) return false;

    const fc = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry,
        properties: heightM != null ? { height: heightM } : {},
      }],
    };

    const resolveColor = (c, fallback) => {
      if (typeof c === 'number') return c;
      if (typeof c === 'string') return this._hexToThreeColor(c);
      return fallback;
    };

    this.setFootprintMeshes(fc, {
      color: resolveColor(color, 0xfafafa),
      wallColor: resolveColor(wallColor, 0xdde0f0),
      opacity,
    });

    return true;
  }

  clearFootprintMeshes() {
    this._clearFootprintMeshes();
    if (this.map) this.map.triggerRepaint();
  }

  _clearFootprintMeshes() {
    if (!this._footprintMeshGroup) return;
    this.scene?.remove(this._footprintMeshGroup);
    this._disposeObject(this._footprintMeshGroup);
    this._footprintMeshGroup = null;
  }

  /**
   * 外部で生成した Three.js Group を scene に追加し、shadow map に参加させる。
   * forceShadow=true のとき、zoom/mobile ガードに関わらず shadow map を一時有効化する。
   */
  addAnalysisShadowGroup(group, { forceShadow = false, sunAzimuthDeg, sunElevationDeg } = {}) {
    if (!this.scene || !group) return;

    if (sunAzimuthDeg !== undefined) this._sunAzimuth = Number(sunAzimuthDeg);
    if (sunElevationDeg !== undefined) this._sunElevation = Number(sunElevationDeg);

    if (sunAzimuthDeg !== undefined || sunElevationDeg !== undefined) {
      this._updateLightPosition();
    }

    this.scene.add(group);

    if (forceShadow && !this._shadowActive) {
      this._shadowActive = true;

      if (this.renderer) {
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.needsUpdate = true;
      }

      if (this._directionalLight) {
        this._directionalLight.castShadow = true;
      }
    }

    this._fitShadowCameraToLoaded();

    if (this.map) this.map.triggerRepaint();
  }

  removeAnalysisShadowGroup(group) {
    if (!this.scene || !group) return;
    this.scene.remove(group);
    this._disposeObject(group);
    if (this.map) this.map.triggerRepaint();
  }

  /**
   * 現在選択中の LOD2 建物に対して shadow map を一時強制有効化し、
   * shadow camera をその建物に絞って再計算する。
   */
  startSelectedBuildingShadowAnalysis({ sunAzimuthDeg, sunElevationDeg } = {}) {
    if (!this._selectedBuildingMeshes.length) {
      console.warn('[GlbCombinedLayer] startSelectedBuildingShadowAnalysis: no selected meshes.');
      return false;
    }

    // Reset FPS guard so the new analysis run can re-trigger if FPS drops.
    this._fpsGuardTriggered = false;

    if (sunAzimuthDeg !== undefined) this._sunAzimuth = Number(sunAzimuthDeg);
    if (sunElevationDeg !== undefined) this._sunElevation = Number(sunElevationDeg);

    if (sunAzimuthDeg !== undefined || sunElevationDeg !== undefined) {
      this._updateLightPosition();
    }

    if (this.renderer) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.needsUpdate = true;
    }

    if (this._directionalLight) {
      this._directionalLight.castShadow = true;
    }

    this._shadowActive = true;

    for (const data of this._loaded.values()) {
      data.group.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
      });
    }

    this._fitShadowCameraToMeshes(this._selectedBuildingMeshes);

    if (this.map) this.map.triggerRepaint();

    return true;
  }

  /**
   * 指定した mesh 群に shadow camera を絞って再計算する。
   */
  _fitShadowCameraToMeshes(meshes) {
    if (!this._directionalLight?.shadow || !meshes?.length) return;

    const box = new THREE.Box3();
    let hasObject = false;

    for (const mesh of meshes) {
      if (!mesh?.isMesh) continue;
      mesh.updateWorldMatrix(true, false);
      const meshBox = new THREE.Box3().setFromObject(mesh);
      if (meshBox.isEmpty()) continue;

      if (!hasObject) {
        box.copy(meshBox);
        hasObject = true;
      } else {
        box.union(meshBox);
      }
    }

    if (!hasObject || box.isEmpty()) {
      this._fitShadowCameraToLoaded();
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1) * 1.5;
    const d = Math.max(SHADOW_CAM_MIN_D, Math.min(SHADOW_CAM_MAX_D, radius));

    if (!this._directionalLight.target.parent) {
      this.scene?.add(this._directionalLight.target);
    }

    this._directionalLight.target.position.copy(center);
    this._directionalLight.target.updateMatrixWorld();

    const cam = this._directionalLight.shadow.camera;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.near = 0.1;
    cam.far = Math.max(400, d * 4);
    cam.updateProjectionMatrix();
    this._directionalLight.shadow.needsUpdate = true;
  }

  /**
   * FPS ガード発動時に shadow map と footprint mesh を強制無効化する。
   */
  _forceShadowOff() {
    this._shadowActive = false;

    if (this.renderer) {
      this.renderer.shadowMap.enabled = false;
      this.renderer.shadowMap.needsUpdate = true;
    }

    if (this._directionalLight) this._directionalLight.castShadow = false;

    this._clearFootprintMeshes();

    for (const data of this._loaded.values()) {
      data.group.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = false;
        obj.receiveShadow = false;
      });
    }
  }

  /**
   * GeoJSON polygon ring → THREE.Mesh（ExtrudeGeometry）
   *
   * 座標変換:
   *   shape.x = scene.x = East meters from origin
   *   shape.y = -scene.z = North meters（Mercator Y は南増加なので符号反転）
   *   extrude along +Z → rotation.x = -PI/2 で scene +Y（Up）に立てる
   */
  _buildFootprintExtrudedMesh(polygonCoords, heightM, color, wallColor, opacity) {
    if (!Array.isArray(polygonCoords) || !polygonCoords[0]?.length) return null;

    const { translateX, translateY, scale } = this._transform;

    const toShapeXY = ([lng, lat]) => {
      const mc = maplibregl.MercatorCoordinate.fromLngLat(
        [Number(lng), Number(lat)], 0,
      );
      return [
        (mc.x - translateX) / scale,
        -((mc.y - translateY) / scale),
      ];
    };

    const outerRing = polygonCoords[0];
    if (outerRing.length < 4) return null;

    const shape = new THREE.Shape();
    const [fx, fy] = toShapeXY(outerRing[0]);
    shape.moveTo(fx, fy);
    for (let i = 1; i < outerRing.length - 1; i++) {
      const [x, y] = toShapeXY(outerRing[i]);
      shape.lineTo(x, y);
    }
    shape.closePath();

    for (let h = 1; h < polygonCoords.length; h++) {
      const holeRing = polygonCoords[h];
      if (!holeRing || holeRing.length < 4) continue;

      const hole = new THREE.Path();
      const [hx, hy] = toShapeXY(holeRing[0]);
      hole.moveTo(hx, hy);
      for (let i = 1; i < holeRing.length - 1; i++) {
        const [x, y] = toShapeXY(holeRing[i]);
        hole.lineTo(x, y);
      }
      hole.closePath();
      shape.holes.push(hole);
    }

    const depth = Math.max(MIN_EXTRUSION_DEPTH_M, Number(heightM) || DEFAULT_BUILDING_HEIGHT_M);

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
    });
    geometry.computeVertexNormals();

    // ExtrudeGeometry: group 0 = side walls, group 1 = top cap, group 2 = bottom cap
    const roofMat = new THREE.MeshStandardMaterial({
      color: typeof color === 'number' ? color : this._hexToThreeColor(color),
      roughness: 0.45,
      metalness: 0.01,
      transparent: opacity < 0.999,
      opacity,
      depthWrite: opacity >= 0.999,
      side: THREE.FrontSide,
    });

    const wallMat = new THREE.MeshStandardMaterial({
      color: typeof wallColor === 'number' ? wallColor : this._hexToThreeColor(wallColor),
      roughness: 0.52,
      metalness: 0.01,
      transparent: opacity < 0.999,
      opacity,
      depthWrite: opacity >= 0.999,
      side: THREE.FrontSide,
    });

    const mesh = new THREE.Mesh(geometry, [wallMat, roofMat, roofMat]);

    // ExtrudeGeometry は +Z 方向に押し出す。rotation.x = -PI/2 で scene +Y（Up）方向になる。
    mesh.rotation.x = -Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
  }

  _footprintHeightFromProps(props) {
    const keys = [
      'display_height', 'height', 'measuredHeight',
      'measured_height', 'h', 'HEIGHT',
    ];

    for (const key of keys) {
      const n = Number(props?.[key]);
      if (Number.isFinite(n) && n > 0) return n;
    }

    return DEFAULT_BUILDING_HEIGHT_M;
  }

  _bboxIntersects(a, b) {
    return !(
      a[2] < b[0] ||
      b[2] < a[0] ||
      a[3] < b[1] ||
      b[3] < a[1]
    );
  }

  _disposeObject(object) {
    object.traverse((obj) => {
      if (!obj.isMesh) return;

      if (obj.geometry) obj.geometry.dispose();

      const mats = Array.isArray(obj.material)
        ? obj.material
        : [obj.material];

      mats.forEach((m) => {
        if (!m) return;

        [
          'map',
          'normalMap',
          'roughnessMap',
          'metalnessMap',
          'emissiveMap',
          'aoMap',
          'lightMap',
          'bumpMap',
          'specularMap',
          'envMap',
        ].forEach((slot) => {
          if (m[slot]) m[slot].dispose();
        });

        m.dispose();
      });
    });
  }
}