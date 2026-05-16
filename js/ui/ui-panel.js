/**
 * ui-panel.js v18 (Modified)
 * - スクリーンショット(2026-05-07)に基づきデフォルト値を更新
 * - 照明、FOOTPRINT表示、LOD2表示の初期値をUIパネルの値に準拠
 */
import { state } from '../state.js';

export class UiPanel {
  constructor(mapApp, containerId = 'petiteau-panel') {
    this.mapApp      = mapApp;
    this.containerId = containerId;
    this._root       = null;
    this._debugTimer = null;
    this._fpsFrames  = 0;
    this._fpsLast    = performance.now();
    this._pathfinderActive = false;
    this._normalPitchMode = 'bird';
    this._previousNormalCamera = null;
    this._buildingMode = 'both';
    this._lod2MaterialModeActive = false;
    this._lod2MaterialModeStep = 0;
    this._lod2MaterialModeBackup = null;

    // UI整理 Step 1.1: 水平自動回転
    // 軽量表示の余力を使った常時演出。Pathfinder中は道路進行方向制御と衝突するため停止。
    this._autoRotateActive = false;
    this._autoRotateRaf = null;
    this._autoRotateLastTime = 0;
    this._autoRotateSpeedDegPerSec = 4;
    this._autoRotateSuspendUntil = 0;
    this._autoRotatePcStartZoom = 17;
    this._autoRotatePendingStart = false;
    this._autoRotatePendingTimer = null;
  }

  mount() {
    this._root = document.getElementById(this.containerId);

    if (!this._root) {
      this._root = document.createElement('div');
      this._root.id = this.containerId;
      document.body.appendChild(this._root);
    }

    this._root.innerHTML = this._buildHTML();

    this._ensureHud();
    this._ensureGpsDock();
    this._ensureBottomControls();
    this._ensureMinimizedPanelStyle();
    this._attachEvents();
    this._setPanelCollapsed(true);
    this._startDebugLoop();
  }

