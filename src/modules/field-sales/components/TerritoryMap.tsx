// The map a manager draws territories on.
//
// Separate from DoorMap rather than a mode inside it. They answer different
// questions: DoorMap is "where are my doors and what happened at them",
// this is "where does one rep's patch end and the next begin". Folding both
// into one component would mean every prop needing a comment about which half
// it belongs to.
//
// Drawing is hand-rolled rather than a plugin. What is needed here is tap to
// add a point, undo the last one, and close the ring; a drawing library brings
// vertex dragging, midpoint handles, snapping and its own React integration
// problems for the same result.

import { useCallback, useEffect, useRef } from 'react';
import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection } from 'geojson';
import type { Ring } from '@/modules/field-sales/polygon';
import { boundsOf } from '@/modules/field-sales/polygon';
import { basemapFor, DEFAULT_CENTER, mapInkFor } from '@/modules/field-sales/mapConfig';
import { useTheme } from '@/lib/theme/ThemeProvider';

setWorkerUrl(workerUrl);

const TERRITORY_SRC = 'territories';
const DRAFT_SRC = 'draft';

// Enough hues to tell neighbouring patches apart at a glance, cycled by index
// so a territory keeps its colour as long as the list order holds.
const TERRITORY_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#38bdf8', '#a855f7', '#ef4444'];

export interface MapTerritory {
  id: string;
  name: string;
  boundary: Ring | null;
}

export interface TerritoryMapProps {
  territories: MapTerritory[];
  /** The ring being drawn, if any. Empty array means drawing has started. */
  draft: Ring | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Called with each point as the manager taps. Absent means not drawing. */
  onAddPoint?: (point: [number, number]) => void;
}

function territoryFeatures(territories: MapTerritory[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: territories
      .filter((t): t is MapTerritory & { boundary: Ring } => Boolean(t.boundary))
      .map((t, index) => ({
        type: 'Feature',
        id: t.id,
        // A ring has to be closed for GeoJSON to accept it as a polygon. It is
        // closed here rather than stored closed, so the stored shape stays the
        // list of points somebody actually tapped.
        geometry: { type: 'Polygon', coordinates: [[...t.boundary, t.boundary[0]!]] },
        properties: {
          id: t.id,
          name: t.name,
          color: TERRITORY_COLORS[index % TERRITORY_COLORS.length]!,
        },
      })),
  };
}

function draftFeatures(draft: Ring | null): FeatureCollection {
  if (!draft || draft.length === 0) return { type: 'FeatureCollection', features: [] };

  const features: FeatureCollection['features'] = draft.map((point, i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: point },
    properties: { index: i },
  }));

  // Two points is a line, three is an area. Showing the line while it is only
  // two keeps the shape legible as it is built rather than snapping into
  // existence at the third tap.
  if (draft.length >= 3) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[...draft, draft[0]!]] },
      properties: {},
    });
  } else if (draft.length === 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: draft },
      properties: {},
    });
  }

  return { type: 'FeatureCollection', features };
}

