// Small mutable hand-offs between the 3D scene and the DOM overlay that
// change every frame and so should not go through React state.

import type { V3 } from './layout';

export const camInfo = {
  position: [0, 10, 20] as V3,
  focus: [0, 0, 8] as V3,
};

/** Screen space covered by HUD panels, so the overview can frame around them. */
export const hudInsets = { top: 72, bottom: 190, left: 0, right: 0 };
