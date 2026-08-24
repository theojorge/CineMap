import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Cine, CineSeed } from "@/lib/cines/types";

const AR_TZ = "America/Argentina/Buenos_Aires";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function todayAR(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: AR_TZ,
  }).format(new Date());
}

/** Minutes since midnight in Argentina. */
export function nowMinutesAR(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: AR_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hours = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minutes = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const h = hours === 24 ? 0 : hours;
  return h * 60 + minutes;
}

/** Parse "HH:MM" into minutes since midnight. */
export function parseHorarioMinutes(horario: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(horario.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Keep showtimes that haven't started yet for today in Argentina.
 * Other dates (Mañana, etc.) keep all times.
 */
export function isUpcomingFuncion(
  horario: string,
  dateISO: string,
  now: Date = new Date(),
): boolean {
  if (dateISO !== todayAR()) return true;
  const showMins = parseHorarioMinutes(horario);
  if (showMins === null) return true;
  return showMins > nowMinutesAR(now);
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function formatDayLabel(iso: string, today: string): string {
  if (iso === today) return "Hoy";
  if (iso === addDaysISO(today, 1)) return "Mañana";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

export function countFunciones(cine: Cine | CineSeed): number {
  if (!("peliculas" in cine) || !cine.peliculas) return 0;
  return cine.peliculas.reduce((n, p) => n + p.funciones.length, 0);
}