import { useEffect, useState, type ComponentType } from "react";
import type { Cine, CineSeed } from "@/lib/cines/types";

type MapProps = {
  cines: (Cine | CineSeed)[];
  visibleSlugs: Set<string> | null;
  selectedSlug: string | null;
  loaded: boolean;
  onSelect: (slug: string) => void;
};

export function MapLoader(props: MapProps) {
  const [Comp, setComp] = useState<ComponentType<MapProps> | null>(null);

  useEffect(() => {
    let alive = true;
    void import("./cinema-map").then((m) => {
      if (alive) setComp(() => m.CinemaMap);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!Comp) {
    return <div className="h-full w-full bg-bg" aria-hidden />;
  }

  return <Comp {...props} />;
}
