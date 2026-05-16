/**
 * Application state singleton for Petiteau2 viewer.
 * All mutable global state lives here; modules import this object and mutate it in place.
 */
export const state = {
  // ── Area selection ────────────────────────────────────────────────────────

  /** @type {object|null} Currently selected area entry from areas.json */
  selectedArea: null,

  /** @type {string|null} Base URL path for the selected area's assets, e.g. "bldg_luse/27_osakafu/27204_ikedashi" */
  areaBasePath: null,

  // ── Layer visibility flags ────────────────────────────────────────────────

  footprintEnabled: true,
  lod2Enabled: true,
  tranEnabled: true,
  tranGlbEnabled: true,
  luseGreenEnabled: true,

  // ── Selection state ───────────────────────────────────────────────────────

  /**
   * Selected building feature ID.
   *
   * Note:
   * Current PMTiles footprint features may not have stable feature.id.
   * The building-selection flow should not depend on this value.
   */
  selectedBuildingId: null,

  /**
   * Selected footprint building key used by PMTiles features.
   * Viewer-side footprint reassembly uses mi to merge tile fragments back into one building.
   *
   * @type {number|string|null}
   */
  selectedFootprintMi: null,

  /**
   * Selected building geometry copied from clicked footprint feature.
   * Used for id-free building-unit selection, bbox fit, scan, and shadow.
   *
   * @type {object|null}
   */
  selectedBuildingGeometry: null,

  /**
   * Selected building properties copied from clicked footprint feature.
   *
   * @type {object|null}
   */
  selectedBuildingProperties: null,

  /**
   * Selected chome code when LOD2 GLB context highlight is used.
   * Building-unit selection itself is handled by selectedBuildingGeometry.
   *
   * @type {string|null}
   */
  selectedChomeId: null,

  /**
   * Active exclusive building selection mode.
   * null         : normal mixed view / no exclusive selection
   * 'lod2'       : LOD2-derived building is selected; footprint pseudo-3D is hidden and not pickable
   * 'footprint'  : footprint-derived building is selected; LOD2 GLB is hidden and not pickable
   *
   * @type {'lod2'|'footprint'|null}
   */
  activeBuildingLayerMode: null,

  // ── LOD2 GLB tracking ────────────────────────────────────────────────────

  /**
   * Map from chome_code → { group: THREE.Group, url: string, sizeBytes: number }
   * Managed by GlbCombinedLayer; read by ui-panel for debug counts.
   *
   * @type {Map<string, {group: object, url: string, sizeBytes: number}>}
   */
  loadedChomeGlbs: new Map(),

  // ── Camera state for "戻る" button ────────────────────────────────────────

  /**
   * Saved camera state before a selection fly-to, restored by the back button.
   *
   * @type {{center: [number, number], zoom: number, bearing: number, pitch: number}|null}
   */
  previousCameraState: null,

  // ── Tran / road GLB ──────────────────────────────────────────────────────

  tranLoaded: false,

  // ── Performance counters ─────────────────────────────────────────────────

  fps: 0,
  _lastFrameTime: performance.now(),
  _frameCount: 0,
};