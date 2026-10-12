'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { KIND_COLORS } from './kindColors';

/**
 * The admin live map: a 3D globe (MapLibre, globe projection) over a real
 * street map, so it zooms from the whole world down to a city.
 *
 *  - a heat map of where users are, fading into individual dots up close;
 *  - pulsing green dots where people are active right now;
 *  - an expanding ring for each new transaction, coloured by kind.
 *
 * Map tiles come from OpenFreeMap (free, no key). If they can't load, the
 * globe falls back to a plain dark sphere and every data layer still works.
 */

export interface GlobeCell {
  lat: number;
  lon: number;
  city: string | null;
  country: string | null;
  users: number;
  active: number;
}

export interface GlobePing {
  id: string;
  lat: number;
  lon: number;
  kind: string;
}

export interface GlobeLayers {
  heat: boolean;
  active: boolean;
  transactions: boolean;
}

export interface LiveGlobeHandle {
  flyTo: (lon: number, lat: number, zoom?: number) => void;
  zoomBy: (delta: number) => void;
  ping: (p: GlobePing) => void;
}

/** Tried in order: the dark map, then the standard one, then a plain sphere. */
const STYLE_URLS = ['https://tiles.openfreemap.org/styles/dark', 'https://tiles.openfreemap.org/styles/liberty'];
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#16131f' } }],
};

const PING_MS = 2600;

type Ping = GlobePing & { born: number };

function cellsToGeo(cells: GlobeCell[]) {
  return {
    type: 'FeatureCollection' as const,
    features: cells.map((c) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [c.lon, c.lat] },
      properties: { users: c.users, active: c.active, city: c.city ?? '', country: c.country ?? '' },
    })),
  };
}

function pingsToGeo(pings: Ping[], now: number) {
  return {
    type: 'FeatureCollection' as const,
    features: pings.map((p) => {
      const t = Math.min(1, (now - p.born) / PING_MS);
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
        properties: { t, color: KIND_COLORS[p.kind] ?? KIND_COLORS.other },
      };
    }),
  };
}

