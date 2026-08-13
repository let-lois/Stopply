// The canvass map.
//
// What this replaces was honest but not a map: real coordinates projected
// linearly into a fixed box. Pins sat in the right places relative to each
// other and nowhere in particular otherwise, so "1830 E Broadway Rd" told you
// the address and the dot told you nothing. A rep navigates by streets and a
// manager reads coverage by streets.
//
// Two decisions worth knowing about.
//
// Doors are a GeoJSON source and a circle layer, not DOM markers. A real
// territory is thousands of houses, and thousands of absolutely positioned
// elements make panning stutter on the phone the rep is actually holding.
// Circles render on the GPU and stay smooth into six figures.
//
// The basemap is optional. Without a style URL configured, this still pans,
// zooms, scales and places every door at its true coordinates: strictly more
// than the box ever did. With one, the same doors sit on streets. Nothing
// about the component changes between the two, so configuring tiles later is
// a deployment change rather than a rewrite.

import { useCallback, useEffect, useRef } from 'react';
// MapLibre 6 ships named exports only, so the classes are imported by name
// rather than off a default that does not exist.
import {
  AttributionControl,
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  type GeoJSONSource,
  setWorkerUrl,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
// Vite bundles the worker and hands back its URL.
//
// Without this the map renders nothing at all, and does it quietly. MapLibre 6
// resolves its worker at runtime with
// `new URL('./maplibre-gl-worker.mjs', import.meta.url)`, which the bundler
// cannot see, so the file is never emitted, the request falls through to the
// SPA's index.html, and the module worker fails to parse. Every setData then
// waits forever on a worker that will never answer. Source, layers, viewport,
// controls and zoom all read as correct while not one door is drawn, and
// MapLibre reports no error, which is exactly how it presented.
//
// The suffix has to be `?worker&url`, not `?url`. The latter copies the file
// verbatim, and this worker imports MapLibre's shared chunk relative to
// itself, so the copy resolves that import to a file that was never emitted
// and fails in the same silent way. `?worker` makes Vite bundle the
// dependency in.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';
import type { Property, PropertyDisposition, Territory } from '@/modules/field-sales/types';
import { DEFAULT_BASEMAP, MAP_STYLE_URL } from '@/modules/field-sales/mapConfig';
import { tackImage, UNWORKED_COLOR } from '@/modules/field-sales/repColors';

setWorkerUrl(workerUrl);

const SOURCE = 'doors';
const LAYER = 'doors-circles';
const LAYER_TACKS = 'doors-tacks';
const LAYER_SELECTED = 'doors-selected';

// Images belong to a map instance, not to this module, so there is
// deliberately no module-level cache of which ones exist. An earlier version
// kept one and skipped adding an image the cache knew about but a freshly
// mounted map did not, which lost every tack after a remount.

// The same colours the legend uses, resolved to literals because a MapLibre
// paint expression is evaluated on the GPU and cannot read a CSS variable.
const DISPOSITION_HEX: Record<PropertyDisposition, string> = {
  not_visited: '#6b7280',
  no_answer: '#94a3b8',
  come_back: '#f59e0b',
  not_interested: '#ef4444',
  interested: '#38bdf8',
  appointment_set: '#a855f7',
  closed_sale: '#10b981',
  do_not_knock: '#f8fafc',
};

// The colour is resolved per door and written onto the feature rather than
// matched in a paint expression. Colouring by rep depends on who last knocked,
// which is not a property of the door and cannot be expressed as a match on
// one, so both colourings go through the same path.

function toFeatureCollection(
  properties: Property[],
  colorFor: (p: Property) => string
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: properties.map((p) => ({
      type: 'Feature',
      id: p.id,
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        disposition: p.disposition,
        address: p.address,
        // Resolved here rather than in a paint expression, because colouring
        // by rep depends on who last knocked, which is not a property of the
        // door and cannot be expressed as a match on one.
        color: colorFor(p),
      },
    })),
  };
}

export interface DoorMapProps {
  /** Doors to draw. Filtering this cannot move a door: position is its coordinates. */
  properties: Property[];
  /** Frames the view. Falls back to the extent of the doors themselves. */
  territory: Territory | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /**
   * What each door's colour means.
   *
   * The caller resolves it, because colouring by rep needs the visit history
   * and the map has no business holding that.
   */
  colorFor?: (property: Property) => string;
}

