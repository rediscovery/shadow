/**
 * footprint-scan-layer.js
 *
 * Petiteau Footprint Scan Layer
 * - Footprint 本体は MapLibre fill-extrusion のまま
 * - 選択時レーザーだけ Three.js custom layer で描画
 * - depthTest=false により、奥側リングと断面プレーンを常に見せる
 */

export class FootprintScanLayer {
  constructor(options = {}) {
    this.map = null;

    this.THREE = options.THREE || globalThis.THREE;
    this.maplibregl = options.maplibregl || globalThis.maplibregl;

    this.layerId = options.customLayerId || 'petiteau-footprint-scan-three-layer';

    this.durationMs = Number.isFinite(options.durationMs)
      ? options.durationMs
      : 6000;

    this.pcLaserWidthMeters = Number.isFinite(options.pcLaserWidthMeters)
      ? options.pcLaserWidthMeters
      : 0.2;

    this.mobileLaserWidthMeters = Number.isFinite(options.mobileLaserWidthMeters)
      ? options.mobileLaserWidthMeters
      : 0.3;

    this.ringColor = options.ringColor ?? 0xffffff;
    this.planeColor = options.planeColor ?? 0xffffff;

    this.ringOpacity = Number.isFinite(options.ringOpacity)
      ? options.ringOpacity
      : 0.95;

    this.scanPlaneOpacity = Number.isFinite(options.scanPlaneOpacity)
      ? options.scanPlaneOpacity
      : 0.14;

    this.defaultHeightMeters = Number.isFinite(options.defaultHeightMeters)
      ? options.defaultHeightMeters
      : 10;

    this.minHeightMeters = Number.isFinite(options.minHeightMeters)
      ? options.minHeightMeters
      : 2.5;

    this.scene = null;
    this.camera = null;
    this.renderer = null;

    this.scanGroup = null;
    this.active = false;
    this.startTime = 0;

    this.scanBaseMeters = 0;
    this.scanTopMeters = this.defaultHeightMeters;
    this.scanCenterLngLat = null;

    this._lastRequestedColor = null;
    this._lastRequestedBandWidthM = null;
  }

  addTo(map) {
    if (!map) {
      console.warn('[FootprintScanLayer] addTo(map) failed: map is required.');
      return;
    }

    this.map = map;

    if (!this.THREE) {
      console.warn('[FootprintScanLayer] THREE is not available.');
      return;
    }

    if (!this.maplibregl?.MercatorCoordinate) {
      console.warn('[FootprintScanLayer] maplibregl.MercatorCoordinate is not available.');
      return;
    }

    if (this.map.getLayer(this.layerId)) {
      return;
    }

    const self = this;

    this.map.addLayer({
      id: this.layerId,
      type: 'custom',
      renderingMode: '3d',

      onAdd(mapInstance, gl) {
        self._initThree(mapInstance, gl);
      },

      render(gl, matrixOrArgs) {
        self._render(gl, matrixOrArgs);
      },
    });
  }

  stop() {
    this.active = false;
    this._disposeCurrentObjects();

    if (this.map) {
      this.map.triggerRepaint();
    }
  }

  startFromFeature(feature, options = {}) {
    if (!this.map || !feature?.geometry) return false;
    if (!this.scene) return false;

    const polygons = this._extractPolygons(feature.geometry);

    if (!polygons.length) {
      console.warn('[FootprintScanLayer] No polygon geometry.');
      return false;
    }

    this._disposeCurrentObjects();

    this._lastRequestedColor = options.color ?? null;
    this._lastRequestedBandWidthM = Number.isFinite(options.bandWidthM)
      ? options.bandWidthM
      : null;

    const properties = feature.properties ?? {};
    const heightMeters = this._resolveHeightMeters(properties, options);
    const baseMeters = this._resolveBaseMeters(properties, options);

    this.scanBaseMeters = baseMeters;
    this.scanTopMeters = baseMeters + Math.max(this.minHeightMeters, heightMeters);
    this.durationMs = Number.isFinite(options.durationMs)
      ? options.durationMs
      : this.durationMs;

    this.scanCenterLngLat = this._polygonsCenterLngLat(polygons);

    if (!this.scanCenterLngLat) {
      console.warn('[FootprintScanLayer] Failed to compute center.');
      return false;
    }

    this.scanGroup = new this.THREE.Group();
    this.scanGroup.name = 'petiteau-footprint-scan-group';
    this.scanGroup.renderOrder = 999999;
    this.scanGroup.frustumCulled = false;

    const ringGroup = this._buildRingGroup(polygons);
    const planeGroup = this._buildScanPlaneGroup(polygons);

    if (ringGroup) this.scanGroup.add(ringGroup);
    if (planeGroup) this.scanGroup.add(planeGroup);

    this.scene.add(this.scanGroup);

    this.active = true;
    this.startTime = performance.now();

    this._updateScanHeight(0);

    this.map.triggerRepaint();

    return true;
  }