const LiveGlobe = forwardRef<LiveGlobeHandle, {
  cells: GlobeCell[];
  layers: GlobeLayers;
  interactive?: boolean;
  className?: string;
}>(function LiveGlobe({ cells, layers, interactive = true, className }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const pings = useRef<Ping[]>([]);
  const raf = useRef<number | null>(null);
  /** The idle spin; stops for good at the first touch or programmatic move. */
  const spinning = useRef(interactive);
  const [failed, setFailed] = useState<string | null>(null);
  const latest = useRef({ cells, layers });
  latest.current = { cells, layers };

  useImperativeHandle(ref, () => ({
    flyTo: (lon, lat, zoom = 7) => {
      spinning.current = false;
      map.current?.flyTo({ center: [lon, lat], zoom, speed: 1.4, essential: true });
    },
    zoomBy: (d) => {
      spinning.current = false;
      const m = map.current;
      if (m) m.easeTo({ zoom: m.getZoom() + d, duration: 300 });
    },
    ping: (p) => {
      pings.current.push({ ...p, born: performance.now() });
      if (pings.current.length > 60) pings.current.shift();
      startAnimating();
    },
  }));

  // One animation loop drives the transaction rings and the active-user pulse.
  function startAnimating() {
    if (raf.current !== null) return;
    const step = () => {
      const m = map.current;
      const now = performance.now();
      if (m && ready.current) {
        pings.current = pings.current.filter((p) => now - p.born < PING_MS);
        (m.getSource('pings') as GeoJSONSource | undefined)?.setData(pingsToGeo(pings.current, now));
        const pulse = (Math.sin(now / 420) + 1) / 2; // 0..1
        if (m.getLayer('active-halo')) {
          m.setPaintProperty('active-halo', 'circle-radius', 6 + pulse * 9);
          m.setPaintProperty('active-halo', 'circle-opacity', 0.45 - pulse * 0.35);
        }
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }

  useEffect(() => {
    if (!box.current) return;
    // Without WebGL (old browsers, some locked-down or low-power devices) the
    // map can't start. Say so in the map's box instead of taking the page down.
    let m: MLMap;
    try {
      m = new maplibregl.Map({
        container: box.current,
        style: STYLE_URLS[0],
        center: [8, 9],
        zoom: 1.6,
        interactive,
        attributionControl: { compact: true },
        maxZoom: 14,
      });
    } catch (err) {
      console.error('[live-map] map failed to start', err);
      const msg = err instanceof Error ? err.message : String(err);
      setFailed(/webgl/i.test(msg) ? 'WebGL is turned off or unavailable in this browser.' : msg.slice(0, 160));
      return;
    }
    map.current = m;

    // A style that won't load moves on to the next one, and finally to the
    // plain sphere, so the box is never left blank.
    let styled = false;
    let attempt = 0;
    const nextStyle = () => {
      attempt += 1;
      m.setStyle(attempt < STYLE_URLS.length ? STYLE_URLS[attempt] : FALLBACK_STYLE);
    };
    let fallback = window.setTimeout(function giveUp() {
      if (styled) return;
      nextStyle();
      if (attempt < STYLE_URLS.length) fallback = window.setTimeout(giveUp, 8000);
    }, 8000);
    m.on('error', (e) => {
      if (styled || attempt >= STYLE_URLS.length) return;
      if (/style|fetch|Failed|404|403/i.test(String(e?.error?.message ?? ''))) nextStyle();
    });

    m.on('style.load', () => {
      styled = true;
      window.clearTimeout(fallback);
      try {
        m.setProjection({ type: 'globe' });
      } catch (err) {
        // Older GPUs: stay on the flat map rather than fail.
        console.warn('[live-map] globe projection unavailable', err);
      }
      try {
        install(m);
      } catch (err) {
        console.error('[live-map] layers failed', err);
        setFailed(err instanceof Error ? err.message : String(err));
        return;
      }
      ready.current = true;
      sync();
      startAnimating();
    });

    // A slow spin until the first touch, so an idle screen shows the world.
    const stop = () => {
      spinning.current = false;
    };
    m.on('mousedown', stop);
    m.on('touchstart', stop);
    m.on('wheel', stop);
    const spin = window.setInterval(() => {
      if (!spinning.current || !ready.current || m.isMoving()) return;
      const c = m.getCenter();
      m.easeTo({ center: [c.lng + 6, c.lat], duration: 1000, easing: (t) => t });
    }, 1000);

    if (interactive) {
      m.on('click', 'user-dots', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as { users: number; active: number; city: string; country: string };
        new maplibregl.Popup({ closeButton: false, className: 'cq-popup' })
          .setLngLat(e.lngLat)
          .setHTML(
            `<b>${escapeHtml(p.city || p.country || 'Unknown')}</b>${p.country && p.city ? ` · ${escapeHtml(p.country)}` : ''}<br/>${p.users} user${p.users === 1 ? '' : 's'} · ${p.active} active now`,
          )
          .addTo(m);
      });
      m.on('mouseenter', 'user-dots', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'user-dots', () => (m.getCanvas().style.cursor = ''));
    }

    // Keep the canvas the size of its box (the page lays out after the map starts).
    const resize = new ResizeObserver(() => m.resize());
    resize.observe(box.current);

    return () => {
      resize.disconnect();
      window.clearTimeout(fallback);
      window.clearInterval(spin);
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      ready.current = false;
      m.remove();
      map.current = null;
    };
    // The map is built once; data and layer changes flow through sync().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function install(m: MLMap) {
    m.addSource('users', { type: 'geojson', data: cellsToGeo(latest.current.cells) });
    m.addSource('active', { type: 'geojson', data: cellsToGeo(latest.current.cells.filter((c) => c.active > 0)) });
    m.addSource('pings', { type: 'geojson', data: pingsToGeo([], 0) });

    m.addLayer({
      id: 'heat',
      type: 'heatmap',
      source: 'users',
      maxzoom: 10,
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'users'], 1, 0.35, 50, 1],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1.6, 9, 3],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 16, 3, 26, 6, 34, 9, 44],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)',
          0.15, 'rgba(107,91,149,0.55)',
          0.4, 'rgba(168,85,247,0.75)',
          0.65, 'rgba(236,72,153,0.85)',
          0.85, 'rgba(251,146,60,0.92)',
          1, 'rgba(253,224,71,1)',
        ],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.9, 9, 0],
      },
    });
    m.addLayer({
      id: 'user-dots',
      type: 'circle',
      source: 'users',
      minzoom: 5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'users'], 1, 5, 20, 10, 200, 18],
        'circle-color': '#8A7BB5',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0, 7, 0.9],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0, 7, 0.8],
      },
    });
    m.addLayer({
      id: 'active-halo',
      type: 'circle',
      source: 'active',
      paint: { 'circle-radius': 8, 'circle-color': '#34C759', 'circle-opacity': 0.3, 'circle-blur': 0.4 },
    });
    m.addLayer({
      id: 'active-dot',
      type: 'circle',
      source: 'active',
      paint: { 'circle-radius': 3.5, 'circle-color': '#34C759', 'circle-stroke-color': '#0b0a10', 'circle-stroke-width': 1 },
    });
    m.addLayer({
      id: 'pings',
      type: 'circle',
      source: 'pings',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 't'], 0, 3, 1, 34],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': ['interpolate', ['linear'], ['get', 't'], 0, 3, 1, 1],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['get', 't'], 0, 1, 1, 0],
      },
    });
    m.addLayer({
      id: 'ping-core',
      type: 'circle',
      source: 'pings',
      paint: {
        'circle-radius': 4,
        'circle-color': ['get', 'color'],
        'circle-opacity': ['interpolate', ['linear'], ['get', 't'], 0, 1, 1, 0],
      },
    });
  }

  function sync() {
    const m = map.current;
    if (!m || !ready.current) return;
    const { cells: c, layers: l } = latest.current;
    (m.getSource('users') as GeoJSONSource | undefined)?.setData(cellsToGeo(c));
    (m.getSource('active') as GeoJSONSource | undefined)?.setData(cellsToGeo(c.filter((x) => x.active > 0)));
    const vis = (id: string, on: boolean) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('heat', l.heat);
    vis('user-dots', l.heat);
    vis('active-halo', l.active);
    vis('active-dot', l.active);
    vis('pings', l.transactions);
    vis('ping-core', l.transactions);
  }

  useEffect(() => {
    sync();
  }, [cells, layers]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={className} style={{ position: 'relative', background: '#0b0a10' }}>
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      {failed && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: '#c4bfd3', fontSize: 14 }}>
          <div>
            <p style={{ fontWeight: 600, color: '#fff' }}>The 3D map couldn&apos;t start in this browser.</p>
            <p style={{ marginTop: 6 }}>Live transactions and numbers still update alongside. Try Chrome or Safari with hardware acceleration on.</p>
            <p style={{ marginTop: 8, fontSize: 11, opacity: 0.6 }}>{failed}</p>
          </div>
        </div>
      )}
    </div>
  );
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export default LiveGlobe;