  _buildHTML() {
    return `
      <div class="panel-header">
        <button class="panel-toggle-btn" id="panel-collapse-btn" title="パネルを折りたたむ">◀</button>
        <span class="panel-title">Petiteau<sup>2</sup></span>
      </div>

      <div class="panel-body" id="panel-body">

        <section class="panel-section">
          <h3 class="section-title">エリア</h3>
          <div id="area-name" class="area-name">読み込み中…</div>
        </section>

        <section class="panel-section">
          <h3 class="section-title">レイヤー</h3>

          <label class="toggle-row">
            <span class="toggle-label">建物 Footprint</span>
            <input type="checkbox" id="toggle-footprint" checked>
          </label>

          <label class="toggle-row">
            <span class="toggle-label">LOD2 hollow</span>
            <input type="checkbox" id="toggle-lod2" checked>
          </label>

          <label class="toggle-row">
            <span class="toggle-label">GLB 道路</span>
            <input type="checkbox" id="toggle-tran-glb" checked>
          </label>

          <div class="color-row">
            <span class="slider-label">　色</span>
            <input type="color" id="tran-glb-color" value="#8798a8">
            <span id="tran-glb-color-val">#8798a8</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">　opacity</span>
            <input type="range" id="tran-glb-opacity" min="0" max="100" value="100">
            <span id="tran-glb-opacity-val">100%</span>
          </div>

          <label class="toggle-row">
            <span class="toggle-label">GSI 道路</span>
            <input type="checkbox" id="toggle-gsi-road">
          </label>

          <div class="color-row" id="gsi-road-controls" style="display:none">
            <span class="slider-label">　色</span>
            <input type="color" id="gsi-road-color" value="#b0b8c8">
            <span id="gsi-road-color-val">#b0b8c8</span>
          </div>

          <div class="slider-row" id="gsi-road-opacity-row" style="display:none">
            <span class="slider-label">　opacity</span>
            <input type="range" id="gsi-road-opacity" min="0" max="100" value="100">
            <span id="gsi-road-opacity-val">100%</span>
          </div>

          <label class="toggle-row">
            <span class="toggle-label">公園・緑地</span>
            <input type="checkbox" id="toggle-luse-green" checked>
          </label>

          <div class="color-row">
            <span class="slider-label">　色</span>
            <input type="color" id="luse-green-color" value="#1ba66c">
            <span id="luse-green-color-val">#1ba66c</span>
          </div>

          <label class="toggle-row">
            <span class="toggle-label">校庭・グラウンド</span>
            <input type="checkbox" id="toggle-luse-schoolyard" checked>
          </label>

          <div class="color-row">
            <span class="slider-label">　色</span>
            <input type="color" id="luse-school-color" value="#c8ad6a">
            <span id="luse-school-color-val">#c8ad6a</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">緑地 opacity</span>
            <input type="range" id="slider-luse-opacity" min="0" max="100" value="75">
            <span id="luse-opacity-val">75%</span>
          </div>
        </section>

        <section class="panel-section">
          <h3 class="section-title">☀️ 照明 LOD1（Footprint）</h3>

          <div class="slider-row">
            <span class="slider-label">方位角</span>
            <input type="range" id="lod1-sun-azimuth" min="0" max="360" value="144">
            <span id="lod1-sun-azimuth-val">144°</span>
          </div>

          <div class="slider-hint">MapLibre fill-extrusion 用。0=北 90=東 180=南 270=西</div>

          <div class="slider-row">
            <span class="slider-label">仰角</span>
            <input type="range" id="lod1-sun-elevation" min="5" max="85" value="54">
            <span id="lod1-sun-elevation-val">54°</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">太陽強度</span>
            <input type="range" id="lod1-sun-intensity" min="0" max="100" value="31">
            <span id="lod1-sun-intensity-val">31%</span>
          </div>

          <div class="color-row">
            <span class="slider-label">環境光色</span>
            <input type="color" id="lod1-ambient-color" value="#f3f5fc">
            <span id="lod1-ambient-color-val">#f3f5fc</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">環境光強度</span>
            <input type="range" id="lod1-ambient-intensity" min="0" max="180" value="0">
            <span id="lod1-ambient-intensity-val">0%</span>
          </div>

          <div class="slider-hint">LOD1 は軽量優先。Cyan fill / Purple rim / Shadow は LOD2 側のみ。</div>
        </section>

        <section class="panel-section">
          <h3 class="section-title">☀️ 照明 LOD2（GLB）</h3>

          <div class="slider-row">
            <span class="slider-label">方位角</span>
            <input type="range" id="lod2-sun-azimuth" min="0" max="360" value="144">
            <span id="lod2-sun-azimuth-val">144°</span>
          </div>

          <div class="slider-hint">Three.js LOD2 用。0=北 90=東 180=南 270=西</div>

          <div class="slider-row">
            <span class="slider-label">仰角</span>
            <input type="range" id="lod2-sun-elevation" min="5" max="85" value="54">
            <span id="lod2-sun-elevation-val">54°</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">太陽強度</span>
            <input type="range" id="lod2-sun-intensity" min="0" max="100" value="51">
            <span id="lod2-sun-intensity-val">51%</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">環境光</span>
            <input type="range" id="lod2-lighting-ambient-intensity" min="0" max="150" value="150">
            <span id="lod2-lighting-ambient-intensity-val">150%</span>
          </div>

          <div class="color-row">
            <span class="slider-label">環境光色</span>
            <input type="color" id="lighting-ambient-color" value="#ffffff">
            <span id="lighting-ambient-color-val">#ffffff</span>
          </div>

          <div class="color-row">
            <span class="slider-label">Cyan fill</span>
            <input type="color" id="lighting-fill-color" value="#fcfdfd">
            <span id="lighting-fill-color-val">#fcfdfd</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">Fill 強度</span>
            <input type="range" id="lighting-fill-intensity" min="0" max="200" value="200">
            <span id="lighting-fill-intensity-val">200%</span>
          </div>

          <div class="color-row">
            <span class="slider-label">Purple rim</span>
            <input type="color" id="lighting-rim-color" value="#7790f3">
            <span id="lighting-rim-color-val">#7790f3</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">Rim 強度</span>
            <input type="range" id="lighting-rim-intensity" min="0" max="120" value="120">
            <span id="lighting-rim-intensity-val">120%</span>
          </div>

          <div class="control-row">
            <span class="slider-label">Shadow</span>
            <select id="lighting-shadow-quality">
              <option value="0">OFF</option>
              <option value="1024">1024</option>
              <option value="2048" selected>2048</option>
            </select>
          </div>

          <div class="slider-hint">LOD2 4灯 + shadow。Shadow は PC + zoom19以上で有効、mobile はOFF維持</div>
        </section>

        <section class="panel-section">
          <h3 class="section-title">GLB 原点補正</h3>

          <div class="origin-row">
            <span class="slider-label">Δlon</span>
            <input type="number" id="glb-dlon" value="0" step="0.000001" min="-0.01" max="0.01">
          </div>

          <div class="origin-row">
            <span class="slider-label">Δlat</span>
            <input type="number" id="glb-dlat" value="0" step="0.000001" min="-0.01" max="0.01">
          </div>

          <div class="origin-hint">建物GLB・道路GLB を一括移動<br>1目盛 ≈ 0.1m（緯度方向）</div>

          <button id="btn-origin-reset" class="btn-back" style="margin-top:6px">リセット</button>
        </section>

        <section class="panel-section">
          <h3 class="section-title">◆地面・ベース</h3>

          <div class="color-row">
            <span class="slider-label">地面色</span>
            <input type="color" id="ground-color" value="#e7eaf3">
            <span id="ground-color-val">#e7eaf3</span>
          </div>
        </section>

        <section class="panel-section">
          <h3 class="section-title">◆FOOTPRINT 2D</h3>

          <div class="color-row">
            <span class="slider-label">2D 塗り</span>
            <input type="color" id="fp-fill-color" value="#ffffff">
            <span id="fp-fill-color-val">#ffffff</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">2D opacity</span>
            <input type="range" id="fp-fill-opacity" min="0" max="100" value="96">
            <span id="fp-fill-opacity-val">96%</span>
          </div>

          <div class="color-row">
            <span class="slider-label">2D 輪郭線</span>
            <input type="color" id="fp-line-color" value="#3d607b">
            <span id="fp-line-color-val">#3d607b</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">線 opacity</span>
            <input type="range" id="fp-line-opacity" min="0" max="100" value="51">
            <span id="fp-line-opacity-val">51%</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">線幅</span>
            <input type="range" id="fp-line-width" min="0" max="40" value="4">
            <span id="fp-line-width-val">0.4</span>
          </div>
        </section>

        <section class="panel-section">
          <h3 class="section-title">◆FOOTPRINT 疑似3D</h3>

          <div class="color-row">
            <span class="slider-label">3D 屋根色</span>
            <input type="color" id="fp3d-roof-color" value="#ffffff">
            <span id="fp3d-roof-color-val">#ffffff</span>
          </div>

          <div class="color-row">
            <span class="slider-label">3D 壁色</span>
            <input type="color" id="fp3d-wall-color" value="#c5cbe2">
            <span id="fp3d-wall-color-val">#c5cbe2</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">屋根 太陽光</span>
            <input type="range" id="fp3d-roof-sun" min="0" max="200" value="112">
            <span id="fp3d-roof-sun-val">112%</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">壁 太陽光</span>
            <input type="range" id="fp3d-wall-sun" min="0" max="200" value="200">
            <span id="fp3d-wall-sun-val">200%</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">3D opacity</span>
            <input type="range" id="fp3d-opacity" min="0" max="100" value="96">
            <span id="fp3d-opacity-val">96%</span>
          </div>

          <div class="color-row">
            <span class="slider-label">環境光色</span>
            <input type="color" id="fp3d-ambient-color" value="#f3f5fc">
            <span id="fp3d-ambient-color-val">#f3f5fc</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">環境光強度</span>
            <input type="range" id="fp3d-ambient-strength" min="0" max="180" value="0">
            <span id="fp3d-ambient-strength-val">0%</span>
          </div>

          <div class="slider-hint">屋根/壁分離は wall layer + 薄い roof cap layer による疑似分離です</div>
        </section>

        <section class="panel-section">
          <h3 class="section-title">◆LOD2 表示</h3>

          <div class="color-row">
            <span class="slider-label">LOD2 屋根色</span>
            <input type="color" id="lod2-roof-color" value="#fcfcfc">
            <span id="lod2-roof-color-val">#fcfcfc</span>
          </div>

          <div class="color-row">
            <span class="slider-label">LOD2 壁色</span>
            <input type="color" id="lod2-wall-color" value="#ededf3">
            <span id="lod2-wall-color-val">#ededf3</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">屋根 太陽光</span>
            <input type="range" id="lod2-roof-sun" min="0" max="200" value="96">
            <span id="lod2-roof-sun-val">96%</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">壁 太陽光</span>
            <input type="range" id="lod2-wall-sun" min="0" max="200" value="65">
            <span id="lod2-wall-sun-val">65%</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">3D opacity</span>
            <input type="range" id="lod2-opacity" min="0" max="100" value="100">
            <span id="lod2-opacity-val">100%</span>
          </div>

          <div class="color-row">
            <span class="slider-label">環境光色</span>
            <input type="color" id="lod2-ambient-color" value="#ffffff">
            <span id="lod2-ambient-color-val">#ffffff</span>
          </div>

          <div class="slider-row">
            <span class="slider-label">環境光強度</span>
            <input type="range" id="lod2-ambient-strength" min="0" max="200" value="100">
            <span id="lod2-ambient-strength-val">100%</span>
          </div>

          <div class="slider-hint">LOD2 GLB の通常表示 material に適用。選択中の水色ハイライトは別制御です</div>
        </section>


        <section class="panel-section">
          <h3 class="section-title">◆レーザースキャン</h3>

          <div class="slider-row">
            <span class="slider-label">幅</span>
            <input type="range" id="lod2-scan-width" min="1" max="5" value="2">
            <span id="lod2-scan-width-val">0.2m</span>
          </div>

          <div class="color-row">
            <span class="slider-label">色</span>
            <input type="color" id="lod2-scan-color" value="#ffffff">
            <span id="lod2-scan-color-val">#ffffff</span>
          </div>

          <div class="slider-hint">LOD2建物選択後の高さ走査に適用</div>
        </section>

        <section class="panel-section">
          <h3 class="section-title">デバッグ</h3>

          <div class="debug-grid">
            <span>LOD2 丁数</span><span id="dbg-chome-count">0</span>
            <span>GLB 合計</span><span id="dbg-glb-mb">0 MB</span>
            <span>GLB 道路</span><span id="dbg-tran">未ロード</span>
            <span>FPS</span><span id="dbg-fps">—</span>
            <span>zoom</span><span id="dbg-zoom">—</span>
            <span>luse</span><span id="dbg-luse-count">—</span>
          </div>
        </section>

        <section class="panel-section" id="selection-section" style="display:none">
          <h3 class="section-title">選択建物</h3>
          <div id="selection-info" class="selection-info"></div>
          <button id="btn-back" class="btn-back">◀ 戻る</button>
        </section>

      </div>
    `;
  }

