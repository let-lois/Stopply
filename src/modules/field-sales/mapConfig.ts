// Map configuration, deliberately in its own file with no imports.
//
// Canvass needs to know whether a basemap is configured so it can say so, and
// it needs that answer during its own first render. Reading it from DoorMap
// would mean statically importing the module that pulls in MapLibre, which
// defeats the lazy boundary around the map: the bundler warned about exactly
// that, and the Canvass chunk grew to a megabyte.
//
// Two ways to set VITE_MAP_STYLE_URL, both documented in ARCHITECTURE.md:
// self-hosted Protomaps tiles on R2, or a hosted provider's style URL.
export const MAP_STYLE_URL = import.meta.env['VITE_MAP_STYLE_URL'] as string | undefined;

/** False means the doors are still placed correctly, with no streets drawn. */
export const basemapConfigured = Boolean(MAP_STYLE_URL);
