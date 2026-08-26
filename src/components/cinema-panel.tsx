import { ExternalLink, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Cine, CineSeed, Funcion } from "@/lib/cines/types";
import { isUpcomingFuncion } from "@/lib/utils";
import { useMemo, useEffect } from "react";
import { preloadImage } from "@/lib/image-cache";

type Props = {
  cine: Cine | CineSeed;
  loaded: boolean;
  onClose: () => void;
  onSelectFuncion?: (movieTitle: string, funcion: Funcion, movieImage?: string) => void;
  selectedDate?: string;
};

export function CinemaPanel({ cine, loaded, onClose, onSelectFuncion, selectedDate }: Props) {
  const peliculas = "peliculas" in cine ? cine.peliculas : [];

  const filteredPeliculas = useMemo(() => {
    if (!selectedDate) return peliculas;
    return peliculas
      .map((p) => ({
        ...p,
        funciones: p.funciones.filter((f) => isUpcomingFuncion(f.horario, selectedDate)),
      }))
      .filter((p) => p.funciones.length > 0);
  }, [peliculas, selectedDate]);

  // Preload images
  useEffect(() => {
    filteredPeliculas.forEach((p) => {
      if (p.imagen) {
        preloadImage(p.imagen).catch(() => {});
      }
    });
  }, [filteredPeliculas]);

  const n = filteredPeliculas.reduce((sum, p) => sum + p.funciones.length, 0);

  return (
    <aside className="pointer-events-auto flex max-h-[52vh] w-full shrink-0 flex-col overflow-hidden rounded-t-xl border border-border bg-surface shadow-panel md:h-full md:max-h-none md:w-96 md:rounded-xl">
      <header className="flex items-start gap-3 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
            {cine.cadena} · {cine.zona}
          </p>
          <h2 className="font-display text-xl leading-tight text-fg">{cine.nombre}</h2>
          <p className="mt-1 flex items-start gap-1.5 text-sm text-fg-muted">
            <MapPin className="mt-0.5 size-3.5 shrink-0" />
            <span>{cine.direccion}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
          aria-label="Cerrar"
        >
          <X className="size-5" />
        </button>
      </header>

      <div className="flex gap-2 border-b border-border p-4">
        <Button asChild className="flex-1">
          <a href={cine.sitioWeb} target="_blank" rel="noopener noreferrer">
            Comprar entradas
            <ExternalLink />
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href={cine.carteleraUrl} target="_blank" rel="noopener noreferrer">
            Ficha
          </a>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!loaded ? (
          <p className="text-sm text-fg-muted">Cargando horarios…</p>
        ) : filteredPeliculas.length === 0 ? (
          <p className="text-sm text-fg-muted">Sin funciones hoy.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {filteredPeliculas.map((p) => (
              <li key={p.titulo}>
                <div className="flex gap-3 rounded-lg border border-border bg-surface-2 p-3">
                  {p.imagen ? (
                    <img
                      src={p.imagen}
                      alt={p.titulo}
                      loading="lazy"
                      width="56"
                      height="80"
                      className="h-20 w-14 shrink-0 rounded-sm object-cover"
                    />
                  ) : (
                    <div className="h-20 w-14 shrink-0 rounded-sm bg-surface" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <h3 className="text-sm font-medium text-fg truncate">{p.titulo}</h3>
                      <span className="text-xs tabular-nums text-fg-subtle shrink-0">
                        {p.funciones.length}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {p.funciones.map((f, i) => (
                        <button
                          key={`${f.horario}-${f.formato}-${i}`}
                          type="button"
                          onClick={() => onSelectFuncion?.(p.titulo, f, p.imagen)}
                          className="inline-flex min-h-9 min-w-14 items-center justify-center gap-1.5 rounded-sm border border-border bg-surface px-2.5 py-1.5 text-xs text-fg hover:border-cream hover:bg-surface-2"
                          title={`${f.formato} — ver en mapa`}
                        >
                          <span className="font-medium tabular-nums">{f.horario}</span>
                          <span className="text-fg-subtle">{shortFormat(f.formato)}</span>
                          {typeof f.precio_general === "number" ? (
                            <span className="text-fg-muted">{formatPrice(f.precio_general)}</span>
                          ) : null}
                          {f.promociones?.map((promo) => (
                            <span key={promo} className="text-cream">{promo}</span>
                          ))}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {loaded && n > 0 ? (
        <footer className="border-t border-border px-4 py-3">
          <Badge>
            {n} {n === 1 ? "función" : "funciones"}
          </Badge>
        </footer>
      ) : null}
    </aside>
  );
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(price);
}

function shortFormat(formato: string): string {
  return formato
    .replace(/subtitulada/i, "SUB")
    .replace(/doblada/i, "DOB")
    .replace(/castellano/i, "CAST");
}
