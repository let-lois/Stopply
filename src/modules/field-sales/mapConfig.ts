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
 * Two of them, because the basemap is not decoration. Doors are drawn as
 * coloured circles on top of it, and the entire job of this map is making
 * those pick out against the ground. Dark doors on a dark ground is the
 * failure; so is leaving a dark basemap under a light interface, where the map
 * becomes a black hole in the middle of the page.
 */
function basemap(variant: 'dark_all' | 'light_all', ground: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: ['a', 'b', 'c'].map(
          (host) => `https://${host}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}.png`
        ),
        tileSize: 256,
        maxzoom: 19,
        // Required by OpenStreetMap's licence and by CARTO's terms. It renders
        // in the corner of the map and is not optional.
        attribution:
          '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> contributors, <a href="https://carto.com/attributions">© CARTO</a>',
      },
    },
    layers: [
      // Under the tiles, so the map matches the interface while they load
      // rather than flashing the other theme's ground.
      { id: 'background', type: 'background', paint: { 'background-color': ground } },
      { id: 'basemap', type: 'raster', source: 'basemap' },
    ],
  };
}

export const DARK_BASEMAP = basemap('dark_all', '#0f1115');
export const LIGHT_BASEMAP = basemap('light_all', '#f4f5f7');

/** The style for a resolved theme, or the configured override if there is one. */
export function basemapFor(theme: 'dark' | 'light'): string | StyleSpecification {
  // An explicit override wins in both themes. Somebody who has pointed this at
  // their own tiles has one style, and silently ignoring it in one theme would
  // be worse than not theming the map at all.
  if (MAP_STYLE_URL) return MAP_STYLE_URL;
  return theme === 'light' ? LIGHT_BASEMAP : DARK_BASEMAP;
}

/**
 * Ink for anything drawn over the map by us rather than by the tiles.
 *
 * Three roles, and only two of them flip.
 *
 * `halo` and `label` are read against the *ground*, so they invert: a white
 * selection ring is how a selected door stops being distinguishable from every
 * other door on a light basemap.
 *
 * `rim` does not. Its job is to outline a coloured mark so two neighbouring
 * pastels do not merge into one blob, and a dark outline does that on either
 * basemap. Flipping it to white was the obvious move and the wrong one: it put
 * a pale ring around a pale tack on pale streets.
 */
export function mapInkFor(theme: 'dark' | 'light'): {
  /** A ring or line drawn to stand out from the ground. Inverts. */
  halo: string;
  /** Text drawn directly on the map. Inverts. */
  label: string;
  /** The outline that separates two adjacent marks. Dark in both themes. */
  rim: string;
  /** The basemap's own ground, for punching a gap inside a mark. */
  ground: string;
} {
  return theme === 'light'
    ? { halo: '#0f1115', label: '#1a1d23', rim: 'rgba(0,0,0,0.45)', ground: '#f4f5f7' }
    : { halo: '#ffffff', label: '#ffffff', rim: 'rgba(0,0,0,0.65)', ground: '#0f1115' };
}

/** There is always a basemap now. This says whether it is the default one. */
export const usingDefaultBasemap = MAP_STYLE_URL === undefined;

/**
 * Where a map opens before it knows what it is showing.
 *
 * Visible for a fraction of a second: every map here reframes to its own doors
 * or territories as soon as it has them. It matters anyway, because a client
 * with no doors yet never gets that reframe and sits on this instead. The main
 * market is Riverside, California, so that is where an empty map opens rather
 * than the Mesa, Arizona coordinates this was seeded with.
 */
export const DEFAULT_CENTER: [number, number] = [-117.38, 33.95];
