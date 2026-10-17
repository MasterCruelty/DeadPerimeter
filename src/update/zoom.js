// Siege zoom (see ZOOM_* in constants.js). anchorX is the screen x that
// should stay over the same spot of the battlefield (the cursor for the
// mouse wheel, the centre of the screen otherwise).
import { CW, ZOOM_MIN, ZOOM_MAX, zoomOf, clampCam } from '../constants.js';

export function setZoom(gs, z, anchorX = CW / 2) {
  const z0 = zoomOf(gs);
  const z1 = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  if (Math.abs(z1 - z0) < 1e-3) return;
  const worldX = (gs.cameraX || 0) + anchorX / z0;
  gs.zoom = z1;
  gs.cameraX = clampCam(gs, worldX - anchorX / z1);
}
