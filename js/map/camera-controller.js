/**
 * camera-controller.js
 *
 * MapLibre camera helper for Petiteau selection flows.
 *
 * Purpose:
 * - Move toward a selected building bbox.
 * - Preserve the user's current bearing / pitch.
 * - Avoid map.fitBounds(), because it can reset or normalize the view direction.
 */
export class CameraController {
  constructor(map) {
    this.map = map;
  }

  setMap(map) {
    this.map = map;
  }

  /**
   * Fit a building bbox while keeping the current bearing and pitch.
   *
   * @param {number[]} bbox [west, south, east, north]
   * @param {object} options
   * @param {number} options.maxZoom
   * @param {number} options.duration
   * @returns {boolean} true when camera movement was requested
   */
  fitBuildingBboxKeepView(bbox, options = {}) {
    if (!Array.isArray(bbox) || bbox.length < 4) return false;
    if (!this.map) return false;

    const west = Number(bbox[0]);
    const south = Number(bbox[1]);
    const east = Number(bbox[2]);
    const north = Number(bbox[3]);

    if (
      !Number.isFinite(west) ||
      !Number.isFinite(south) ||
      !Number.isFinite(east) ||
      !Number.isFinite(north)
    ) {
      return false;
    }

    const canvas = this.map.getCanvas?.();
    if (!canvas) return false;

    const viewWidth = canvas.clientWidth || canvas.width || 390;
    const viewHeight = canvas.clientHeight || canvas.height || 844;

    // 90 / 390 ≒ 0.23
    // Keep the mobile composition, and increase side padding on wider screens.
    const responsiveSidePadding = Math.max(
      90,
      Math.round(viewWidth * 0.23),
    );

    const isMobileView = this._isMobileView(viewWidth, viewHeight);

    const padding = {
      top: 90,
      bottom: 90,
      left: responsiveSidePadding,
      right: responsiveSidePadding,
    };

    const currentBearing = this.map.getBearing();
    const currentPitch = this.map.getPitch();
    const maxZoom = Number.isFinite(Number(options.maxZoom))
      ? Number(options.maxZoom)
      : 19;
    const duration = Number.isFinite(Number(options.duration))
      ? Number(options.duration)
      : 900;

    const bounds = [
      [west, south],
      [east, north],
    ];

    const camera = this.map.cameraForBounds?.(bounds, {
      padding,
      maxZoom,
      bearing: currentBearing,
      pitch: currentPitch,
    });

    if (!camera?.center || !Number.isFinite(Number(camera.zoom))) {
      return false;
    }

    const zoom = Math.min(
      maxZoom,
      Number(camera.zoom) + this._getMobileSelectionZoomBoost({
        west,
        south,
        east,
        north,
        isMobileView,
      }),
    );

    this.map.easeTo({
      center: camera.center,
      zoom,
      bearing: currentBearing,
      pitch: currentPitch,
      duration,
      essential: true,
    });

    return true;
  }

  _isMobileView(viewWidth, viewHeight) {
    const minSide = Math.min(Number(viewWidth) || 0, Number(viewHeight) || 0);
    const maxSide = Math.max(Number(viewWidth) || 0, Number(viewHeight) || 0);

    if (typeof window !== 'undefined') {
      try {
        if (window.matchMedia?.('(pointer: coarse)')?.matches) return true;
      } catch {
        // Ignore matchMedia errors and fall back to size-based detection.
      }
    }

    return minSide > 0 && minSide <= 760 && maxSide <= 1180;
  }

  _getMobileSelectionZoomBoost({ west, south, east, north, isMobileView }) {
    if (!isMobileView) return 0;

    const longSideM = this._bboxLongSideMeters(west, south, east, north);
    if (!Number.isFinite(longSideM) || longSideM <= 0) return 0.5;

    // Visual size target on mobile:
    // - large buildings: about 140% of the previous size  => log2(1.4) ≒ +0.49
    // - small buildings: about 180% of the previous size  => log2(1.8) ≒ +0.85
    const largeBoost = Math.log2(1.4);
    const smallBoost = Math.log2(1.8);

    // Long side thresholds are intentionally soft.
    // Typical detached / small buildings stay near 180%, while large public or
    // commercial blocks stay near 140% to avoid cropping too aggressively.
    const smallLongSideM = 45;
    const largeLongSideM = 90;

    if (longSideM <= smallLongSideM) return smallBoost;
    if (longSideM >= largeLongSideM) return largeBoost;

    const t = (longSideM - smallLongSideM) / (largeLongSideM - smallLongSideM);
    return smallBoost + (largeBoost - smallBoost) * t;
  }

  _bboxLongSideMeters(west, south, east, north) {
    const centerLatRad = (((south + north) / 2) * Math.PI) / 180;
    const metersPerDegLat = 111_320;
    const metersPerDegLon = Math.max(
      1,
      metersPerDegLat * Math.cos(centerLatRad),
    );

    const widthM = Math.abs(east - west) * metersPerDegLon;
    const heightM = Math.abs(north - south) * metersPerDegLat;
    return Math.max(widthM, heightM);
  }
}