export function DoorMap({
  properties,
  territory,
  selectedId,
  onSelect,
  colorFor,
}: DoorMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);

  // Held in a ref so the map's click handler, which is registered once, always
  // calls the current callback without the map being torn down to rebind it.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const fitTo = useCallback((map: MapLibreMap, items: Property[], extent: Territory | undefined) => {
    if (extent) {
      map.fitBounds(
        [
          [extent.bounds.west, extent.bounds.south],
          [extent.bounds.east, extent.bounds.north],
        ],
        { padding: 48, duration: 0 }
      );
      return;
    }
    if (items.length === 0) return;
    const lngs = items.map((p) => p.lng);
    const lats = items.map((p) => p.lat);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 48, duration: 0 }
    );
  }, []);

  // Created once. Everything after this updates the existing map rather than
  // replacing it, because rebuilding a map throws away the rep's pan and zoom.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      // A provider's style when one is configured, otherwise the free
      // OpenStreetMap basemap. Either way the doors sit on streets.
      style: MAP_STYLE_URL ?? DEFAULT_BASEMAP,
      center: [-111.63, 33.41],
      zoom: 12,
      attributionControl: false,
    });

    mapRef.current = map;

    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    // Where the rep is standing. Useless to a manager at a desk and the single
    // most useful control at a door.
    map.addControl(
      new GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'top-right'
    );
    map.addControl(new ScaleControl({ unit: 'imperial' }), 'bottom-left');
    // Unconditional. OpenStreetMap's licence requires it and every provider
    // worth using requires it, so it is not something a configuration change
    // may switch off.
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');

    // 'style.load', not 'load'.
    //
    // 'load' waits for the style *and* for every visible tile to settle, so a
    // basemap that is slow or failing delays it indefinitely and the doors are
    // never added at all. That is not hypothetical: pointing at a tile host
    // this sandbox blocks reproduced it exactly, with a valid style, a healthy
    // canvas and zero doors. A rep on a weak signal is the same case.
    //
    // 'style.load' fires as soon as the style is parsed, which is the moment
    // it becomes legal to add a source, and owes nothing to the network.
    map.on('style.load', () => {
      map.addSource(SOURCE, {
        type: 'geojson',
        data: toFeatureCollection([], () => UNWORKED_COLOR),
      });

      map.addLayer({
        id: LAYER,
        type: 'circle',
        source: SOURCE,
        // Handed over to the tacks once there is room for them.
        maxzoom: 14,
        paint: {
          // Grows with zoom, so a door is a dot in an overview and a target
          // worth tapping once the rep is on the street.
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 5],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(0,0,0,0.5)',
        },
      });

      // Tacks above a certain zoom, dots below it. A tack is the right shape
      // for "somebody was here" and the wrong one for two thousand of them at
      // city scale, where they stack into an unreadable wall.
      map.addLayer({
        id: LAYER_TACKS,
        type: 'symbol',
        source: SOURCE,
        minzoom: 14,
        layout: {
          'icon-image': ['concat', 'tack-', ['get', 'color']],
          // The tip of the tack is the door, so the image sits above the point
          // rather than centred on it.
          'icon-anchor': 'bottom',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.7, 18, 1],
          // Doors on one street are close together by definition. Hiding half
          // of them to avoid overlap would hide half the round.
          'icon-allow-overlap': true,
        },
      });

      map.addLayer({
        id: LAYER_SELECTED,
        type: 'circle',
        source: SOURCE,
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 6, 15, 10, 18, 16],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      map.on('click', [LAYER, LAYER_TACKS], (event: MapLayerMouseEvent) => {
        // Feature properties are whatever the source put there, so the type
        // is unknown until checked rather than trusted.
        const props: unknown = event.features?.[0]?.properties;
        const id =
          props && typeof props === 'object' && 'id' in props
            ? props.id
            : undefined;
        if (typeof id === 'string') onSelectRef.current(id);
      });
      for (const layer of [LAYER, LAYER_TACKS]) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }

      readyRef.current = true;
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Doors, whenever they change. setData rather than a new source, so the
  // viewport is untouched: filtering must never move the map under a rep.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const resolve = colorFor ?? ((p: Property) => DISPOSITION_HEX[p.disposition]);

      // One image per colour, added the first time that colour appears. A
      // symbol layer refers to images by name, so a colour with no image
      // renders nothing at all.
      for (const property of properties) {
        const color = resolve(property);
        if (map.hasImage(`tack-${color}`)) continue;
        const image = tackImage(color);
        if (!image) continue;
        map.addImage(`tack-${color}`, image, { pixelRatio: 2 });
      }
      if (!map.hasImage(`tack-${UNWORKED_COLOR}`)) {
        const fallback = tackImage(UNWORKED_COLOR);
        if (fallback) map.addImage(`tack-${UNWORKED_COLOR}`, fallback, { pixelRatio: 2 });
      }

      const source: GeoJSONSource | undefined = map.getSource(SOURCE);
      // setData resolves once the worker has parsed the new features.
      // Nothing here depends on that having happened, and awaiting it would
      // only delay the next render for no visible benefit.
      void source?.setData(toFeatureCollection(properties, resolve));
    };

    if (readyRef.current) apply();
    else void map.once('style.load', apply);
  }, [properties, colorFor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (map.getLayer(LAYER_SELECTED)) {
        map.setFilter(LAYER_SELECTED, ['==', ['get', 'id'], selectedId ?? '']);
      }
    };
    if (readyRef.current) apply();
    else void map.once('style.load', apply);
  }, [selectedId]);

  // Reframe only when the territory changes, never when the filter does.
  // Refitting on every filter would yank the view away from wherever the rep
  // had scrolled to.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => fitTo(map, properties, territory);
    if (readyRef.current) apply();
    else void map.once('style.load', apply);
    // properties is deliberately not a dependency: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [territory, fitTo]);

  return (
    <div
      ref={containerRef}
      className="size-full"
      // The map is a graphical control with no text. Naming it is the only
      // thing a screen reader has to go on, and the door list on Properties is
      // the accessible equivalent of the same data.
      role="application"
      aria-label="Canvass map. The same doors are listed on the Properties view."
    />
  );
}