  _ensureHud() {
    if (document.getElementById('petiteau-hud')) return;

    if (!document.getElementById('petiteau-ui-step1-style')) {
      const style = document.createElement('style');
      style.id = 'petiteau-ui-step1-style';
      style.textContent = `
        #petiteau-hud {
          position:fixed !important;
          right:14px !important;
          top:14px !important;
          z-index:9998 !important;
          min-width:132px;
          padding:8px 10px;
          border-radius:14px;
          background:rgba(13,18,32,0.72);
          color:rgba(236,244,255,0.94);
          border:1px solid rgba(255,255,255,0.16);
          box-shadow:0 10px 28px rgba(0,0,0,0.28);
          backdrop-filter:blur(10px);
          font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          user-select:none;
          pointer-events:none;
        }

        #petiteau-hud .hud-row {
          display:grid;
          grid-template-columns:1fr auto;
          gap:10px;
          align-items:center;
          font-size:11px;
          line-height:1.35;
        }

        #petiteau-hud .hud-label {
          color:rgba(210,222,240,0.72);
          letter-spacing:0.02em;
        }

        #petiteau-hud .hud-value {
          font-weight:800;
          color:#ffffff;
          text-align:right;
          font-variant-numeric:tabular-nums;
        }

        #petiteau-hud .hud-value.is-on {
          color:#6ff7ff;
        }

        #petiteau-hud .hud-value.fps-red { color:#ff4b4b; }
        #petiteau-hud .hud-value.fps-yellow { color:#ffd84a; }
        #petiteau-hud .hud-value.fps-green { color:#43e66d; }
        #petiteau-hud .hud-value.fps-blue { color:#56a8ff; }

        #petiteau-gps-dock {
          position:fixed !important;
          right:14px !important;
          bottom:18px !important;
          z-index:9998 !important;
          min-width:92px;
          padding:8px 10px;
          border-radius:14px;
          background:rgba(13,18,32,0.72);
          color:rgba(236,244,255,0.94);
          border:1px solid rgba(255,255,255,0.16);
          box-shadow:0 10px 28px rgba(0,0,0,0.28);
          backdrop-filter:blur(10px);
          font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          font-size:12px;
          font-weight:800;
          text-align:center;
          user-select:none;
          pointer-events:none;
        }

        #petiteau-bottom-controls {
          position:fixed !important;
          left:50% !important;
          bottom:18px !important;
          transform:translateX(-50%);
          z-index:9999 !important;
          display:flex;
          align-items:center;
          justify-content:center;
          gap:8px;
          padding:8px;
          border-radius:18px;
          background:rgba(13,18,32,0.66);
          border:1px solid rgba(255,255,255,0.15);
          box-shadow:0 12px 30px rgba(0,0,0,0.30);
          backdrop-filter:blur(10px);
          user-select:none;
        }

        #petiteau-bottom-controls .petiteau-control-btn {
          width:42px;
          height:42px;
          border-radius:14px;
          border:1px solid rgba(255,255,255,0.22);
          background:rgba(255,255,255,0.08);
          color:#ffffff;
          font-size:13px;
          font-weight:800;
          line-height:1;
          cursor:pointer;
          display:flex;
          align-items:center;
          justify-content:center;
          transition:background 120ms ease, transform 120ms ease, border-color 120ms ease;
        }

        #petiteau-bottom-controls .petiteau-control-btn:hover {
          background:rgba(111,247,255,0.18);
          border-color:rgba(111,247,255,0.50);
          transform:translateY(-1px);
        }

        #petiteau-bottom-controls .petiteau-control-btn.is-active {
          background:rgba(25,199,201,0.34);
          border-color:rgba(111,247,255,0.70);
          color:#ffffff;
        }

        @media (max-width:720px) {
          #petiteau-hud {
            right:10px !important;
            top:10px !important;
            min-width:118px;
            padding:7px 8px;
          }

          #petiteau-gps-dock {
            right:10px !important;
            bottom:76px !important;
          }

          #petiteau-bottom-controls {
            bottom:12px !important;
            gap:6px;
            padding:6px;
            max-width:calc(100vw - 18px);
          }

          #petiteau-bottom-controls .petiteau-control-btn {
            width:38px;
            height:38px;
            border-radius:13px;
            font-size:12px;
          }
        }
      `;

      document.head.appendChild(style);
    }

    const hud = document.createElement('div');
    hud.id = 'petiteau-hud';
    hud.innerHTML = `
      <div class="hud-row"><span class="hud-label">FPS</span><span class="hud-value" id="hud-fps">--</span></div>
      <div class="hud-row"><span class="hud-label">zoom</span><span class="hud-value" id="hud-zoom">--</span></div>
      <div class="hud-row"><span class="hud-label">pitch</span><span class="hud-value" id="hud-pitch">--</span></div>
      <div class="hud-row"><span class="hud-label">bearing</span><span class="hud-value" id="hud-bearing">--</span></div>
    `;

    document.body.appendChild(hud);
  }

  _ensureGpsDock() {
    // GPS status/control is now placed in the bottom-right control slot.
    // Remove the old floating right-bottom dock if an older DOM instance remains.
    const oldDock = document.getElementById('petiteau-gps-dock');
    if (oldDock) oldDock.remove();
  }

  _ensureBottomControls() {
    let controls = document.getElementById('petiteau-bottom-controls');

    if (!controls) {
      controls = document.createElement('div');
      controls.id = 'petiteau-bottom-controls';
      document.body.appendChild(controls);
    }

    // 既存DOMに古い「影」ボタンが残っているケースを避けるため、
    // 下段操作ボタンは毎回ここで正本に差し替える。
    controls.innerHTML = `
      <button class="petiteau-control-btn" id="btn-material" title="M: Blue glass 60% / Gray glass 58%">M</button>
      <button class="petiteau-control-btn" id="btn-rotate" title="水平自動回転 ON/OFF">⟳</button>
      <button class="petiteau-control-btn" id="btn-zoom-in" title="ズームイン">＋</button>
      <button class="petiteau-control-btn" id="btn-zoom-out" title="ズームアウト">−</button>
      <button class="petiteau-control-btn" id="btn-view-pitch" title="真上 0° / 斜め 50°">50°</button>
      <button class="petiteau-control-btn" id="btn-pathfinder" title="Pathfinder 80°">PF</button>
      <button class="petiteau-control-btn" id="btn-gps" title="GPS OFF（実連動は次段階）">GPS</button>
    `;
  }

