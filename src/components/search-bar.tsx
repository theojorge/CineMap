import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn, formatDayLabel } from "@/lib/utils";
import type { Cine, CineSeed } from "@/lib/cines/types";
import { useEffect } from "react";
import { preloadImage } from "@/lib/image-cache";

type MovieMatch = {
  movieTitle: string;
  cineSlug: string;
  cine: Cine | CineSeed;
  movieImage?: string;
};

type Props = {
  query: string;
  onQuery: (q: string) => void;
  date: string;
  dates: string[];
  today: string;
  onDate: (d: string) => void;
  movieMatches: MovieMatch[];
  onPickMovie: (movieTitle: string) => void;
  loading: boolean;
};

export function SearchBar({
  query,
  onQuery,
  date,
  dates,
  today,
  onDate,
  movieMatches,
  onPickMovie,
  loading,
}: Props) {
  const showList = query.trim().length > 0 && movieMatches.length > 0;

  // Preload images for search results
  useEffect(() => {
    movieMatches.forEach((m) => {
      if (m.movieImage) {
        preloadImage(m.movieImage).catch(() => {});
      }
    });
  }, [movieMatches]);

  return (
    <div className="pointer-events-auto flex w-full max-w-xl flex-col gap-2">
      <div className="rounded-xl border border-border bg-surface/95 p-2 shadow-panel backdrop-blur-sm">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Buscar película"
            className="border-0 bg-transparent pl-10 pr-10"
            aria-label="Buscar película"
            autoComplete="off"
          />
          {query ? (
            <button
              type="button"
              className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-sm text-fg-subtle hover:text-fg"
              onClick={() => onQuery("")}
              aria-label="Limpiar búsqueda"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        {showList ? (
          <ul className="mt-1 max-h-52 overflow-y-auto border-t border-border pt-1">
            {movieMatches.slice(0, 8).map((m) => (
              <li key={m.movieTitle}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left hover:bg-surface-2"
                  onClick={() => onPickMovie(m.movieTitle)}
                >
                  {m.movieImage ? (
                    <img
                      src={m.movieImage}
                      alt={m.movieTitle}
                      loading="lazy"
                      width="32"
                      height="48"
                      className="h-12 w-8 shrink-0 rounded-sm object-cover"
                    />
                  ) : (
                    <div className="h-12 w-8 shrink-0 rounded-sm bg-surface" />
                  )}
                  <span className="text-sm font-medium text-fg">{m.movieTitle}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-1 flex gap-1 overflow-x-auto pb-0.5">
          {dates.map((d) => {
            const active = d === date;
            return (
              <button
                key={d}
                type="button"
                onClick={() => onDate(d)}
                className={cn(
                  "h-9 shrink-0 rounded-full px-3 text-xs font-medium capitalize",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "bg-surface-2 text-fg-muted hover:text-fg",
                )}
              >
                {formatDayLabel(d, today)}
              </button>
            );
          })}
        </div>
      </div>
      {loading ? (
        <p className="px-1 text-xs text-fg-muted">Actualizando funciones…</p>
      ) : null}
    </div>
  );
}
