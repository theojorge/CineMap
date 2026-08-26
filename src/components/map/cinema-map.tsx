import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, ZoomControl, useMap } from "react-leaflet";
import L from "leaflet";
import { MAP_CENTER, MAP_ZOOM } from "@/lib/cines/seed";
import type { Cine, CineSeed } from "@/lib/cines/types";
import { countFunciones } from "@/lib/utils";
import "leaflet/dist/leaflet.css";

type Props = {
  cines: (Cine | CineSeed)[];
  visibleSlugs: Set<string> | null;
  selectedSlug: string | null;
  loaded: boolean;
  onSelect: (slug: string) => void;
};

function pinIcon(selected: boolean, dimmed: boolean, count: number, loaded: boolean) {
  const countHtml =
    loaded && count > 0
      ? `<span class="cine-pin-count">${count > 99 ? "99+" : count}</span>`
      : "";
  return L.divIcon({
    className: "cine-marker",
    html: `<div class="cine-pin-wrap${selected ? " is-selected" : ""}${dimmed ? " is-dimmed" : ""}"><div class="cine-pin"></div>${countHtml}</div>`,
    iconSize: [28, 36],
    iconAnchor: [14, 34],
  });
}

function FlyToSelected({ cine }: { cine: CineSeed | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (!cine) return;
    map.flyTo([cine.lat, cine.lng], 14, { duration: 0.75 });
  }, [cine, map]);
  return null;
}

function InvalidateSize() {
  const map = useMap();
  useEffect(() => {
    // Multiple invalidations to ensure map renders correctly
    const timeouts = [
      window.setTimeout(() => map.invalidateSize(), 80),
      window.setTimeout(() => map.invalidateSize(), 200),
      window.setTimeout(() => map.invalidateSize(), 500),
    ];
    return () => timeouts.forEach(t => window.clearTimeout(t));
  }, [map]);
  return null;
}

export function CinemaMap({ cines, visibleSlugs, selectedSlug, loaded, onSelect }: Props) {
  const selected = cines.find((c) => c.slug === selectedSlug);

  const icons = useMemo(() => {
    return cines.map((c) => {
      const visible = !visibleSlugs || visibleSlugs.has(c.slug);
      const count = countFunciones(c);
      return pinIcon(c.slug === selectedSlug, !visible, count, loaded);
    });
  }, [cines, visibleSlugs, selectedSlug, loaded]);

  return (
    <MapContainer
      center={MAP_CENTER}
      zoom={MAP_ZOOM}
      className="h-full w-full bg-bg"
      zoomControl={false}
      attributionControl
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ZoomControl position="bottomright" />
      <InvalidateSize />
      <FlyToSelected cine={selected} />
      {cines.map((c, i) => {
        const count = countFunciones(c);
        return (
          <Marker
            key={`${c.slug}-${c.slug === selectedSlug}-${count}`}
            position={[c.lat, c.lng]}
            icon={icons[i]}
            zIndexOffset={c.slug === selectedSlug ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(c.slug) }}
          />
        );
      })}
    </MapContainer>
  );
}

function shortFormat(formato: string): string {
  return formato
    .replace(/subtitulada/i, "SUB")
    .replace(/doblada/i, "DOB")
    .replace(/castellano/i, "CAST");
}
