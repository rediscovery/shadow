/**
 * main.js — Application entry point.
 *
 * Bootstraps MapApp and UiPanel after DOM ready.
 */

import { MapApp } from './map/map-app.js';
import { UiPanel } from './ui/ui-panel.js';

async function main() {
  const app = new MapApp();
  const panel = new UiPanel(app, 'petiteau-panel');

  // Mount UI first so the panel is visible during map init
  panel.mount();

  try {
    await app.init('map');
  } catch (err) {
    console.error('[main] Map init failed:', err);
  }
}

document.addEventListener('DOMContentLoaded', main);