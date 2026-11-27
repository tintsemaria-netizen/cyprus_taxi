// Territory outline and fill on every map (operator 2026-11-27: thinner lines, dimmer fill).
export function areaStroke(z: number | undefined): number { const zz = z ?? 14; return zz >= 16 ? 2.5 : zz >= 15 ? 2 : zz >= 14 ? 1.5 : zz >= 12 ? 1.2 : 1; }
export const AREA_FILL_OPACITY = 0.07;
export const AREA_LINE_OPACITY = 0.8;
/** MapLibre line width by zoom, the same steps as areaStroke. */
export const AREA_LINE_WIDTH_EXPR = ['interpolate', ['linear'], ['zoom'], 11, 1, 13, 1.2, 14, 1.5, 15, 2, 16, 2.5];