export function TerritoryMap({
  territories,
  draft,
  selectedId,
  onSelect,
  onAddPoint,
}: TerritoryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);

  // Held in refs so the map's handlers, registered once, always see the
  // current callbacks without the map being rebuilt to rebind them. Rebuilding
  // would throw away wherever the manager had panned to.
  const onSelectRef = useRef(onSelect);
  const onAddPointRef = useRef(onAddPoint);
  const selectedIdRef = useRef(selectedId);
  const { resolved: theme } = useTheme();
  // Seeded at construction, which is what the map's first style reads, and
  // kept current from the effect below for the restyle after that.
  const themeRef = useRef(theme);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onAddPointRef.current = onAddPoint;
    selectedIdRef.current = selectedId;
    themeRef.current = theme;
  }, [onSelect, onAddPoint, selectedId, theme]);

  // What a restyle has to replay: setStyle drops every source and layer the
  // application added, so without this a theme switch leaves an empty map.
  const replayRef = useRef<() => void>(() => {});

  const whenReady = useCallback((run: (map: MapLibreMap) => void) => {
    const map = mapRef.current;
    if (!map) return;
    if (readyRef.current) run(map);
    // 'style.load', not 'load': 'load' also waits for every visible tile, so a
    // slow or blocked basemap would stop the territories being added at all.
    else void map.once('style.load', () => run(map));
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: basemapFor(themeRef.current),
      center: DEFAULT_CENTER,
      zoom: 12,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new ScaleControl({ unit: 'imperial' }), 'bottom-left');
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');

    // `on`, not `once`: switching theme calls setStyle and takes these with
    // it, so they have to be rebuilt every time a style lands.
    map.on('style.load', () => {
      const ink = mapInkFor(themeRef.current);

      map.addSource(TERRITORY_SRC, { type: 'geojson', data: territoryFeatures([]) });
      map.addSource(DRAFT_SRC, { type: 'geojson', data: draftFeatures(null) });

      map.addLayer({
        id: 'territory-fill',
        type: 'fill',
        source: TERRITORY_SRC,
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.18 },
      });
      map.addLayer({
        id: 'territory-line',
        type: 'line',
        source: TERRITORY_SRC,
        paint: { 'line-color': ['get', 'color'], 'line-width': 2 },
      });
      map.addLayer({
        id: 'territory-selected',
        type: 'line',
        source: TERRITORY_SRC,
        filter: ['==', ['get', 'id'], ''],
        // The selected outline has to be the opposite of the ground, or it
        // reads as one more territory rather than as the chosen one.
        paint: { 'line-color': ink.halo, 'line-width': 3 },
      });
      map.addLayer({
        id: 'territory-label',
        type: 'symbol',
        source: TERRITORY_SRC,
        layout: {
          // MapLibre 6 renders this with fonts already on the device when the
          // style names no glyph server, which the raster basemap does not.
          // Verified on screen rather than assumed: an earlier version of this
          // comment claimed the opposite.
          'text-field': ['get', 'name'],
          'text-size': 12,
        },
        paint: { 'text-color': ink.label, 'text-halo-color': ink.rim, 'text-halo-width': 1.2 },
      });

      map.addLayer({
        id: 'draft-fill',
        type: 'fill',
        source: DRAFT_SRC,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': ink.halo, 'fill-opacity': 0.12 },
      });
      map.addLayer({
        id: 'draft-line',
        type: 'line',
        source: DRAFT_SRC,
        paint: { 'line-color': ink.halo, 'line-width': 2, 'line-dasharray': [2, 2] },
      });
      map.addLayer({
        id: 'draft-points',
        type: 'circle',
        source: DRAFT_SRC,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          // A corner the manager tapped: the ink of the theme, ringed in the
          // ground of it, so it stays a distinct dot on any basemap.
          'circle-color': ink.halo,
          'circle-stroke-width': 2,
          'circle-stroke-color': ink.ground,
        },
      });

      readyRef.current = true;
      // The territories and the draft ring, which the new style dropped.
      replayRef.current();
    });

    map.on('click', (event: MapLayerMouseEvent) => {
      // While drawing, a click is a vertex and nothing else. Selecting a
      // territory underneath at the same time would move the manager's
      // attention mid-shape.
      if (onAddPointRef.current) {
        onAddPointRef.current([event.lngLat.lng, event.lngLat.lat]);
        return;
      }
      const hit = map.queryRenderedFeatures(event.point, { layers: ['territory-fill'] })[0];
      const id: unknown = hit?.properties?.['id'];
      if (typeof id === 'string') onSelectRef.current(id);
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Both sources and the selection filter in one pass, so a restyle can
    // replay the whole picture rather than the half of it that happens to
    // change most often.
    const apply = (map: MapLibreMap) => {
      const territorySource: GeoJSONSource | undefined = map.getSource(TERRITORY_SRC);
      void territorySource?.setData(territoryFeatures(territories));

      const draftSource: GeoJSONSource | undefined = map.getSource(DRAFT_SRC);
      void draftSource?.setData(draftFeatures(draft));
      // A crosshair is the only affordance saying the map is now a canvas.
      map.getCanvas().style.cursor = draft ? 'crosshair' : '';

      if (map.getLayer('territory-selected')) {
        map.setFilter('territory-selected', ['==', ['get', 'id'], selectedIdRef.current ?? '']);
      }
    };

    replayRef.current = () => {
      const map = mapRef.current;
      if (map) apply(map);
    };
    whenReady(apply);
  }, [territories, draft, whenReady]);

  // Swap the basemap when the theme changes, without rebuilding the map: a
  // rebuild would throw away wherever the manager had panned to, and a
  // half-drawn territory with it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    readyRef.current = false;
    map.setStyle(basemapFor(theme));
  }, [theme]);

  useEffect(() => {
    whenReady((map) => {
      if (map.getLayer('territory-selected')) {
        map.setFilter('territory-selected', ['==', ['get', 'id'], selectedId ?? '']);
      }
      const target = territories.find((t) => t.id === selectedId);
      if (target?.boundary) {
        const box = boundsOf(target.boundary);
        map.fitBounds(
          [
            [box.west, box.south],
            [box.east, box.north],
          ],
          { padding: 64, duration: 400 }
        );
      }
    });
  }, [selectedId, territories, whenReady]);

  // Frame everything on arrival, once, so a manager sees the whole patchwork
  // rather than the default centre.
  const framedRef = useRef(false);
  useEffect(() => {
    if (framedRef.current || territories.length === 0) return;
    framedRef.current = true;
    whenReady((map) => {
      const all = territories.flatMap((t) => t.boundary ?? []);
      if (all.length === 0) return;
      const box = boundsOf(all);
      map.fitBounds(
        [
          [box.west, box.south],
          [box.east, box.north],
        ],
        { padding: 48, duration: 0 }
      );
    });
  }, [territories, whenReady]);

  return (
    <div
      ref={containerRef}
      className="size-full"
      role="application"
      aria-label="Territory map. Territory names and door counts are listed beside it."
    />
  );
}