  _setPanelCollapsed(collapsed) {
    const body = this._root.querySelector('#panel-body');
    const btn  = this._root.querySelector('#panel-collapse-btn');

    this._root.classList.toggle('panel-collapsed', Boolean(collapsed));

    if (body) {
      body.style.display = collapsed ? 'none' : '';
    }

    if (btn) {
      btn.textContent = collapsed ? '▼' : '◀';
      btn.title = collapsed ? 'パネルを開く' : 'パネルを折りたたむ';
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
  }

  _ensureMinimizedPanelStyle() {
    if (document.getElementById('petiteau-minimized-panel-style')) return;

    const style = document.createElement('style');
    style.id = 'petiteau-minimized-panel-style';
    style.textContent = `
      #petiteau-panel .panel-header {
        display:flex !important;
        align-items:center !important;
        justify-content:flex-start !important;
        gap:8px !important;
      }

      #petiteau-panel #panel-collapse-btn {
        order:0 !important;
        flex:0 0 auto !important;
        margin-left:0 !important;
        margin-right:6px !important;
      }

      #petiteau-panel .panel-title {
        order:1 !important;
        flex:1 1 auto !important;
        min-width:0 !important;
      }

      @media (max-width: 768px) {
        #petiteau-panel:not(.panel-collapsed) {
          left:8px !important;
          right:auto !important;
          width:min(320px, calc(100vw - 16px)) !important;
          max-width:calc(100vw - 16px) !important;
        }

        #petiteau-panel:not(.panel-collapsed) .panel-header {
          position:sticky !important;
          top:0 !important;
          z-index:2 !important;
        }
      }

      #petiteau-panel.panel-collapsed {
        width:56px !important;
        min-width:56px !important;
        max-width:56px !important;
        height:56px !important;
        overflow:visible !important;
        border-radius:18px !important;
        background:transparent !important;
        border:none !important;
        box-shadow:none !important;
      }

      #petiteau-panel.panel-collapsed .panel-header {
        width:56px !important;
        height:56px !important;
        padding:0 !important;
        display:flex !important;
        align-items:center !important;
        justify-content:center !important;
        border-radius:18px !important;
        background:#19c7c9 !important;
        border:1px solid rgba(255,255,255,0.42) !important;
        box-shadow:0 10px 26px rgba(0,0,0,0.32) !important;
      }

      #petiteau-panel.panel-collapsed .panel-title {
        display:none !important;
      }

      #petiteau-panel.panel-collapsed #panel-collapse-btn {
        width:48px !important;
        height:48px !important;
        border:none !important;
        border-radius:15px !important;
        background:#19c7c9 !important;
        color:#ffffff !important;
        font-size:22px !important;
        line-height:48px !important;
        text-align:center !important;
        cursor:pointer !important;
      }

      #petiteau-panel.panel-collapsed #panel-collapse-btn:hover {
        background:#12bfc1 !important;
      }

      .origin-row {
        display:flex;
        align-items:center;
        gap:8px;
        margin:4px 0;
      }

      .origin-row .slider-label {
        min-width:36px;
        font-size:12px;
      }

      .origin-row input[type=number] {
        width:110px;
        padding:3px 6px;
        border-radius:6px;
        border:1px solid rgba(255,255,255,0.2);
        background:rgba(255,255,255,0.08);
        color:inherit;
        font-size:12px;
        font-family:monospace;
      }

      .origin-hint {
        font-size:11px;
        color:rgba(200,210,230,0.65);
        margin-top:2px;
        line-height:1.5;
      }

      .slider-hint {
        font-size:11px;
        color:rgba(200,210,230,0.55);
        margin:-2px 0 4px 0;
        line-height:1.4;
      }
    `;

    document.head.appendChild(style);
  }

  _ensureFloatingStatus() {
    // UI整理 Step 1 では右上HUDへ統合。互換用の no-op。
  }

  _attachEvents() {
    this._root.querySelector('#panel-collapse-btn').addEventListener('click', () => {
      this._setPanelCollapsed(!this._root.classList.contains('panel-collapsed'));
    });

    this._attachStep1ControlEvents();

    this._root.querySelector('#toggle-footprint').addEventListener('change', (e) => {
      this.mapApp.setFootprintVisible(e.target.checked);
    });

    this._root.querySelector('#toggle-lod2').addEventListener('change', (e) => {
      this.mapApp.setLod2Visible(e.target.checked);
    });

    // GLB 道路
    this._root.querySelector('#toggle-tran-glb').addEventListener('change', (e) => {
      this.mapApp.setTranGlbVisible(e.target.checked);
    });

    const tranColor    = this._root.querySelector('#tran-glb-color');
    const tranColorVal = this._root.querySelector('#tran-glb-color-val');

    tranColor.addEventListener('input', (e) => {
      tranColorVal.textContent = e.target.value;
      this.mapApp.setTranGlbColor(e.target.value);
    });

    const tranOpacity    = this._root.querySelector('#tran-glb-opacity');
    const tranOpacityVal = this._root.querySelector('#tran-glb-opacity-val');

    tranOpacity.addEventListener('input', (e) => {
      tranOpacityVal.textContent = `${e.target.value}%`;
      this.mapApp.setTranGlbOpacity(Number(e.target.value) / 100);
    });

    // GSI 道路
    const gsiRoadToggle     = this._root.querySelector('#toggle-gsi-road');
    const gsiRoadControls   = this._root.querySelector('#gsi-road-controls');
    const gsiRoadOpacityRow = this._root.querySelector('#gsi-road-opacity-row');

    gsiRoadToggle.addEventListener('change', (e) => {
      const visible = e.target.checked;

      this.mapApp.setGsiRoadVisible(visible);

      gsiRoadControls.style.display   = visible ? '' : 'none';
      gsiRoadOpacityRow.style.display = visible ? '' : 'none';
    });

    const gsiRoadColor    = this._root.querySelector('#gsi-road-color');
    const gsiRoadColorVal = this._root.querySelector('#gsi-road-color-val');

    gsiRoadColor.addEventListener('input', (e) => {
      gsiRoadColorVal.textContent = e.target.value;
      this.mapApp.setGsiRoadColor(e.target.value);
    });

    const gsiRoadOpacity    = this._root.querySelector('#gsi-road-opacity');
    const gsiRoadOpacityVal = this._root.querySelector('#gsi-road-opacity-val');

    gsiRoadOpacity.addEventListener('input', (e) => {
      gsiRoadOpacityVal.textContent = `${e.target.value}%`;
      this.mapApp.setGsiRoadOpacity(Number(e.target.value) / 100);
    });

    // 緑地色
    const greenColor    = this._root.querySelector('#luse-green-color');
    const greenColorVal = this._root.querySelector('#luse-green-color-val');

    greenColor.addEventListener('input', (e) => {
      greenColorVal.textContent = e.target.value;
      this.mapApp.setLuseGreenColor(e.target.value);
    });

    const schoolColor    = this._root.querySelector('#luse-school-color');
    const schoolColorVal = this._root.querySelector('#luse-school-color-val');

    schoolColor.addEventListener('input', (e) => {
      schoolColorVal.textContent = e.target.value;
      this.mapApp.setLuseSchoolColor(e.target.value);
    });

    this._root.querySelector('#toggle-luse-green').addEventListener('change', (e) => {
      this.mapApp.setLuseGreenVisible(e.target.checked);
    });

    this._root.querySelector('#toggle-luse-schoolyard').addEventListener('change', (e) => {
      this.mapApp.setLuseSchoolyardVisible(e.target.checked);
    });

    const opSlider = this._root.querySelector('#slider-luse-opacity');
    const opVal    = this._root.querySelector('#luse-opacity-val');

    opSlider.addEventListener('input', (e) => {
      opVal.textContent = `${e.target.value}%`;
      this.mapApp.setLuseOpacity(Number(e.target.value) / 100);
    });

    // 照明
    const sliderBind = (id, valId, suffix, fn) => {
      const el  = this._root.querySelector(`#${id}`);
      const vel = this._root.querySelector(`#${valId}`);

      el.addEventListener('input', (e) => {
        vel.textContent = `${e.target.value}${suffix}`;
        fn(Number(e.target.value));
      });
    };

    sliderBind('lod1-sun-azimuth', 'lod1-sun-azimuth-val', '°', (v) => {
      this.mapApp.setLod1SunAzimuth?.(v);
    });

    sliderBind('lod1-sun-elevation', 'lod1-sun-elevation-val', '°', (v) => {
      this.mapApp.setLod1SunElevation?.(v);
    });

    sliderBind('lod1-sun-intensity', 'lod1-sun-intensity-val', '%', (v) => {
      this.mapApp.setLod1SunIntensity?.(v / 100);
    });

    sliderBind('lod1-ambient-intensity', 'lod1-ambient-intensity-val', '%', (v) => {
      this.mapApp.setFootprint3dAmbientStrength?.(v / 100);
    });

    sliderBind('lod2-sun-azimuth', 'lod2-sun-azimuth-val', '°', (v) => {
      this.mapApp.setLod2SunAzimuth?.(v);
    });

    sliderBind('lod2-sun-elevation', 'lod2-sun-elevation-val', '°', (v) => {
      this.mapApp.setLod2SunElevation?.(v);
    });

    sliderBind('lod2-sun-intensity', 'lod2-sun-intensity-val', '%', (v) => {
      this.mapApp.setLod2SunIntensity?.(v / 100);
    });

    sliderBind('lod2-lighting-ambient-intensity', 'lod2-lighting-ambient-intensity-val', '%', (v) => {
      this.mapApp.setLod2LightingAmbientIntensity?.(v / 100);
    });

    const bindLightingColor = (id, valId, fn) => {
      const el = this._root.querySelector(`#${id}`);
      const vel = this._root.querySelector(`#${valId}`);
      if (!el) return;
      el.addEventListener('input', (e) => {
        if (vel) vel.textContent = e.target.value;
        fn(e.target.value);
      });
    };

    bindLightingColor('lod1-ambient-color', 'lod1-ambient-color-val', (v) => {
      this.mapApp.setFootprint3dAmbientColor?.(v);
    });

    bindLightingColor('lighting-ambient-color', 'lighting-ambient-color-val', (v) => {
      this.mapApp.setLod2LightingAmbientColor(v);
    });

    bindLightingColor('lighting-fill-color', 'lighting-fill-color-val', (v) => {
      this.mapApp.setLod2FillColor(v);
    });

    sliderBind('lighting-fill-intensity', 'lighting-fill-intensity-val', '%', (v) => {
      this.mapApp.setLod2FillIntensity(v / 100);
    });

    bindLightingColor('lighting-rim-color', 'lighting-rim-color-val', (v) => {
      this.mapApp.setLod2RimColor(v);
    });

    sliderBind('lighting-rim-intensity', 'lighting-rim-intensity-val', '%', (v) => {
      this.mapApp.setLod2RimIntensity(v / 100);
    });

    const shadowQualityEl = this._root.querySelector('#lighting-shadow-quality');
    if (shadowQualityEl) {
      shadowQualityEl.addEventListener('change', (e) => {
        this.mapApp.setLod2ShadowQuality(Number(e.target.value));
      });
    }

    // 原点補正
    const dlonEl = this._root.querySelector('#glb-dlon');
    const dlatEl = this._root.querySelector('#glb-dlat');

    const applyOffset = () => {
      this.mapApp.setGlbOriginOffset(Number(dlonEl.value), Number(dlatEl.value));
    };

    dlonEl.addEventListener('input', applyOffset);
    dlatEl.addEventListener('input', applyOffset);

    this._root.querySelector('#btn-origin-reset').addEventListener('click', () => {
      dlonEl.value = 0;
      dlatEl.value = 0;
      this.mapApp.setGlbOriginOffset(0, 0);
    });

    // 地面色
    const groundColor    = this._root.querySelector('#ground-color');
    const groundColorVal = this._root.querySelector('#ground-color-val');

    groundColor.addEventListener('input', (e) => {
      groundColorVal.textContent = e.target.value;
      this.mapApp.setGroundColor(e.target.value);
    });

    // Footprint / LOD2 色
    const bind = (id, valId, fn, format = (v) => v) => {
      const el  = this._root.querySelector(`#${id}`);
      const vel = valId ? this._root.querySelector(`#${valId}`) : null;
      if (!el) return;

      el.addEventListener('input', (e) => {
        if (vel) vel.textContent = format(e.target.value);
        fn(e.target.value);
      });
    };

    bind('fp-fill-color', 'fp-fill-color-val', (v) => {
      this.mapApp.setFootprintFillColor(v);
    });

    bind('fp-fill-opacity', 'fp-fill-opacity-val', (v) => {
      this.mapApp.setFootprintFillOpacity(Number(v) / 100);
    }, (v) => `${v}%`);

    bind('fp-line-color', 'fp-line-color-val', (v) => {
      this.mapApp.setFootprintLineColor(v);
    });

    bind('fp-line-opacity', 'fp-line-opacity-val', (v) => {
      this.mapApp.setFootprintLineOpacity(Number(v) / 100);
    }, (v) => `${v}%`);

    bind('fp3d-roof-color', 'fp3d-roof-color-val', (v) => {
      this.mapApp.setFootprint3dRoofColor(v);
    });

    bind('fp3d-wall-color', 'fp3d-wall-color-val', (v) => {
      this.mapApp.setFootprint3dWallColor(v);
    });

    bind('fp3d-roof-sun', 'fp3d-roof-sun-val', (v) => {
      this.mapApp.setFootprint3dRoofSunStrength(Number(v) / 100);
    }, (v) => `${v}%`);

    bind('fp3d-wall-sun', 'fp3d-wall-sun-val', (v) => {
      this.mapApp.setFootprint3dWallSunStrength(Number(v) / 100);
    }, (v) => `${v}%`);

    bind('fp3d-opacity', 'fp3d-opacity-val', (v) => {
      this.mapApp.setFootprint3dOpacity(Number(v) / 100);
    }, (v) => `${v}%`);

    bind('fp3d-ambient-color', 'fp3d-ambient-color-val', (v) => {
      this.mapApp.setFootprint3dAmbientColor(v);
    });

    bind('fp3d-ambient-strength', 'fp3d-ambient-strength-val', (v) => {
      this.mapApp.setFootprint3dAmbientStrength(Number(v) / 100);
    }, (v) => `${v}%`);

    bind('lod2-roof-color', 'lod2-roof-color-val', (v) => {
      this.mapApp.setLod2RoofColor(v);
    });

    bind('lod2-wall-color', 'lod2-wall-color-val', (v) => {
      this.mapApp.setLod2WallColor(v);
    });

    bind('lod2-roof-sun', 'lod2-roof-sun-val', (v) => {
      this.mapApp.setLod2RoofSunStrength(Number(v) / 100);
    }, (v) => `${v}%`);

    bind('lod2-wall-sun', 'lod2-wall-sun-val', (v) => {
      this.mapApp.setLod2WallSunStrength(Number(v) / 100);
    }, (v) => `${v}%`);

    bind('lod2-opacity', 'lod2-opacity-val', (v) => {
      this.mapApp.setLod2Opacity(Number(v) / 100);
    }, (v) => `${v}%`);

    bind('lod2-ambient-color', 'lod2-ambient-color-val', (v) => {
      this.mapApp.setLod2AmbientColor(v);
    });

    bind('lod2-ambient-strength', 'lod2-ambient-strength-val', (v) => {
      this.mapApp.setLod2AmbientStrength(Number(v) / 100);
    }, (v) => `${v}%`);


    const scanWidthEl  = this._root.querySelector('#lod2-scan-width');
    const scanWidthVal = this._root.querySelector('#lod2-scan-width-val');

    if (scanWidthEl && scanWidthVal) {
      const isMobile = window.innerWidth <= 720;
      const defaultScanWidthM = isMobile ? 0.3 : 0.2;

      scanWidthEl.value = String(Math.round(defaultScanWidthM * 10));
      scanWidthVal.textContent = `${defaultScanWidthM.toFixed(1)}m`;
      this.mapApp.setLod2HeightScanBandWidth(defaultScanWidthM);

      scanWidthEl.addEventListener('input', (e) => {
        const widthM = Number(e.target.value) / 10;
        scanWidthVal.textContent = `${widthM.toFixed(1)}m`;
        this.mapApp.setLod2HeightScanBandWidth(widthM);
      });
    }

    const scanColorEl  = this._root.querySelector('#lod2-scan-color');
    const scanColorVal = this._root.querySelector('#lod2-scan-color-val');

    if (scanColorEl && scanColorVal) {
      scanColorEl.addEventListener('input', (e) => {
        scanColorVal.textContent = e.target.value;
        this.mapApp.setLod2HeightScanColor(e.target.value);
      });
    }

    const lwEl  = this._root.querySelector('#fp-line-width');
    const lwVal = this._root.querySelector('#fp-line-width-val');

    lwEl.addEventListener('input', (e) => {
      const v = Number(e.target.value) / 10;
      lwVal.textContent = v.toFixed(1);
      this.mapApp.setFootprintLineWidth(v);
    });

    this._root.querySelector('#btn-back').addEventListener('click', () => {
      this.mapApp.goBack();
    });

    this.mapApp.on('areaLoaded', ({ area }) => {
      const el = this._root.querySelector('#area-name');

      if (el) {
        el.textContent = `${area.name}（${area.city_code}）`;
      }

      setTimeout(() => this._refreshDebug(), 500);
    });

    this.mapApp.on('selectionChange', (data) => {
      this._updateSelectionPanel(data);
    });

    this.mapApp.on('zoomChange', ({ zoom }) => {
      const el = this._root.querySelector('#dbg-zoom');

      if (el) {
        el.textContent = zoom.toFixed(1);
      }
    });
  }

  _readLod2MaterialUiState() {
    const read = (id, fallback) => {
      const el = this._root?.querySelector(`#${id}`);
      return el ? el.value : fallback;
    };

    return {
      roofColor: read('lod2-roof-color', '#fcfcfc'),
      wallColor: read('lod2-wall-color', '#ededf3'),
      opacityPercent: read('lod2-opacity', '100'),
      ambientColor: read('lod2-ambient-color', '#ffffff'),
      ambientStrengthPercent: read('lod2-ambient-strength', '100'),
    };
  }

  _applyLod2MaterialUiState(style) {
    const set = (id, valId, value, label = value) => {
      const el = this._root?.querySelector(`#${id}`);
      const vel = valId ? this._root?.querySelector(`#${valId}`) : null;
      if (el) el.value = String(value);
      if (vel) vel.textContent = String(label);
    };

    set('lod2-roof-color', 'lod2-roof-color-val', style.roofColor);
    set('lod2-wall-color', 'lod2-wall-color-val', style.wallColor);
    set('lod2-opacity', 'lod2-opacity-val', style.opacityPercent, `${style.opacityPercent}%`);
    set('lod2-ambient-color', 'lod2-ambient-color-val', style.ambientColor);
    set('lod2-ambient-strength', 'lod2-ambient-strength-val', style.ambientStrengthPercent, `${style.ambientStrengthPercent}%`);

    this.mapApp.setLod2RoofColor?.(style.roofColor);
    this.mapApp.setLod2WallColor?.(style.wallColor);
    this.mapApp.setLod2Opacity?.(Number(style.opacityPercent) / 100);
    this.mapApp.setLod2AmbientColor?.(style.ambientColor);
    this.mapApp.setLod2AmbientStrength?.(Number(style.ambientStrengthPercent) / 100);
  }

  _toggleLod2MaterialMode() {
    const materialBtn = document.getElementById('btn-material');

    // M は 3段階トグル:
    // default → ambient #0579f5 / opacity 60% → ambient #808080 / opacity 58% → default
    if (!this._lod2MaterialModeBackup || this._lod2MaterialModeStep === 0) {
      this._lod2MaterialModeBackup = this._readLod2MaterialUiState();
    }

    const backup = this._lod2MaterialModeBackup || {
      roofColor: '#fcfcfc',
      wallColor: '#ededf3',
      opacityPercent: '100',
      ambientColor: '#ffffff',
      ambientStrengthPercent: '100',
    };

    if (this._lod2MaterialModeStep === 0) {
      this._lod2MaterialModeStep = 1;
      this._lod2MaterialModeActive = true;

      this._applyLod2MaterialUiState({
        // 色変更は LOD2 の roof / wall material ではなく、環境光だけで行う。
        // 既存の屋根・壁色は維持し、M は opacity と ambient color のみを切り替える。
        roofColor: backup.roofColor || '#fcfcfc',
        wallColor: backup.wallColor || '#ededf3',
        opacityPercent: '65',
        ambientColor: '#0579f5',
        ambientStrengthPercent: backup.ambientStrengthPercent || '100',
      });

      if (materialBtn) {
        materialBtn.classList.add('is-active');
        materialBtn.textContent = 'M';
        materialBtn.title = 'LOD2 M 1/2: Blue glass opacity 60% / ambient #0579f5';
      }
      return;
    }

    if (this._lod2MaterialModeStep === 1) {
      this._lod2MaterialModeStep = 2;
      this._lod2MaterialModeActive = true;

      this._applyLod2MaterialUiState({
        roofColor: backup.roofColor || '#fcfcfc',
        wallColor: backup.wallColor || '#ededf3',
        opacityPercent: '65',
        ambientColor: '#808080',
        ambientStrengthPercent: backup.ambientStrengthPercent || '100',
      });

      if (materialBtn) {
        materialBtn.classList.add('is-active');
        materialBtn.textContent = 'M';
        materialBtn.title = 'LOD2 M 2/2: Gray glass opacity 58% / ambient #808080';
      }
      return;
    }

    this._lod2MaterialModeStep = 0;
    this._lod2MaterialModeActive = false;

    this._applyLod2MaterialUiState(backup);

    if (materialBtn) {
      materialBtn.classList.remove('is-active');
      materialBtn.textContent = 'M';
      materialBtn.title = 'LOD2 material mode OFF: original opacity / ambient';
    }
  }

  _attachStep1ControlEvents() {
    const mapOrNull = () => this.mapApp?.map || null;

    const updateHud = () => this._refreshDebug();

    const setButtonActive = (id, active) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('is-active', Boolean(active));
    };

    const pathfinderBtn = document.getElementById('btn-pathfinder');
    const rotateBtn     = document.getElementById('btn-rotate');
    const zoomInBtn     = document.getElementById('btn-zoom-in');
    const zoomOutBtn    = document.getElementById('btn-zoom-out');
    const pitchBtn      = document.getElementById('btn-view-pitch');
    const materialBtn   = document.getElementById('btn-material');
    const gpsBtn        = document.getElementById('btn-gps');

    if (pathfinderBtn) {
      pathfinderBtn.addEventListener('click', () => {
        const map = mapOrNull();
        if (!map) return;

        if (!this._pathfinderActive) {
          this._setAutoRotate(false);

          this._previousNormalCamera = {
            center: map.getCenter(),
            zoom: map.getZoom(),
            pitch: map.getPitch(),
            bearing: map.getBearing(),
          };

          this._pathfinderActive = true;
          setButtonActive('btn-pathfinder', true);

          // 通常操作では pitch 60°を上限にし、Pathfinder ボタン経由のときだけ 80°を許可する。
          if (typeof map.setMaxPitch === 'function') {
            map.setMaxPitch(80);
          }

          map.easeTo({
            pitch: 80,
            zoom: Math.max(map.getZoom(), 18.3),
            bearing: map.getBearing(),
            duration: 800,
          });
        } else {
          this._pathfinderActive = false;
          setButtonActive('btn-pathfinder', false);

          // Pathfinder を抜けたら、右クリック/タッチ操作で 60°より上へ行けない通常上限に戻す。
          if (typeof map.setMaxPitch === 'function') {
            map.setMaxPitch(60);
          }

          const fallbackPitch = this._normalPitchMode === 'top' ? 0 : 50;
          const previous = this._previousNormalCamera;

          map.easeTo({
            center: previous?.center || map.getCenter(),
            zoom: previous?.zoom ?? map.getZoom(),
            pitch: fallbackPitch,
            bearing: previous?.bearing ?? map.getBearing(),
            duration: 650,
          });
        }

        updateHud();
      });
    }

    if (rotateBtn) {
      rotateBtn.addEventListener('click', () => {
        if (this._pathfinderActive) {
          this._setAutoRotate(false);
          return;
        }

        if (this._autoRotatePendingStart) {
          this._setAutoRotate(false);
          return;
        }

        this._setAutoRotate(!this._autoRotateActive);
      });
    }

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        const map = mapOrNull();
        if (!map) return;
        this._zoomByStep(+0.5);
      });
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        const map = mapOrNull();
        if (!map) return;
        this._zoomByStep(-0.5);
      });
    }

    if (pitchBtn) {
      pitchBtn.addEventListener('click', () => {
        const map = mapOrNull();
        if (!map || this._pathfinderActive) return;

        const nextPitch = this._normalPitchMode === 'top' ? 50 : 0;
        this._normalPitchMode = nextPitch === 0 ? 'top' : 'bird';
        pitchBtn.textContent = nextPitch === 0 ? '0°' : '50°';
        pitchBtn.classList.toggle('is-active', nextPitch === 50);

        map.easeTo({ pitch: nextPitch, duration: 420 });
      });
    }

    if (materialBtn) {
      materialBtn.addEventListener('click', () => {
        this._toggleLod2MaterialMode();
      });
    }

    if (gpsBtn) {
      gpsBtn.textContent = 'GPS';
      gpsBtn.title = 'GPS OFF（実連動は次段階）';
      gpsBtn.classList.remove('is-active');

      gpsBtn.addEventListener('click', () => {
        // Step 1 UI: GPS control is placed here, but actual GPS tracking remains disabled
        // until Pathfinder / road-snap integration is added.
        gpsBtn.title = 'GPS OFF（実連動は次段階）';
      });
    }

    this.mapApp.on('ready', ({ map }) => {
      const refresh = () => this._refreshDebug();
      refresh();
      map.on('move', refresh);
      map.on('zoom', refresh);
      map.on('pitch', refresh);
      map.on('rotate', refresh);

      // 自動回転中でも、ユーザーの zoom / click / scan 操作を優先する。
      // OFF にはせず、短時間だけ bearing 更新を休ませる。
      const canvas = map.getCanvas?.();
      if (canvas && !canvas.dataset.petiteauAutoRotateSafeBound) {
        canvas.dataset.petiteauAutoRotateSafeBound = '1';
        canvas.addEventListener('wheel', () => this._suspendAutoRotate(220), { passive: true });
        canvas.addEventListener('pointerdown', () => this._suspendAutoRotate(650), { passive: true });
        canvas.addEventListener('pointerup', () => this._suspendAutoRotate(900), { passive: true });
        canvas.addEventListener('click', () => this._suspendAutoRotate(1200), { passive: true });
        canvas.addEventListener('touchstart', () => this._suspendAutoRotate(650), { passive: true });
        canvas.addEventListener('touchmove', () => this._suspendAutoRotate(220), { passive: true });
      }

      if (pitchBtn) {
        const currentPitch = map.getPitch();
        this._normalPitchMode = currentPitch < 10 ? 'top' : 'bird';
        pitchBtn.textContent = this._normalPitchMode === 'top' ? '0°' : '50°';
        pitchBtn.classList.toggle('is-active', this._normalPitchMode === 'bird');
      }
    });
  }


  _suspendAutoRotate(ms = 250) {
    if (!this._autoRotateActive) return;
    this._autoRotateSuspendUntil = Math.max(
      this._autoRotateSuspendUntil || 0,
      performance.now() + Math.max(0, ms),
    );
  }

  _zoomByStep(delta) {
    const map = this.mapApp?.map || null;
    if (!map) return;

    const minZoom = typeof map.getMinZoom === 'function' ? map.getMinZoom() : 0;
    const maxZoom = typeof map.getMaxZoom === 'function' ? map.getMaxZoom() : 24;
    const nextZoom = Math.max(minZoom, Math.min(maxZoom, map.getZoom() + delta));

    // 自動回転中に easeTo を使うと、毎フレームの bearing 更新で zoom animation が中断される。
    // 回転中だけは即時 jumpTo にして、+/- が確実に効くようにする。
    if (this._autoRotateActive) {
      this._suspendAutoRotate(120);
      map.jumpTo({ zoom: nextZoom });
      this._autoRotateLastTime = performance.now();
      this._refreshDebug();
      return;
    }

    map.easeTo({ zoom: nextZoom, duration: 260 });
  }

  _isMobileUiRuntime() {
    return (
      window.innerWidth <= 720 ||
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
    );
  }


  _setAutoRotate(active) {
    const map = this.mapApp?.map || null;
    const rotateBtn = document.getElementById('btn-rotate');

    if (active && (!map || this._pathfinderActive)) {
      active = false;
    }

    if (!active) {
      this._autoRotateActive = false;
      this._autoRotatePendingStart = false;
      this._autoRotateLastTime = 0;
      this._autoRotateSuspendUntil = 0;

      if (this._autoRotatePendingTimer) {
        clearTimeout(this._autoRotatePendingTimer);
        this._autoRotatePendingTimer = null;
      }

      if (this._autoRotateRaf) {
        cancelAnimationFrame(this._autoRotateRaf);
        this._autoRotateRaf = null;
      }

      if (rotateBtn) {
        rotateBtn.classList.remove('is-active');
        rotateBtn.textContent = '⟳';
        rotateBtn.title = '水平自動回転 ON';
      }

      this._refreshDebug();
      return;
    }

    if (this._autoRotateActive || this._autoRotatePendingStart) return;

    // PC版のみ、自動回転の前に zoom 17 まで寄せる。
    // mobile は現状維持で、その場の zoom から即時発動。
    if (!this._isMobileUiRuntime() && map.getZoom() < this._autoRotatePcStartZoom - 0.01) {
      this._autoRotatePendingStart = true;

      if (rotateBtn) {
        rotateBtn.classList.add('is-active');
        rotateBtn.textContent = '17';
        rotateBtn.title = `zoom ${this._autoRotatePcStartZoom} へ寄ってから水平自動回転開始`;
      }

      let done = false;
      const startAfterZoom = () => {
        if (done) return;
        done = true;
        if (this._autoRotatePendingTimer) {
          clearTimeout(this._autoRotatePendingTimer);
          this._autoRotatePendingTimer = null;
        }
        this._autoRotatePendingStart = false;
        if (!this._pathfinderActive) {
          this._setAutoRotate(true);
        }
      };

      if (typeof map.once === 'function') {
        map.once('moveend', startAfterZoom);
      }

      map.easeTo({
        zoom: this._autoRotatePcStartZoom,
        duration: 650,
      });

      // moveend を取り逃がした場合の保険。
      this._autoRotatePendingTimer = window.setTimeout(startAfterZoom, 900);
      this._refreshDebug();
      return;
    }

    this._autoRotateActive = true;
    this._autoRotatePendingStart = false;
    this._autoRotateLastTime = 0;
    this._autoRotateSuspendUntil = 0;

    if (rotateBtn) {
      rotateBtn.classList.add('is-active');
      rotateBtn.textContent = '止';
      rotateBtn.title = `水平自動回転 OFF（${this._autoRotateSpeedDegPerSec}°/秒）`;
    }

    const tick = (now) => {
      if (!this._autoRotateActive) return;

      const currentMap = this.mapApp?.map || null;

      if (!currentMap || this._pathfinderActive) {
        this._setAutoRotate(false);
        return;
      }

      if (!this._autoRotateLastTime) {
        this._autoRotateLastTime = now;
      }

      if (now < (this._autoRotateSuspendUntil || 0)) {
        this._autoRotateLastTime = now;
        this._autoRotateRaf = requestAnimationFrame(tick);
        return;
      }

      const dtSec = Math.min(0.08, Math.max(0, (now - this._autoRotateLastTime) / 1000));
      this._autoRotateLastTime = now;

      const nextBearing = currentMap.getBearing() + this._autoRotateSpeedDegPerSec * dtSec;
      currentMap.jumpTo({ bearing: nextBearing });

      this._autoRotateRaf = requestAnimationFrame(tick);
    };

    this._autoRotateRaf = requestAnimationFrame(tick);
  }

  _updateSelectionPanel(data) {
    const section = this._root.querySelector('#selection-section');
    const info    = this._root.querySelector('#selection-info');

    if (!section || !info) return;

    if (!data) {
      section.style.display = 'none';
      info.innerHTML = '';
      return;
    }

    section.style.display = '';

    const props = data.properties ?? {};

    const rows = Object.entries(props)
      .map(([k, v]) => `<tr><th>${k}</th><td>${v ?? '—'}</td></tr>`)
      .join('');

    info.innerHTML = rows
      ? `<table class="prop-table">${rows}</table>`
      : '<em>プロパティなし</em>';
  }

  _startDebugLoop() {
    this._debugTimer = setInterval(() => this._refreshDebug(), 500);

    const tick = (now) => {
      this._fpsFrames++;

      const elapsed = now - this._fpsLast;

      if (elapsed >= 1000) {
        state.fps = Math.round(this._fpsFrames * 1000 / elapsed);
        this._fpsFrames = 0;
        this._fpsLast = now;
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  _refreshDebug() {
    const set = (id, text) => {
      const el = this._root?.querySelector(`#${id}`);
      if (el) el.textContent = text;
    };

    set('dbg-chome-count', String(state.loadedChomeGlbs.size));

    const totalBytes = [...state.loadedChomeGlbs.values()]
      .reduce((s, d) => s + (d.sizeBytes || 0), 0);

    set('dbg-glb-mb', `${(totalBytes / 1_048_576).toFixed(2)} MB`);
    set('dbg-tran', state.tranLoaded ? 'ロード済' : '未ロード');
    set('dbg-fps', String(state.fps));
    set('dbg-zoom', this.mapApp.map ? this.mapApp.map.getZoom().toFixed(1) : '—');

    const hudPathfinder = document.getElementById('hud-pathfinder');
    const hudFps        = document.getElementById('hud-fps');
    const hudRotate     = document.getElementById('hud-rotate');
    const hudZoom       = document.getElementById('hud-zoom');
    const hudPitch      = document.getElementById('hud-pitch');
    const hudBearing    = document.getElementById('hud-bearing');

    if (hudPathfinder) {
      hudPathfinder.textContent = this._pathfinderActive ? 'ON' : 'OFF';
      hudPathfinder.classList.toggle('is-on', this._pathfinderActive);
    }

    if (hudFps) {
      const fps = Number(state.fps) || 0;
      hudFps.textContent = String(fps);
      hudFps.classList.remove('fps-red', 'fps-yellow', 'fps-green', 'fps-blue');
      if (fps <= 9) {
        hudFps.classList.add('fps-red');
      } else if (fps <= 19) {
        hudFps.classList.add('fps-yellow');
      } else if (fps <= 39) {
        hudFps.classList.add('fps-green');
      } else {
        hudFps.classList.add('fps-blue');
      }
    }

    if (hudRotate) {
      hudRotate.textContent = this._autoRotatePendingStart ? 'ZOOM' : (this._autoRotateActive ? 'ON' : 'OFF');
      hudRotate.classList.toggle('is-on', this._autoRotateActive || this._autoRotatePendingStart);
    }

    if (this.mapApp.map) {
      if (hudZoom) hudZoom.textContent = this.mapApp.map.getZoom().toFixed(1);
      if (hudPitch) hudPitch.textContent = `${Math.round(this.mapApp.map.getPitch())}°`;
      if (hudBearing) hudBearing.textContent = `${Math.round(this.mapApp.map.getBearing())}°`;
    } else {
      if (hudZoom) hudZoom.textContent = '--';
      if (hudPitch) hudPitch.textContent = '--';
      if (hudBearing) hudBearing.textContent = '--';
    }

    const luseCount = this.mapApp.vegetationManager?.getFeatureCount();

    set('dbg-luse-count', luseCount !== null ? String(luseCount) : '—');
  }

  destroy() {
    this._setAutoRotate(false);

    if (this._debugTimer) {
      clearInterval(this._debugTimer);
    }
  }
}