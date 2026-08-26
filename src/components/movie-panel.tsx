import { X, MapPin } from "lucide-react";
import type { Cine, CineSeed, Funcion, Pelicula } from "@/lib/cines/types";
import { useEffect, memo } from "react";
import { preloadImage } from "@/lib/image-cache";

type MovieShowtime = {
  cine: Cine | CineSeed;
  funcion: Funcion;
  pelicula: Pelicula;
};

type Props = {
  movieTitle: string;
  showtimes: MovieShowtime[];
  loaded: boolean;
  onClose: () => void;
  onSelectFuncion: (cineSlug: string, movieTitle: string, funcion: Funcion, movieImage?: string) => void;
  movieImage?: string;
};

const ShowtimeItem = memo(({ cine, funcion, pelicula, onSelect }: {
  cine: Cine | CineSeed;
  funcion: Funcion;
  pelicula: Pelicula;
  onSelect: () => void;
}) => (
  <li>
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full flex-col items-start rounded-lg border border-border bg-surface-2 p-3 text-left hover:border-cream hover:bg-surface"
    >
      <div className="flex items-center gap-2">
        <MapPin className="size-4 shrink-0 text-fg-subtle" />
        <span className="font-medium text-fg">{cine.nombre}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-sm text-fg-muted">
        <span className="tabular-nums">{funcion.horario}</span>
        <span>·</span>
        <span>{shortFormat(funcion.formato)}</span>
        {typeof funcion.precio_general === "number" ? (
          <>
            <span>·</span>
            <span className="font-medium text-fg">{formatPrice(funcion.precio_general)}</span>
          </>
        ) : null}
        {funcion.promociones?.map((promo) => (
          <span key={promo} className="font-medium text-cream">
            · {promo}
          </span>
        ))}
      </div>
    </button>
  </li>
));

ShowtimeItem.displayName = "ShowtimeItem";

export function MoviePanel({ movieTitle, showtimes, loaded, onClose, onSelectFuncion, movieImage }: Props) {
  // Preload movie image
  useEffect(() => {
    if (movieImage) {
      preloadImage(movieImage).catch(() => {});
    }
  }, [movieImage]);

  return (
    <aside className="pointer-events-auto flex max-h-[52vh] w-full shrink-0 flex-col overflow-hidden rounded-t-xl border border-border bg-surface shadow-panel md:h-full md:max-h-none md:w-[28rem] md:rounded-xl">
      <header className="flex items-start gap-3 border-b border-border p-4">
        {movieImage ? (
          <img
            src={movieImage}
            alt={movieTitle}
            loading="lazy"
            width="56"
            height="80"
            className="h-20 w-14 shrink-0 rounded-sm object-cover"
          />
        ) : (
          <div className="h-20 w-14 shrink-0 rounded-sm bg-surface" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">Funciones</p>
          <h2 className="font-display text-xl leading-tight text-fg">{movieTitle}</h2>
          <p className="mt-1 text-sm text-fg-muted">
            {showtimes.length} {showtimes.length === 1 ? "cine" : "cines"}
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

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!loaded ? (
          <p className="text-sm text-fg-muted">Cargando horarios…</p>
        ) : showtimes.length === 0 ? (
          <p className="text-sm text-fg-muted">No hay funciones para esta película.</p>
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
            {showtimes.map(({ cine, funcion, pelicula }) => (
              <ShowtimeItem
                key={`${cine.slug}-${funcion.horario}-${funcion.formato}`}
                cine={cine}
                funcion={funcion}
                pelicula={pelicula}
                onSelect={() => onSelectFuncion(cine.slug, movieTitle, funcion, pelicula.imagen)}
              />
            ))}
          </ul>
        )}
      </div>
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