  _initThree(map, gl) {
    this.scene = new this.THREE.Scene();
    this.camera = new this.THREE.Camera();

    this.renderer = new this.THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });

    this.renderer.autoClear = false;
  }

  _render(gl, matrixOrArgs) {
    if (!this.renderer || !this.scene || !this.camera) return;

    const matrix = this._resolveProjectionMatrix(matrixOrArgs);
    if (!matrix) return;

    this.camera.projectionMatrix = new this.THREE.Matrix4().fromArray(matrix);

    if (this.active) {
      const elapsed = performance.now() - this.startTime;
      const t = Math.min(1, Math.max(0, elapsed / this.durationMs));

      this._updateScanHeight(t);

      if (t >= 1) {
        this.active = false;
      } else {
        this.map?.triggerRepaint();
      }
    }

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  _resolveProjectionMatrix(matrixOrArgs) {
    if (!matrixOrArgs) return null;

    // MapLibre v4 style
    if (Array.isArray(matrixOrArgs) || matrixOrArgs instanceof Float32Array) {
      return matrixOrArgs;
    }

    // MapLibre v5 style
    if (matrixOrArgs.projectionMatrix) {
      return matrixOrArgs.projectionMatrix;
    }

    if (matrixOrArgs.defaultProjectionData?.mainMatrix) {
      return matrixOrArgs.defaultProjectionData.mainMatrix;
    }

    if (matrixOrArgs.mainMatrix) {
      return matrixOrArgs.mainMatrix;
    }

    return null;
  }

  _disposeCurrentObjects() {
    if (this.scanGroup && this.scene) {
      this.scene.remove(this.scanGroup);
    }

    if (this.scanGroup) {
      this.scanGroup.traverse((obj) => {
        if (obj.geometry?.dispose) {
          obj.geometry.dispose();
        }

        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m?.dispose?.());
        } else if (obj.material?.dispose) {
          obj.material.dispose();
        }
      });
    }

    this.scanGroup = null;
  }

  _buildRingGroup(polygons) {
    const group = new this.THREE.Group();
    group.name = 'petiteau-footprint-scan-rings';
    group.renderOrder = 999999;
    group.frustumCulled = false;

    const bandWidthM = Number.isFinite(this._lastRequestedBandWidthM)
      ? this._lastRequestedBandWidthM
      : this._defaultLaserWidthMeters();

    const radiusM = Math.max(0.03, bandWidthM * 0.5);

    const centerMc = this.maplibregl.MercatorCoordinate.fromLngLat(
      { lng: this.scanCenterLngLat[0], lat: this.scanCenterLngLat[1] },
      0,
    );

    const radiusMercator = radiusM * centerMc.meterInMercatorCoordinateUnits();

    const material = new this.THREE.MeshBasicMaterial({
      color: this._lastRequestedColor || this.ringColor,
      transparent: true,
      opacity: this.ringOpacity,
      depthTest: false,
      depthWrite: false,
      blending: this.THREE.AdditiveBlending,
      side: this.THREE.DoubleSide,
    });

    for (const polygon of polygons) {
      for (const ring of polygon) {
        const points = this._ringToMercatorPoints(ring);

        if (points.length < 2) continue;

        const ringMesh = this._buildThickClosedPolyline(points, radiusMercator, material);
        group.add(ringMesh);
      }
    }

    return group;
  }

  _buildThickClosedPolyline(points, radiusMercator, material) {
    const group = new this.THREE.Group();
    group.renderOrder = 999999;
    group.frustumCulled = false;

    const sphereGeometry = new this.THREE.SphereGeometry(radiusMercator * 1.15, 8, 6);

    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);

      if (!Number.isFinite(len) || len <= 0) continue;

      const cylinderGeometry = new this.THREE.CylinderGeometry(
        radiusMercator,
        radiusMercator,
        len,
        8,
        1,
        false,
      );

      const cylinder = new this.THREE.Mesh(cylinderGeometry, material);
      cylinder.name = 'petiteau-footprint-scan-ring-segment';
      cylinder.renderOrder = 999999;
      cylinder.frustumCulled = false;

      cylinder.position.set(
        (p1.x + p2.x) * 0.5,
        (p1.y + p2.y) * 0.5,
        0,
      );

      const direction = new this.THREE.Vector3(dx, dy, 0).normalize();
      const yAxis = new this.THREE.Vector3(0, 1, 0);
      cylinder.quaternion.setFromUnitVectors(yAxis, direction);

      group.add(cylinder);
    }

    for (const p of points) {
      const sphere = new this.THREE.Mesh(sphereGeometry, material);
      sphere.name = 'petiteau-footprint-scan-ring-vertex';
      sphere.renderOrder = 999999;
      sphere.frustumCulled = false;
      sphere.position.set(p.x, p.y, 0);
      group.add(sphere);
    }

    return group;
  }

  _buildScanPlaneGroup(polygons) {
    const group = new this.THREE.Group();
    group.name = 'petiteau-footprint-scan-planes';
    group.renderOrder = 999998;
    group.frustumCulled = false;

    const material = new this.THREE.MeshBasicMaterial({
      color: this._lastRequestedColor || this.planeColor,
      transparent: true,
      opacity: this.scanPlaneOpacity,
      depthTest: false,
      depthWrite: false,
      blending: this.THREE.AdditiveBlending,
      side: this.THREE.DoubleSide,
    });

    for (const polygon of polygons) {
      const shape = this._polygonToShape(polygon);

      if (!shape) continue;

      const geometry = new this.THREE.ShapeGeometry(shape);
      const mesh = new this.THREE.Mesh(geometry, material);

      mesh.name = 'petiteau-footprint-scan-plane';
      mesh.renderOrder = 999998;
      mesh.frustumCulled = false;

      group.add(mesh);
    }

    return group.children.length ? group : null;
  }

  _polygonToShape(polygon) {
    if (!polygon?.[0]) return null;

    const outer = this._ringToMercatorPoints(polygon[0]);
    if (outer.length < 3) return null;

    const shape = new this.THREE.Shape();

    outer.forEach((p, index) => {
      if (index === 0) {
        shape.moveTo(p.x, p.y);
      } else {
        shape.lineTo(p.x, p.y);
      }
    });

    shape.closePath();

    for (let i = 1; i < polygon.length; i++) {
      const hole = this._ringToMercatorPoints(polygon[i]);
      if (hole.length < 3) continue;

      const path = new this.THREE.Path();

      hole.forEach((p, index) => {
        if (index === 0) {
          path.moveTo(p.x, p.y);
        } else {
          path.lineTo(p.x, p.y);
        }
      });

      path.closePath();
      shape.holes.push(path);
    }

    return shape;
  }

  _ringToMercatorPoints(ring) {
    const points = [];
    const cleaned = this._stripClosingCoord(ring);

    for (const coord of cleaned) {
      if (!coord || coord.length < 2) continue;

      const lng = Number(coord[0]);
      const lat = Number(coord[1]);

      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

      const mc = this.maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, 0);
      points.push(new this.THREE.Vector3(mc.x, mc.y, 0));
    }

    return points;
  }

  _updateScanHeight(t) {
    if (!this.scanGroup || !this.scanCenterLngLat) return;

    const eased = this._easeInOutCubic(t);

    const altitudeM =
      this.scanTopMeters -
      (this.scanTopMeters - this.scanBaseMeters) * eased;

    const mc = this.maplibregl.MercatorCoordinate.fromLngLat(
      {
        lng: this.scanCenterLngLat[0],
        lat: this.scanCenterLngLat[1],
      },
      altitudeM,
    );

    this.scanGroup.position.z = mc.z;

    const fadeStart = 0.88;
    const fade = t <= fadeStart
      ? 1
      : Math.max(0, 1 - (t - fadeStart) / (1 - fadeStart));

    this.scanGroup.traverse((obj) => {
      if (!obj.material) return;

      if (obj.name === 'petiteau-footprint-scan-plane') {
        obj.material.opacity = this.scanPlaneOpacity * fade;
      } else {
        obj.material.opacity = this.ringOpacity * fade;
      }
    });
  }

  _extractPolygons(geometry) {
    if (!geometry) return [];

    if (geometry.type === 'Polygon') {
      return [geometry.coordinates];
    }

    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates ?? [];
    }

    return [];
  }

  _polygonsCenterLngLat(polygons) {
    const bbox = this._polygonsBbox(polygons);

    if (!bbox) return null;

    return [
      (bbox[0] + bbox[2]) * 0.5,
      (bbox[1] + bbox[3]) * 0.5,
    ];
  }

  _polygonsBbox(polygons) {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;

    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (const coord of ring) {
          if (!coord || coord.length < 2) continue;

          const lng = Number(coord[0]);
          const lat = Number(coord[1]);

          if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

          minLng = Math.min(minLng, lng);
          minLat = Math.min(minLat, lat);
          maxLng = Math.max(maxLng, lng);
          maxLat = Math.max(maxLat, lat);
        }
      }
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

  _stripClosingCoord(ring) {
    if (!Array.isArray(ring)) return [];
    if (ring.length <= 1) return ring.slice();

    const first = ring[0];
    const last = ring[ring.length - 1];

    if (
      first &&
      last &&
      Number(first[0]) === Number(last[0]) &&
      Number(first[1]) === Number(last[1])
    ) {
      return ring.slice(0, -1);
    }

    return ring.slice();
  }

  _resolveHeightMeters(properties, options) {
    if (Number.isFinite(options.heightMeters)) {
      return Math.max(this.minHeightMeters, Number(options.heightMeters));
    }

    const keys = [
      'height',
      'measuredHeight',
      'h',
      'HEIGHT',
      'MeasuredHeight',
      'measured_height',
      'bldg:measuredHeight',
      'building_height',
      'render_height',
      'extrude_height',
      'max_height',
      '高さ',
      '建物高さ',
    ];

    for (const key of keys) {
      const n = this._toNumber(properties?.[key]);

      if (Number.isFinite(n) && n > 0) {
        return Math.max(this.minHeightMeters, n);
      }
    }

    return this.defaultHeightMeters;
  }

  _resolveBaseMeters(properties, options) {
    if (Number.isFinite(options.baseMeters)) {
      return Number(options.baseMeters);
    }

    const keys = [
      'base',
      'base_height',
      'min_height',
      'render_min_height',
      'extrude_base',
      'ground_height',
      'groundHeight',
      'ground_z',
      'elevation',
      '標高',
    ];

    for (const key of keys) {
      const n = this._toNumber(properties?.[key]);

      if (Number.isFinite(n)) {
        return n;
      }
    }

    return 0;
  }

  _toNumber(value) {
    if (typeof value === 'number') return value;

    if (typeof value === 'string') {
      const cleaned = value
        .replace(/[ｍmメートル\s]/g, '')
        .replace(/,/g, '');

      const n = Number(cleaned);
      return Number.isFinite(n) ? n : NaN;
    }

    return NaN;
  }

  _defaultLaserWidthMeters() {
    const isMobile =
      typeof window !== 'undefined' &&
      window.innerWidth <= 720;

    return isMobile
      ? this.mobileLaserWidthMeters
      : this.pcLaserWidthMeters;
  }

  _easeInOutCubic(t) {
    const x = Math.min(1, Math.max(0, t));

    return x < 0.5
      ? 4 * x * x * x
      : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }
}
