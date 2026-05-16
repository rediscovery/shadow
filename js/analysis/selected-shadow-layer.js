/**
 * selected-shadow-layer.js
 * Lightweight projected shadow layer for Petiteau selected footprint buildings.
 * - Single MapLibre fill layer only
 * - No blur / no shadow map
 * - Receives raw footprint geometry and projects it by sun azimuth/elevation
 */

export class SelectedShadowLayer {
  constructor(map, {
    sourceId = 'petiteau-selected-building-shadow-source',
    layerId = 'petiteau-selected-building-shadow',
    beforeId = null,
    color = '#000000',
    opacity = 0.26,
  } = {}) {
    this.map = map;
    this.sourceId = sourceId;
    this.layerId = layerId;
    this.beforeId = beforeId;
    this.color = color;
    this.opacity = opacity;
  }

  ensure() {
    if (!this.map) return;

    if (!this.map.getSource(this.sourceId)) {
      this.map.addSource(this.sourceId, {
        type: 'geojson',
        data: this._emptyFeatureCollection(),
      });
    }

    if (!this.map.getLayer(this.layerId)) {
      const layer = {
        id: this.layerId,
        type: 'fill',
        source: this.sourceId,
        layout: {
          visibility: 'none',
        },
        paint: {
          'fill-color': this.color,
          'fill-opacity': this.opacity,
        },
      };

      if (this.beforeId && this.map.getLayer(this.beforeId)) {
        this.map.addLayer(layer, this.beforeId);
      } else {
        this.map.addLayer(layer);
      }
    } else {
      this._moveBeforeTarget();
    }
  }

  _moveBeforeTarget() {
    if (!this.map || !this.map.getLayer(this.layerId)) return;
    if (!this.beforeId || !this.map.getLayer(this.beforeId)) return;

    try {
      this.map.moveLayer(this.layerId, this.beforeId);
    } catch (err) {
      console.warn('[SelectedShadowLayer] moveLayer failed:', err);
    }
  }

  show({
    geometry,
    heightM = 10,
    sunAzimuthDeg = 144,
    sunElevationDeg = 54,
    opacity = this.opacity,
  } = {}) {
    if (!this.map || !geometry) return false;

    this.ensure();
    this._moveBeforeTarget();

    const shadowGeometry = this._projectGeometry({
      geometry,
      heightM,
      sunAzimuthDeg,
      sunElevationDeg,
    });

    if (!shadowGeometry) return false;

    const source = this.map.getSource(this.sourceId);
    if (!source) return false;

    source.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {
          petiteau_shadow: true,
          heightM,
          sunAzimuthDeg,
          sunElevationDeg,
        },
        geometry: shadowGeometry,
      }],
    });

    if (this.map.getLayer(this.layerId)) {
      this.map.setPaintProperty(this.layerId, 'fill-opacity', opacity);
      this.map.setLayoutProperty(this.layerId, 'visibility', 'visible');
    }

    return true;
  }

  hide() {
    if (!this.map) return;

    if (this.map.getLayer(this.layerId)) {
      this.map.setLayoutProperty(this.layerId, 'visibility', 'none');
    }

    const source = this.map.getSource(this.sourceId);
    if (source) {
      source.setData(this._emptyFeatureCollection());
    }
  }

  remove() {
    if (!this.map) return;

    if (this.map.getLayer(this.layerId)) {
      this.map.removeLayer(this.layerId);
    }

    if (this.map.getSource(this.sourceId)) {
      this.map.removeSource(this.sourceId);
    }
  }

  setBeforeId(beforeId) {
    this.beforeId = beforeId || null;
  }

  setStyle({ color, opacity } = {}) {
    if (color) this.color = color;
    if (opacity !== undefined) this.opacity = Number(opacity);

    if (!this.map?.getLayer(this.layerId)) return;

    if (color) {
      this.map.setPaintProperty(this.layerId, 'fill-color', this.color);
    }

    if (opacity !== undefined) {
      this.map.setPaintProperty(this.layerId, 'fill-opacity', this.opacity);
    }
  }

  _emptyFeatureCollection() {
    return {
      type: 'FeatureCollection',
      features: [],
    };
  }

  _projectGeometry({
    geometry,
    heightM,
    sunAzimuthDeg,
    sunElevationDeg,
  }) {
    const h = Math.max(0.1, Number(heightM) || 10);
    const alt = Math.max(5, Math.min(85, Number(sunElevationDeg) || 54)) * Math.PI / 180;
    const az = (Number(sunAzimuthDeg) || 144) * Math.PI / 180;

    // Shadow direction is opposite from sun direction on ground plane.
    const lengthM = h / Math.tan(alt);

    // lon/lat projection, locally approximated per coordinate latitude.
    const dxEastM = -Math.sin(az) * lengthM;
    const dyNorthM = -Math.cos(az) * lengthM;

    const projectCoord = (coord) => {
      const lng = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return coord;

      const meters = this._metersPerDegreeAtLat(lat);
      if (!meters) return coord;

      const shadowLng = lng + dxEastM / meters.lon;
      const shadowLat = lat + dyNorthM / meters.lat;

      return coord.length > 2
        ? [shadowLng, shadowLat, coord[2]]
        : [shadowLng, shadowLat];
    };

    const projectRing = (ring) => (ring || []).map(projectCoord);
    const projectPolygon = (poly) => (poly || []).map(projectRing);

    if (geometry.type === 'Polygon') {
      return {
        type: 'Polygon',
        coordinates: projectPolygon(geometry.coordinates),
      };
    }

    if (geometry.type === 'MultiPolygon') {
      return {
        type: 'MultiPolygon',
        coordinates: (geometry.coordinates || []).map(projectPolygon),
      };
    }

    return null;
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

    return {
      lat: mPerDegLat,
      lon: mPerDegLon,
    };
  }
}
