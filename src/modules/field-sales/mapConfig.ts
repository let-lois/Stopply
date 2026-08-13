// Map configuration, deliberately kept to types only so it costs nothing.
//
// Canvass needs to know which basemap is in play during its own first render,
// and reading that from DoorMap would mean statically importing the module
// that pulls in MapLibre, which defeats the lazy boundary around the map. The
// bundler warned about exactly that and the Canvass chunk grew to a megabyte.

import type { StyleSpecification } from 'maplibre-gl';

/** Overrides the default basemap with a provider's style URL. */
export const MAP_STYLE_URL = import.meta.env['VITE_MAP_STYLE_URL'] as string | undefined;

/**
 * The default basemap: OpenStreetMap data rendered by CARTO. Free, no key.
 *
 * Google Maps was the ask and is the wrong tool here twice over. It needs an
 * API key backed by a billing account, so it is not free in the sense meant,
 * and it ships its own SDK that MapLibre cannot consume, so adopting it would
 * mean replacing the map rather than configuring it.
 *
 * This is a community service under a fair-use policy: the right trade for
 * showing a client what the product does, the wrong one for a crew hammering
 * it every day. Point VITE_MAP_STYLE_URL at a paid provider or at self-hosted
 * Protomaps tiles on R2 before it carries real load. Nothing in the map
 * component changes when that happens.
 *
 * Dark is not decoration. The rest of the interface is dark, and a bright
 * basemap under it would make the doors harder to pick out, which is the one
 * thing this map exists to do.
 */
export const DEFAULT_BASEMAP: StyleSpecification = {
  version: 8,
  sources: {
    basemap: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      maxzoom: 19,
      // Required by OpenStreetMap's licence and by CARTO's terms. It renders
      // in the corner of the map and is not optional.
      attribution:
        '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> contributors, <a href="https://carto.com/attributions">© CARTO</a>',
    },
  },
  layers: [
    // Under the tiles, so the map matches the interface while they load rather
    // than flashing white.
    { id: 'background', type: 'background', paint: { 'background-color': '#0f1115' } },
    { id: 'basemap', type: 'raster', source: 'basemap' },
  ],
};

/** There is always a basemap now. This says whether it is the default one. */
export const usingDefaultBasemap = MAP_STYLE_URL === undefined;
