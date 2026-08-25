#!/usr/bin/env python3
"""
scan_cines.py — Escanea la cartelera de CABA y GBA (todas las cadenas) y arma
un listado de películas con horarios.

Fuente de datos: cartelera.ar, que agrupa los cines por zona (CABA, GBA Norte,
GBA Sur, GBA Oeste, Córdoba, Rosario, etc.) y agrega horarios de Cinemark,
Showcase, Multiplex, Cinépolis, Atlas, Hoyts, Cinemacenter e independientes.
Se eligió esta fuente en lugar de scrapear cada cadena directo porque esos
sitios son SPAs; cartelera.ar entrega el dato en HTML / RSC parseable.

Uso:
    pip install requests beautifulsoup4 --break-system-packages
    python3 scan_cines.py
    python3 scan_cines.py --zonas caba
    python3 scan_cines.py --zonas caba,"gba norte",córdoba
    python3 scan_cines.py --zonas todas
    python3 scan_cines.py --cadenas cinemark,atlas
    python3 scan_cines.py --fecha 2026-08-25 --dias 1
    python3 scan_cines.py --dias 1 --json salida.json --csv salida.csv

Por defecto recorre las zonas CABA + GBA Norte/Sur/Oeste, sin filtrar por
cadena. --cadenas queda como filtro opcional.

Notas:
- Este script hace scraping "amable": espera ~1 segundo entre pedidos y
  usa un User-Agent identificable. Si vas a correrlo seguido (ej. cron),
  subí el --delay y revisá los Términos de cartelera.ar.
- La página /cines es un Next.js que manda el listado en el payload RSC
  (self.__next_f). Si cambia el formato, correlo con --debug.
"""

import argparse
import csv
import html
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urljoin, urlparse, parse_qs, unquote
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://cartelera.ar"
CINEMARK_BASE_URL = "https://bff.cinemark.com.ar/api"
MULTIPLEX_BASE_URL = "https://multiplex.com.ar"
MULTIPLEX_PRECIOS_URL = f"{MULTIPLEX_BASE_URL}/precios/"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; ScanCinesBot/1.0; uso personal; "
        "+https://cartelera.ar)"
    )
}
CINEMARK_HEADERS = {
    "country": "AR",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

TIME_RE = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")
FORMAT_RE = re.compile(
    r"\b(2D|3D|4D|4DX|XD|IMAX|D-?BOX|PREMIER|COMFORT|LASER|SCREENX|"
    r"DOBLADA|SUBTITULADA|CASTELLANO)\b",
    re.IGNORECASE,
)
# Precio por función, tal como lo concatena el HTML: "$24.000Jub. $17.000Men. $17.000"
# Jub./Men. son opcionales porque algunos formatos (ej. estrenos especiales)
# solo muestran precio general.
PRICE_RE = re.compile(
    r"^\$([\d.,]+)"
    r"(?:\s*Jub\.?\s*\$([\d.,]+))?"
    r"(?:\s*Men\.?\s*\$([\d.,]+))?$"
)
SLUG_RE = re.compile(r"/cine/([a-z0-9-]+)")
FLIGHT_PUSH_RE = re.compile(r'self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)')
CHUNK_ID_RE = re.compile(r"(?:^|\n)([0-9a-f]+):")
LREF_RE = re.compile(r'"\$L([0-9a-f]+)"')
SECTION_RE = re.compile(r'\["\$","section","([^"]+)"')
PELICULAS_RE = re.compile(r'\[(\d+)," ","películas"\]')

# Alias de CLI → zonas publicadas en /cines. "gba" cubre las tres del conurbano.
ZONAS_AMBA = ("CABA", "GBA Norte", "GBA Sur", "GBA Oeste")
ZONA_ALIASES = {
    "caba": ("CABA",),
    "capital": ("CABA",),
    "amba": ZONAS_AMBA,
    "gba": ("GBA Norte", "GBA Sur", "GBA Oeste"),
    "gba norte": ("GBA Norte",),
    "gba-norte": ("GBA Norte",),
    "gbanorte": ("GBA Norte",),
    "gba sur": ("GBA Sur",),
    "gba-sur": ("GBA Sur",),
    "gbasur": ("GBA Sur",),
    "gba oeste": ("GBA Oeste",),
    "gba-oeste": ("GBA Oeste",),
    "gbaoeste": ("GBA Oeste",),
}

# Prefijos de slug → nombre de cadena, por si el payload no trae la etiqueta.
CADENA_POR_SLUG = (
    ("cinemark", "Cinemark Hoyts"),
    ("hoyts", "Cinemark Hoyts"),
    ("showcase", "Showcase"),
    ("imax-showcase", "Showcase"),
    ("multiplex", "Multiplex"),
    ("cinepolis", "Cinépolis"),
    ("atlas", "Atlas Cines"),
    ("cinemacenter", "Cinemacenter"),
)

CADENA_API = {
    "atlas": "Atlas Cines",
    "cinemark": "Cinemark Hoyts",
    "cinepolis": "Cinépolis",
    "independiente": "Cine Independiente",
    "multiplex": "Multiplex",
    "showcase": "Showcase",
}

IDIOMA_API = {
    "cas": "Doblada",
    "sub": "Subtitulada",
    "vos": "V.O.S.",
}

CINEMARK_SLUGS = {
    "abasto": "hoyts-abasto",
    "altoavellaneda": "cinemark-avellaneda",
    "caballito": "cinemark-caballito",
    "dot": "hoyts-dot-baires",
    "malvinasargentinas": "cinemark-malvinas-argentinas",
    "moreno": "hoyts-moreno",
    "moron": "hoyts-moron",
    "palermo": "cinemark-palermo",
    "puertomadero": "cinemark-puerto-madero",
    "quilmes": "hoyts-quilmes",
    "sanjusto": "cinemark-san-justo",
    "soleil": "cinemark-soleil",
    "temperley": "hoyts-temperley",
    "tortugas": "cinemark-tortugas",
    "unicenter": "hoyts-unicenter",
}

MULTIPLEX_SLUGS = {
    "multiplex belgrano": "multiplex-belgrano",
    "multiplex canning": "multiplex-canning",
    "multiplex lavalle": "multiplex-lavalle",
    "multiplex pilar": "multiplex-pilar",
}


@dataclass
class Funcion:
    horario: str
    formato: str
    precio_general: Optional[int] = None
    precio_jubilado: Optional[int] = None
    precio_menor: Optional[int] = None


@dataclass
class Pelicula:
    titulo: str
    url: str
    imagen: str = ""
    funciones: list = field(default_factory=list)


@dataclass
class Cine:
    cadena: str
    nombre: str
    slug: str
    zona: str = ""
    direccion: str = ""
    peliculas: list = field(default_factory=list)


def log(msg: str, debug_only: bool = False, debug: bool = False):
    if debug_only and not debug:
        return
    print(msg, file=sys.stderr)


def get_soup(url: str, session: requests.Session, timeout: int = 20) -> BeautifulSoup:
    resp = session.get(url, headers=HEADERS, timeout=timeout)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")


def unescape_js_string(s: str) -> str:
    """Desescapa el string que Next.js mete en self.__next_f.push([1, "..."])."""
    out = []
    i = 0
    n = len(s)
    while i < n:
        if s[i] == "\\" and i + 1 < n:
            nxt = s[i + 1]
            if nxt == "n":
                out.append("\n")
                i += 2
                continue
            if nxt == "t":
                out.append("\t")
                i += 2
                continue
            if nxt in '"\\/':
                out.append(nxt)
                i += 2
                continue
            if nxt == "u" and i + 5 < n:
                try:
                    out.append(chr(int(s[i + 2 : i + 6], 16)))
                    i += 6
                    continue
                except ValueError:
                    pass
        out.append(s[i])
        i += 1
    return "".join(out)


def extraer_flight(html: str) -> str:
    return unescape_js_string("".join(FLIGHT_PUSH_RE.findall(html)))


def parsear_chunks(flight: str) -> dict:
    chunks = {}
    matches = list(CHUNK_ID_RE.finditer(flight))
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(flight)
        chunks[m.group(1)] = flight[start:end].strip()
    return chunks


def expandir_lrefs(texto: str, chunks: dict, depth: int = 0, seen: Optional[set] = None) -> str:
    """Reemplaza "$Lxx" por el contenido del chunk, para armar las cards completas."""
    if seen is None:
        seen = set()
    if depth > 40:
        return texto

    def repl(m):
        cid = m.group(1)
        if cid in seen or cid not in chunks:
            return m.group(0)
        seen.add(cid)
        return expandir_lrefs(chunks[cid], chunks, depth + 1, seen)

    return LREF_RE.sub(repl, texto)


def parsear_precio(texto: Optional[str]) -> Optional[int]:
    """Convierte '24.000' o '24.000,50' en un entero de pesos (redondea centavos)."""
    if not texto:
        return None
    limpio = texto.replace(".", "").split(",")[0]
    return int(limpio) if limpio.isdigit() else None


def inferir_cadena(slug: str, etiqueta: str) -> str:
    if etiqueta:
        return etiqueta
    slug_l = slug.lower()
    for prefijo, nombre in CADENA_POR_SLUG:
        if slug_l.startswith(prefijo):
            return nombre
    return "Independiente"


def parsear_card(slug: str, fragmento: str) -> Optional[dict]:
    """Saca cadena / nombre / dirección / 'sin funciones' de un fragmento de card."""
    if "Sin funciones" in fragmento:
        return None
    strings = re.findall(r'"children":"([^"]+)"', fragmento)
    cadena = ""
    nombre = ""
    direccion = ""
    if strings:
        cadena = strings[0]
        if len(strings) > 1:
            nombre = strings[1]
        if len(strings) > 2:
            direccion = strings[2]
    pelis = None
    pm = PELICULAS_RE.search(fragmento)
    if pm:
        pelis = int(pm.group(1))
        if pelis == 0:
            return None
    return {
        "slug": slug,
        "cadena": inferir_cadena(slug, cadena),
        "nombre": nombre or slug.replace("-", " ").title(),
        "direccion": direccion,
        "pelis": pelis,
    }


def extraer_cards(cuerpo: str) -> list:
    """Parte un bloque de zona en cards por href=/cine/slug."""
    cards = []
    vistos = set()
    partes = re.split(r'"href":"/cine/', cuerpo)
    for parte in partes[1:]:
        m = re.match(r"([a-z0-9-]+)", parte)
        if not m:
            continue
        slug = m.group(1)
        if slug in vistos:
            continue
        vistos.add(slug)
        card = parsear_card(slug, parte[:3000])
        if card:
            cards.append(card)
    return cards


def listar_zonas_y_cines(html: str, debug: bool = False) -> tuple:
    """
    Parsea /cines y devuelve (zonas_en_orden, {zona: [card, ...]}).
    Las zonas son las que publica cartelera.ar en los <section> del listado.
    """
    flight = extraer_flight(html)
    if not flight:
        log("  [debug] no se encontró payload RSC en /cines", True, debug)
        return [], {}

    chunks = parsear_chunks(flight)
    secciones = [
        (m.group(1), m.start())
        for m in SECTION_RE.finditer(flight)
        if not m.group(1).isdigit()
    ]
    # Nos quedamos con la primera aparición de cada zona (el stream a veces
    # duplica el árbol cuando se concatenan los chunks).
    vistas = set()
    unicas = []
    for nombre, pos in secciones:
        if nombre in vistas:
            continue
        vistas.add(nombre)
        unicas.append((nombre, pos))

    por_zona = {}
    for i, (zona, pos) in enumerate(unicas):
        siguiente_zona = unicas[i + 1][1] if i + 1 < len(unicas) else len(flight)
        # El JSON de la sección termina al arrancar el próximo chunk del
        # flight (`\n54:...`). Si no recortamos ahí, la última zona se come
        # las cards diferidas de las anteriores.
        siguiente_chunk = CHUNK_ID_RE.search(flight, pos + 1)
        fin = siguiente_zona
        if siguiente_chunk is not None:
            fin = min(fin, siguiente_chunk.start())
        cuerpo = expandir_lrefs(flight[pos:fin], chunks)
        otras = list(SECTION_RE.finditer(cuerpo))
        if len(otras) > 1:
            cuerpo = cuerpo[: otras[1].start()]
        cards = extraer_cards(cuerpo)
        por_zona[zona] = cards
        log(f"  zona {zona}: {len(cards)} cines con funciones", True, debug)

    return [z for z, _ in unicas], por_zona


def resolver_zonas_pedidas(pedido: str, zonas_disponibles: list) -> list:
    """
    Interpreta --zonas. Acepta nombres publicados (CABA, GBA Norte, ...),
    alias (caba, gba) y 'todas'.
    """
    disponibles_lower = {z.lower(): z for z in zonas_disponibles}
    if not pedido or pedido.strip().lower() in ("todas", "all", "*"):
        if pedido and pedido.strip().lower() in ("todas", "all", "*"):
            return list(zonas_disponibles)
        # Default: CABA + GBA, en el orden en que las publica el sitio.
        return [z for z in zonas_disponibles if z in ZONAS_AMBA] or list(ZONAS_AMBA)

    pedidas = []
    vistas = set()
    for raw in pedido.split(","):
        token = raw.strip()
        if not token:
            continue
        key = re.sub(r"\s+", " ", token.lower().replace("_", " "))
        if key in ("todas", "all", "*"):
            for z in zonas_disponibles:
                if z not in vistas:
                    pedidas.append(z)
                    vistas.add(z)
            continue
        if key in ZONA_ALIASES:
            for z in ZONA_ALIASES[key]:
                if z not in vistas:
                    pedidas.append(z)
                    vistas.add(z)
            continue
        if key in disponibles_lower:
            z = disponibles_lower[key]
            if z not in vistas:
                pedidas.append(z)
                vistas.add(z)
            continue
        # Prefijo: "gba" ya está en alias; "córdoba" vs "cordoba"
        key_norm = (
            key.replace("á", "a")
            .replace("é", "e")
            .replace("í", "i")
            .replace("ó", "o")
            .replace("ú", "u")
        )
        match = None
        for z in zonas_disponibles:
            z_norm = (
                z.lower()
                .replace("á", "a")
                .replace("é", "e")
                .replace("í", "i")
                .replace("ó", "o")
                .replace("ú", "u")
            )
            if z_norm == key_norm or z_norm.startswith(key_norm):
                match = z
                break
        if match is None:
            raise ValueError(token)
        if match not in vistas:
            pedidas.append(match)
            vistas.add(match)
    return pedidas


def cadena_matchea(cadena: str, slug: str, filtros: tuple) -> bool:
    if not filtros:
        return True
    blob = f"{cadena} {slug}".lower()
    return any(f in blob for f in filtros)


def listar_cines(
    session: requests.Session,
    zonas_pedido: str,
    cadenas: tuple,
    debug: bool = False,
) -> list:
    """Trae /cines y devuelve los cines de las zonas pedidas."""
    resp = session.get(f"{BASE_URL}/cines", headers=HEADERS, timeout=20)
    resp.raise_for_status()

    zonas_disponibles, por_zona = listar_zonas_y_cines(resp.text, debug=debug)
    if not zonas_disponibles:
        log("No se pudieron leer las zonas de /cines.")
        return []

    log(f"Zonas en cartelera.ar: {', '.join(zonas_disponibles)}")
    try:
        zonas = resolver_zonas_pedidas(zonas_pedido, zonas_disponibles)
    except ValueError as e:
        log(
            f"Zona no reconocida: {e}. "
            f"Disponibles: {', '.join(zonas_disponibles)} "
            f"(alias: caba, gba, amba, todas)"
        )
        sys.exit(1)

    log(f"Filtrando zonas: {', '.join(zonas)}")

    cines = []
    vistos = set()
    for zona in zonas:
        for card in por_zona.get(zona, []):
            slug = card["slug"]
            if slug in vistos:
                continue
            if not cadena_matchea(card["cadena"], slug, cadenas):
                log(f"  (omitido, cadena): {slug}", True, debug)
                continue
            vistos.add(slug)
            cines.append(
                Cine(
                    cadena=card["cadena"],
                    nombre=card["nombre"],
                    slug=slug,
                    zona=zona,
                    direccion=card["direccion"],
                )
            )
    return cines


FILENAME_INVALID_RE = re.compile(r'[\\/:*?"<>|]')


def resolver_url_real(url: str) -> str:
    """
    Si la URL es un proxy de Next.js (/_next/image?url=...), extrae la URL
    real de la imagen (ej. la de TMDB) del parámetro 'url'. Si no, la
    devuelve tal cual.
    """
    partes = urlparse(url)
    if "/_next/image" in partes.path:
        qs = parse_qs(partes.query)
        real = qs.get("url", [None])[0]
        if real:
            return unquote(real)
    return url


def nombre_archivo_desde_url(url: str) -> str:
    """Genera un nombre de archivo válido (sin caracteres prohibidos) a partir de una URL."""
    url_real = resolver_url_real(url)
    path = urlparse(url_real).path
    filename = path.rsplit("/", 1)[-1] if path else ""
    filename = FILENAME_INVALID_RE.sub("_", filename)
    if not filename or "." not in filename:
        filename = "poster.jpg"
    return filename


def slug_desde_texto(valor: str) -> str:
    slug = normalizar_texto(valor).replace(" ", "-")
    return slug.strip("-")


def poster_local_existente(titulo: str = "", url: str = "", output_dir: str = "public/posters") -> str:
    candidatos = []
    if url:
        path = urlparse(url).path.rstrip("/")
        if path:
            candidatos.append(path.rsplit("/", 1)[-1])
    if titulo:
        candidatos.append(slug_desde_texto(titulo))
    candidatos.extend(
        candidato.replace("un-nuevo-dia", "un-dia-nuevo")
        for candidato in list(candidatos)
        if "un-nuevo-dia" in candidato
    )

    for candidato in candidatos:
        if not candidato:
            continue
        for extension in (".jpg", ".jpeg", ".png", ".webp"):
            filename = f"{candidato}{extension}"
            if os.path.exists(os.path.join(output_dir, filename)):
                return f"/posters/{filename}"
    return ""


def descargar_imagen(url: str, session: requests.Session, output_dir: str = "public/posters") -> str:
    """Descarga la imagen de la película y devuelve la ruta local."""
    try:
        # Si es una URL de proxy (/_next/image?url=...), pedimos la imagen
        # real directamente: es más liviano y evita depender del proxy.
        url_descarga = resolver_url_real(url)

        resp = session.get(url_descarga, headers=HEADERS, timeout=10)
        resp.raise_for_status()

        # Crear directorio si no existe
        os.makedirs(output_dir, exist_ok=True)

        # Generar nombre de archivo válido desde la URL
        filename = nombre_archivo_desde_url(url)

        local_path = os.path.join(output_dir, filename)

        with open(local_path, "wb") as f:
            f.write(resp.content)

        return f"/posters/{filename}"
    except Exception as e:
        log(f"    !! error al descargar imagen: {e}")
        return ""


def fetch_showtimes_api(session: requests.Session, fecha: str, delay: float, debug: bool = False) -> dict:
    """Trae todos los horarios de una fecha desde la API interna de cartelera.ar."""
    showtimes = []
    movies = {}
    cinemas = {}
    page = 1
    total = None

    while total is None or len(showtimes) < total:
        params = {
            "date": fecha,
            "page": str(page),
            "pageSize": "500",
        }
        resp = session.get(f"{BASE_URL}/api/showtimes", params=params, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        page_showtimes = data.get("showtimes", [])
        showtimes.extend(page_showtimes)
        for movie in data.get("movies", []):
            movies[movie["id"]] = movie
        for cinema in data.get("cinemas", []):
            cinemas[cinema["id"]] = cinema

        total = data.get("total", len(showtimes))
        log(
            f"  API {fecha}: página {page}, {len(page_showtimes)} funciones "
            f"({len(showtimes)}/{total})",
            True,
            debug,
        )
        if not page_showtimes:
            break
        page += 1
        time.sleep(delay)

    return {
        "showtimes": showtimes,
        "movies": movies,
        "cinemas": cinemas,
    }


def nombre_cadena_api(chain: str, slug: str) -> str:
    return CADENA_API.get((chain or "").lower(), inferir_cadena(slug, ""))


def formato_api(showtime: dict) -> str:
    partes = [showtime.get("format") or "2D"]
    idioma = IDIOMA_API.get((showtime.get("language") or "").lower())
    if idioma:
        partes.append(idioma)
    return " ".join(partes)


def precio_desde_centavos(price_cents):
    if price_cents is None:
        return None
    return int(round(price_cents / 100))


def clave_formato_precio(formato: str) -> str:
    return re.sub(r"\s+", " ", (formato or "").strip()).lower()


def claves_formato_precio(formato: str) -> list:
    clave = clave_formato_precio(formato)
    if not clave:
        return []
    claves = [clave]
    base = clave.split(" ", 1)[0]
    if base and base != clave:
        claves.append(base)
    return claves


def extraer_precios_cine(
    slug: str,
    session: requests.Session,
    fecha: Optional[str],
    debug: bool = False,
) -> dict:
    """
    Usa el HTML del cine solo como fuente de precios.
    Los horarios reales siguen saliendo de la API porque el HTML puede repetir
    funciones de hoy para fechas futuras.
    """
    precios = {}
    try:
        _, peliculas = parsear_cine(
            slug,
            session,
            fecha,
            debug=debug,
            descargar_imagenes=False,
        )
    except Exception as e:
        log(f"    !! no se pudieron leer precios de {slug}: {e}", True, debug)
        return precios

    for pelicula in peliculas:
        for funcion in pelicula.funciones:
            if funcion.precio_general is None:
                continue
            precio = (
                funcion.precio_general,
                funcion.precio_jubilado,
                funcion.precio_menor,
            )
            for clave in claves_formato_precio(funcion.formato):
                precios.setdefault(clave, precio)

    log(f"  precios {slug}: {len(precios)} formatos", True, debug)
    return precios


def precio_para_formato(precios: dict, formato: str):
    for clave in claves_formato_precio(formato):
        if clave in precios:
            return precios[clave]
    return (None, None, None)


def descargar_poster_pelicula(movie: dict, session: requests.Session, descargar_imagenes: bool) -> str:
    poster_url = movie.get("posterUrl") or ""
    titulo = movie.get("title") or ""
    pelicula_url = f"{BASE_URL}/pelicula/{movie.get('slug')}" if movie.get("slug") else ""
    local = poster_local_existente(titulo, pelicula_url)
    if local:
        return local
    if not poster_url or not descargar_imagenes:
        return ""
    return descargar_imagen(poster_url, session)


def normalizar_texto(valor: str) -> str:
    tabla = str.maketrans("áéíóúüñÁÉÍÓÚÜÑ", "aeiouunAEIOUUN")
    return re.sub(r"[^a-z0-9]+", " ", (valor or "").translate(tabla).lower()).strip()


def normalizar_titulo(valor: str) -> str:
    normalizado = normalizar_texto(valor)
    if "noche del demonio" in normalizado or "insidious" in normalizado:
        return "insidious noche demonio"
    return normalizado


def score_titulo(a: str, b: str) -> float:
    set_a = set(normalizar_titulo(a).split())
    set_b = set(normalizar_titulo(b).split())
    if not set_a or not set_b:
        return 0
    interseccion = len(set_a & set_b)
    return max(interseccion / len(set_a | set_b), interseccion / min(len(set_a), len(set_b)))


def encontrar_pelicula(peliculas: list, titulo: str):
    clave = normalizar_titulo(titulo)
    for pelicula in peliculas:
        if normalizar_titulo(pelicula.titulo) == clave:
            return pelicula

    mejor = None
    mejor_score = 0.0
    for pelicula in peliculas:
        score = score_titulo(pelicula.titulo, titulo)
        if score > mejor_score:
            mejor = pelicula
            mejor_score = score
    return mejor if mejor_score >= 0.72 else None


def funcion_key(funcion: Funcion) -> tuple:
    return (
        funcion.horario,
        re.sub(r"\s+", " ", (funcion.formato or "").casefold()).strip(),
    )


def precio_por_horario_y_formato(funciones: list) -> dict:
    precios = {}
    for funcion in funciones:
        if funcion.precio_general is None:
            continue
        precios[funcion_key(funcion)] = (
            funcion.precio_general,
            funcion.precio_jubilado,
            funcion.precio_menor,
        )
    return precios


def tipo_base_formato(formato: str) -> str:
    normalizado = normalizar_texto(formato)
    if "3d" in normalizado:
        return "3d"
    if "2d" in normalizado:
        return "2d"
    return ""


def familia_sala_formato(formato: str) -> str:
    normalizado = normalizar_texto(formato)
    if "4d" in normalizado or "4dx" in normalizado:
        return "4d"
    if "d box" in normalizado or "dbox" in normalizado:
        return "dbox"
    if "imax" in normalizado:
        return "imax"
    if "screenx" in normalizado:
        return "screenx"
    if "premier" in normalizado:
        return "premier"
    if "comfort" in normalizado:
        return "comfort"
    if re.search(r"\bxd\b", normalizado):
        return "xd"
    if "laser" in normalizado:
        return "laser"
    return "standard"


def idioma_base_formato(formato: str) -> str:
    normalizado = normalizar_texto(formato)
    if "sub" in normalizado:
        return "sub"
    if any(token in normalizado for token in ("doblada", "cast", "espanol", "castellano")):
        return "dob"
    return ""


def construir_indice_precios(funciones: list) -> dict:
    indice = {
        "exacto": {},
        "por_hora": {},
        "por_familia_tipo_idioma": {},
        "por_familia_tipo": {},
        "por_familia": {},
        "fallback_standard": None,
    }
    for funcion in funciones:
        if funcion.precio_general is None:
            continue
        precio = (
            funcion.precio_general,
            funcion.precio_jubilado,
            funcion.precio_menor,
        )
        indice["exacto"].setdefault(funcion_key(funcion), precio)
        indice["por_hora"].setdefault(funcion.horario, []).append((funcion.formato, precio))
        familia = familia_sala_formato(funcion.formato)
        tipo = tipo_base_formato(funcion.formato)
        idioma = idioma_base_formato(funcion.formato)
        if tipo and idioma:
            indice["por_familia_tipo_idioma"].setdefault((familia, tipo, idioma), precio)
        if tipo:
            indice["por_familia_tipo"].setdefault((familia, tipo), precio)
        indice["por_familia"].setdefault(familia, precio)
        if familia == "standard" and indice["fallback_standard"] is None:
            indice["fallback_standard"] = precio
    return indice


def formatos_compatibles_para_precio(origen: str, destino: str) -> bool:
    familia_origen = familia_sala_formato(origen)
    familia_destino = familia_sala_formato(destino)
    if familia_origen != familia_destino:
        return False

    tipo_origen = tipo_base_formato(origen)
    tipo_destino = tipo_base_formato(destino)
    if tipo_origen and tipo_destino and tipo_origen != tipo_destino:
        return False

    idioma_origen = idioma_base_formato(origen)
    idioma_destino = idioma_base_formato(destino)
    if idioma_origen and idioma_destino and idioma_origen != idioma_destino:
        return False

    return True


def precio_desde_indice(indice: dict, funcion: Funcion):
    familia = familia_sala_formato(funcion.formato)
    tipo = tipo_base_formato(funcion.formato)
    idioma = idioma_base_formato(funcion.formato)
    precio = indice["exacto"].get(funcion_key(funcion))
    if precio:
        return precio

    for formato_base, precio_hora in indice["por_hora"].get(funcion.horario, []):
        if formatos_compatibles_para_precio(formato_base, funcion.formato):
            return precio_hora

    if tipo and idioma:
        precio = indice["por_familia_tipo_idioma"].get((familia, tipo, idioma))
        if precio:
            return precio
    if tipo:
        precio = indice["por_familia_tipo"].get((familia, tipo))
        if precio:
            return precio

    precio = indice["por_familia"].get(familia)
    if precio:
        return precio
    if familia == "standard":
        return indice["fallback_standard"]
    return None


def precios_tarifario_por_familia(tarifario: dict) -> dict:
    precios = {}
    for formato, precio in tarifario.items():
        if precio[0] is None:
            continue
        familia = familia_sala_formato(formato)
        tipo = tipo_base_formato(formato)
        idioma = idioma_base_formato(formato)
        if tipo and idioma:
            precios.setdefault((familia, tipo, idioma), precio)
        if tipo:
            precios.setdefault((familia, tipo), precio)
        precios.setdefault((familia,), precio)
    return precios


def todas_las_funciones(cine: Cine) -> list:
    return [funcion for pelicula in cine.peliculas for funcion in pelicula.funciones]


def enriquecer_precios(funciones_extra: list, funciones_base: list, indice_cine: dict | None = None) -> None:
    indice_pelicula = construir_indice_precios(funciones_base)

    for funcion in funciones_extra:
        if funcion.precio_general is not None:
            continue
        precio = precio_desde_indice(indice_pelicula, funcion)
        if not precio and indice_cine:
            precio = precio_desde_indice(indice_cine, funcion)
        if not precio:
            continue
        funcion.precio_general, funcion.precio_jubilado, funcion.precio_menor = precio


def precio_fallback_tarifario(tarifario: dict):
    for formato, precio in tarifario.items():
        if familia_sala_formato(formato) != "standard":
            continue
        if precio[0] is not None:
            return precio
    return None


def enriquecer_precios_desde_tarifario(funciones: list, tarifario: dict) -> None:
    fallback = precio_fallback_tarifario(tarifario)
    por_familia = precios_tarifario_por_familia(tarifario)
    for funcion in funciones:
        if funcion.precio_general is not None:
            continue
        precio = precio_para_formato(tarifario, funcion.formato)
        if not precio or precio[0] is None:
            familia = familia_sala_formato(funcion.formato)
            tipo = tipo_base_formato(funcion.formato)
            idioma = idioma_base_formato(funcion.formato)
            precio = (
                por_familia.get((familia, tipo, idioma))
                or por_familia.get((familia, tipo))
                or por_familia.get((familia,))
            )
        if not precio or precio[0] is None:
            if familia_sala_formato(funcion.formato) == "standard":
                precio = fallback
        if precio:
            funcion.precio_general, funcion.precio_jubilado, funcion.precio_menor = precio


def mergear_cines(cines_base: list, cines_extra: list, debug: bool = False) -> list:
    por_slug = {cine.slug: cine for cine in cines_base}
    agregadas = 0
    actualizadas = 0

    for cine_extra in cines_extra:
        cine_base = por_slug.get(cine_extra.slug)
        if cine_base is None:
            por_slug[cine_extra.slug] = cine_extra
            cines_base.append(cine_extra)
            agregadas += sum(len(p.funciones) for p in cine_extra.peliculas)
            continue

        indice_cine = construir_indice_precios(todas_las_funciones(cine_base))
        for pelicula_extra in cine_extra.peliculas:
            pelicula_base = encontrar_pelicula(cine_base.peliculas, pelicula_extra.titulo)
            if pelicula_base is None:
                enriquecer_precios(pelicula_extra.funciones, [], indice_cine)
                cine_base.peliculas.append(pelicula_extra)
                agregadas += len(pelicula_extra.funciones)
                continue

            enriquecer_precios(pelicula_extra.funciones, pelicula_base.funciones, indice_cine)
            if not pelicula_extra.imagen:
                pelicula_extra.imagen = pelicula_base.imagen
            if not pelicula_extra.url:
                pelicula_extra.url = pelicula_base.url
            pelicula_base.url = pelicula_extra.url or pelicula_base.url
            pelicula_base.imagen = pelicula_extra.imagen or pelicula_base.imagen
            pelicula_base.funciones = sorted(
                {funcion_key(f): f for f in pelicula_extra.funciones}.values(),
                key=lambda f: (f.horario, f.formato),
            )
            actualizadas += len(pelicula_base.funciones)

        cine_base.peliculas = [p for p in cine_base.peliculas if p.funciones]
        cine_base.peliculas.sort(key=lambda p: normalizar_texto(p.titulo))

    if debug:
        log(f"Extras mergeados: {actualizadas} funciones actualizadas, {agregadas} agregadas.", True, debug)
    return cines_base


def split_session_datetime(raw: str) -> tuple[str, str]:
    try:
        date_part, time_part = raw.split("T", 1)
        return date_part, time_part[:5]
    except (AttributeError, ValueError):
        return "", ""


def api_get_cinemark(session: requests.Session, endpoint: str, params: dict | None = None):
    resp = session.get(f"{CINEMARK_BASE_URL}{endpoint}", params=params, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    if not isinstance(body, dict) or "data" not in body:
        raise RuntimeError(f"Formato inesperado de Cinemark en {resp.url}")
    return body["data"]


def formato_cinemark(showtime: dict) -> str:
    formato = showtime.get("sessionFormat") or "2D"
    language = showtime.get("language") or {}
    idioma = language.get("shortName") or language.get("name") or ""
    idioma_norm = normalizar_texto(idioma)
    if idioma_norm in ("sub", "subtitulada", "subtitulado"):
        idioma = "Subtitulada"
    elif idioma_norm in ("cas", "cast", "esp", "dob", "doblada", "castellano", "espanol"):
        idioma = "Doblada"
    if idioma and normalizar_texto(idioma) not in normalizar_texto(formato):
        formato = f"{formato} {idioma}"
    return re.sub(r"\s+", " ", formato).strip()


def escanear_cinemark_directo(fecha: str, debug: bool = False) -> list:
    session = requests.Session()
    session.headers.update(CINEMARK_HEADERS)
    theaters = api_get_cinemark(session, "/cinema/theaters", {"limit": "100"})
    movies = api_get_cinemark(session, "/cinema/movies")
    theater_ids = [str(t["id"]) for t in theaters if t.get("id") is not None]
    showtimes = api_get_cinemark(
        session,
        "/cinema/showtimes",
        {"theater": ",".join(theater_ids), "_t": str(int(time.time() * 1000))},
    )

    theater_map = {str(t.get("id")): t for t in theaters}
    movie_map = {str(m.get("corporateId")): m for m in movies if m.get("corporateId") is not None}
    cines = {}
    peliculas = {}

    for showtime in showtimes:
        date_part, horario = split_session_datetime(showtime.get("sessionDateTime", ""))
        if date_part != fecha or not horario:
            continue
        theater = theater_map.get(str(showtime.get("theaterId", "")), {})
        theater_slug = str(theater.get("slug") or "")
        slug = CINEMARK_SLUGS.get(theater_slug)
        if not slug:
            continue

        if slug not in cines:
            cines[slug] = Cine(
                cadena="Cinemark Hoyts",
                nombre=theater.get("name") or slug.replace("-", " ").title(),
                slug=slug,
            )
            peliculas[slug] = {}

        movie = movie_map.get(str(showtime.get("corporateId", "")), {})
        titulo = showtime.get("movieName") or movie.get("title") or "Sin título"
        movie_key = normalizar_texto(titulo)
        if movie_key not in peliculas[slug]:
            movie_slug = movie.get("slug") or ""
            url_pelicula = f"https://www.cinemark.com.ar/peliculas/{movie_slug}" if movie_slug else ""
            peliculas[slug][movie_key] = Pelicula(
                titulo=titulo,
                url=url_pelicula,
                imagen=poster_local_existente(titulo, url_pelicula),
            )

        peliculas[slug][movie_key].funciones.append(
            Funcion(
                horario=horario,
                formato=formato_cinemark(showtime),
            )
        )

    for slug, cine in cines.items():
        cine.peliculas = list(peliculas[slug].values())

    if debug:
        total = sum(len(p.funciones) for c in cines.values() for p in c.peliculas)
        log(f"Cinemark directo: {len(cines)} cines, {total} funciones para {fecha}.", True, debug)
    return list(cines.values())


def parsear_multiplex_complejos(soup: BeautifulSoup) -> dict:
    mapa = {}
    contenedor = soup.find(id="filtro-complejos")
    if not contenedor:
        return mapa
    for label in contenedor.find_all("label"):
        inp = label.find("input")
        if inp and inp.get("value"):
            mapa[str(inp["value"])] = label.get_text(strip=True)
    return mapa


def fecha_multiplex_iso(fecha_mdy: str) -> str:
    try:
        return datetime.strptime(fecha_mdy, "%m.%d.%Y").strftime("%Y-%m-%d")
    except ValueError:
        return fecha_mdy


def formato_multiplex(funcion: dict) -> str:
    partes = [funcion.get("formato") or "2D"]
    idioma = funcion.get("idioma") or ""
    if normalizar_texto(idioma) == "espanol":
        idioma = "Doblada"
    if idioma and normalizar_texto(idioma) not in normalizar_texto(partes[0]):
        partes.append(idioma)
    return re.sub(r"\s+", " ", " ".join(partes)).strip()


def escanear_multiplex_directo(fecha: str, debug: bool = False, descargar_imagenes: bool = False) -> list:
    session = requests.Session()
    soup = get_soup(MULTIPLEX_BASE_URL, session)
    complejos = parsear_multiplex_complejos(soup)
    cines = {}
    peliculas = {}

    for bloque in soup.select("div.funcion-item"):
        raw = bloque.get("data-funciones")
        if not raw:
            continue
        try:
            funciones_raw = json.loads(html.unescape(raw))
        except json.JSONDecodeError:
            continue
        if not funciones_raw:
            continue

        cabecera = bloque.find("div", class_="pelicula-cabecera")
        titulo = ""
        url_pelicula = ""
        img_url = ""
        if cabecera:
            a_titulo = cabecera.find("a", class_="titulo-link")
            if a_titulo:
                titulo = a_titulo.get_text(strip=True)
                url_pelicula = a_titulo.get("href") or ""
            a_portada = cabecera.find("a", class_="portada-link")
            if a_portada:
                url_pelicula = a_portada.get("href") or url_pelicula
                img_tag = a_portada.find("img")
                if img_tag:
                    img_url = img_tag.get("src") or ""
        if not titulo:
            h4 = bloque.find("h4")
            titulo = h4.get_text(strip=True) if h4 else "Sin título"

        if url_pelicula.startswith("/"):
            url_pelicula = f"{MULTIPLEX_BASE_URL}{url_pelicula}"
        if img_url.startswith("/"):
            img_url = f"{MULTIPLEX_BASE_URL}{img_url}"

        for funcion in funciones_raw:
            fecha_funcion = fecha_multiplex_iso(funcion.get("dia_real") or funcion.get("dia") or "")
            if fecha_funcion != fecha:
                continue
            nombre_complejo = complejos.get(str(funcion.get("complejo", "")), "")
            slug = MULTIPLEX_SLUGS.get(normalizar_texto(nombre_complejo))
            if not slug:
                continue

            if slug not in cines:
                cines[slug] = Cine(
                    cadena="Multiplex",
                    nombre=nombre_complejo or slug.replace("-", " ").title(),
                    slug=slug,
                )
                peliculas[slug] = {}

            movie_key = normalizar_texto(titulo)
            if movie_key not in peliculas[slug]:
                imagen = ""
                if img_url and descargar_imagenes:
                    imagen = descargar_imagen(img_url, session)
                if not imagen:
                    imagen = poster_local_existente(titulo, url_pelicula)
                peliculas[slug][movie_key] = Pelicula(
                    titulo=titulo,
                    url=url_pelicula,
                    imagen=imagen,
                )

            peliculas[slug][movie_key].funciones.append(
                Funcion(
                    horario=funcion.get("hora", ""),
                    formato=formato_multiplex(funcion),
                )
            )

    for slug, cine in cines.items():
        cine.peliculas = list(peliculas[slug].values())

    if debug:
        total = sum(len(p.funciones) for c in cines.values() for p in c.peliculas)
        log(f"Multiplex directo: {len(cines)} cines, {total} funciones para {fecha}.", True, debug)
    return list(cines.values())


def enriquecer_con_scrapers_directos(cines: list, fecha: str, debug: bool = False, descargar_imagenes: bool = False) -> list:
    scanners = (
        ("Cinemark", lambda: escanear_cinemark_directo(fecha, debug=debug)),
        ("Multiplex", lambda: escanear_multiplex_directo(fecha, debug=debug, descargar_imagenes=descargar_imagenes)),
    )
    for nombre, scanner in scanners:
        try:
            cines_extra = scanner()
        except Exception as e:
            log(f"!! no se pudo enriquecer con {nombre}: {e}")
            continue
        mergear_cines(cines, cines_extra, debug=debug)
    return cines


def armar_cines_desde_api(
    payload: dict,
    zonas_pedido: str,
    cadenas: tuple,
    session: requests.Session,
    fecha: Optional[str],
    descargar_imagenes: bool,
    debug: bool = False,
) -> list:
    cinemas = payload["cinemas"]
    movies = payload["movies"]
    zonas_disponibles = sorted({c.get("zone", "") for c in cinemas.values() if c.get("zone")})
    zonas = resolver_zonas_pedidas(zonas_pedido, zonas_disponibles)
    zonas_set = set(zonas)

    cines_por_id = {}
    peliculas_por_cine = {}
    imagen_por_movie_id = {}
    precios_por_cine = {}

    for cinema_id, cinema in cinemas.items():
        slug = cinema.get("slug", "")
        cadena = nombre_cadena_api(cinema.get("chain", ""), slug)
        if cinema.get("zone") not in zonas_set:
            continue
        if not cadena_matchea(cadena, slug, cadenas):
            continue

        cines_por_id[cinema_id] = Cine(
            cadena=cadena,
            nombre=cinema.get("name") or slug.replace("-", " ").title(),
            slug=slug,
            zona=cinema.get("zone", ""),
            direccion=cinema.get("address", ""),
        )
        peliculas_por_cine[cinema_id] = {}

    for showtime in sorted(payload["showtimes"], key=lambda s: (s.get("cinemaId"), s.get("movieId"), s.get("time", ""))):
        cinema_id = showtime.get("cinemaId")
        movie_id = showtime.get("movieId")
        if cinema_id not in cines_por_id or movie_id not in movies:
            continue

        movie = movies[movie_id]
        peliculas = peliculas_por_cine[cinema_id]
        if movie_id not in peliculas:
            if movie_id not in imagen_por_movie_id:
                imagen_por_movie_id[movie_id] = descargar_poster_pelicula(
                    movie,
                    session,
                    descargar_imagenes,
                )
            peliculas[movie_id] = Pelicula(
                titulo=movie.get("title") or "Sin título",
                url=f"{BASE_URL}/pelicula/{movie.get('slug')}" if movie.get("slug") else "",
                imagen=imagen_por_movie_id[movie_id],
            )

        formato = formato_api(showtime)
        precio_general = precio_desde_centavos(showtime.get("priceCents"))
        precio_jubilado = None
        precio_menor = None
        if precio_general is None:
            if cinema_id not in precios_por_cine:
                precios_por_cine[cinema_id] = extraer_precios_cine(
                    cines_por_id[cinema_id].slug,
                    session,
                    fecha,
                    debug=debug,
                )
            precio_general, precio_jubilado, precio_menor = precio_para_formato(
                precios_por_cine[cinema_id],
                formato,
            )

        peliculas[movie_id].funciones.append(
            Funcion(
                horario=showtime.get("time", ""),
                formato=formato,
                precio_general=precio_general,
                precio_jubilado=precio_jubilado,
                precio_menor=precio_menor,
            )
        )

    resultado = []
    for cinema_id, cine in cines_por_id.items():
        cine.peliculas = [
            pelicula
            for pelicula in peliculas_por_cine[cinema_id].values()
            if pelicula.funciones
        ]
        resultado.append(cine)

    log(f"Encontrados {len(resultado)} cines con datos API.", True, debug)
    return resultado


def parsear_cine(slug: str, session: requests.Session, fecha: Optional[str], debug: bool = False, descargar_imagenes: bool = False):
    """Trae /cine/{slug} y devuelve (nombre_real, [Pelicula, ...])."""
    url = f"{BASE_URL}/cine/{slug}"
    if fecha:
        url += f"?date={fecha}"

    soup = get_soup(url, session)

    h1 = soup.find("h1")
    nombre_real = h1.get_text(strip=True) if h1 else slug

    # Next.js streamea la cartelera a un slot #S:0 hermano de <main>, no adentro.
    root = soup.find(id="S:0") or soup.find("main") or soup
    if not root.select('a[href^="/pelicula/"]'):
        root = soup

    peliculas_por_titulo = {}
    orden_titulos = []
    current_titulo = None
    current_formato = None
    current_precio_general = None
    current_precio_jubilado = None
    current_precio_menor = None

    for el in root.descendants:
        nombre_tag = getattr(el, "name", None)
        if nombre_tag is None:
            continue

        # Título de película: <a href="/pelicula/...">
        if nombre_tag == "a" and el.get("href", "").startswith("/pelicula/"):
            titulo = el.get_text(strip=True)
            if titulo and not TIME_RE.match(titulo):
                current_titulo = titulo
                current_formato = None
                current_precio_general = None
                current_precio_jubilado = None
                current_precio_menor = None
                if titulo not in peliculas_por_titulo:
                    href = el["href"]
                    url_pelicula = href if href.startswith("http") else BASE_URL + href
                    pelicula = Pelicula(titulo=titulo, url=url_pelicula)
                    
                    # Intentar obtener la imagen de la página de la película
                    if descargar_imagenes:
                        try:
                            peli_soup = get_soup(url_pelicula, session, timeout=10)
                            img_tag = peli_soup.find("img", alt=lambda x: x and titulo.lower() in x.lower())
                            if img_tag and img_tag.get("src"):
                                img_url = img_tag["src"]
                                if not img_url.startswith("http"):
                                    img_url = urljoin(BASE_URL, img_url)
                                pelicula.imagen = descargar_imagen(img_url, session)
                        except Exception as e:
                            log(f"    !! error al obtener imagen de {titulo}: {e}", True, debug)
                    
                    peliculas_por_titulo[titulo] = pelicula
                    orden_titulos.append(titulo)
            continue

        # Horario: cualquier <a> cuyo texto sea HH:MM
        if nombre_tag == "a":
            txt = el.get_text(strip=True)
            if TIME_RE.match(txt) and current_titulo is not None:
                peliculas_por_titulo[current_titulo].funciones.append(
                    Funcion(
                        horario=txt,
                        formato=current_formato or "2D",
                        precio_general=current_precio_general,
                        precio_jubilado=current_precio_jubilado,
                        precio_menor=current_precio_menor,
                    )
                )
            continue

        # Precio: bloque tipo "$24.000Jub. $17.000Men. $17.000", pegado
        # justo antes de los horarios de cada formato. Exigimos que empiece
        # con "$" y contenga "Jub"/"Men" para no matchear los fragmentos
        # sueltos ("$17.000" solo, o "Jub. $17.000" solo) que aparecen al
        # recorrer los hijos del mismo bloque.
        if current_titulo is not None:
            txt = el.get_text(strip=True)
            if txt.startswith("$") and ("Jub" in txt or "Men" in txt) and len(txt) < 80:
                m = PRICE_RE.match(txt)
                if m:
                    current_precio_general = parsear_precio(m.group(1))
                    current_precio_jubilado = parsear_precio(m.group(2))
                    current_precio_menor = parsear_precio(m.group(3))
                continue

        # Etiqueta de formato: texto corto tipo "2D Subtitulada"
        if current_titulo is not None:
            txt = el.get_text(strip=True)
            if txt and len(txt) < 40 and FORMAT_RE.search(txt):
                current_formato = txt

    peliculas = [peliculas_por_titulo[t] for t in orden_titulos if peliculas_por_titulo[t].funciones]

    if debug and not peliculas:
        log(f"  [debug] no se encontraron funciones parseables en {url}", True, debug)

    return nombre_real, peliculas


def escanear(
    zonas_pedido: str,
    cadenas: tuple,
    fecha: Optional[str],
    delay: float,
    debug: bool = False,
    descargar_imagenes: bool = False,
) -> list:
    session = requests.Session()
    if not fecha:
        fecha = fecha_argentina_hoy()

    log(f"Buscando funciones en cartelera.ar para {fecha} ...")
    payload = fetch_showtimes_api(session, fecha, delay, debug=debug)
    log(f"Encontradas {len(payload['showtimes'])} funciones.\n")
    return armar_cines_desde_api(
        payload,
        zonas_pedido,
        cadenas,
        session,
        fecha,
        descargar_imagenes,
        debug=debug,
    )


def exportar_json(cines: list, path: str):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    data = [asdict(c) for c in cines]
    for cine in data:
        for pelicula in cine["peliculas"]:
            if not pelicula.get("imagen"):
                pelicula["imagen"] = poster_local_existente(
                    pelicula.get("titulo", ""),
                    pelicula.get("url", ""),
                )
            for funcion in pelicula["funciones"]:
                funcion.pop("precio_general", None)
                funcion.pop("precio_jubilado", None)
                funcion.pop("precio_menor", None)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def precio_a_dict(precio: tuple, formato: str) -> dict:
    return {
        "formato": formato,
        "precio_general": precio[0],
        "precio_jubilado": precio[1],
        "precio_menor": precio[2],
    }


def agregar_precio_tarifario(tarifario: dict, formato: str, precio: tuple):
    clave = clave_formato_precio(formato)
    actual = tarifario.get(clave)
    if actual is None:
        tarifario[clave] = precio_a_dict(precio, formato)
        return
    if precio[0] is None:
        return
    if actual["precio_general"] is None or precio[0] > actual["precio_general"]:
        tarifario[clave] = precio_a_dict(precio, formato)


def recolectar_precios(cines: list) -> dict:
    precios = {}
    for cine in cines:
        if cine.slug not in precios:
            precios[cine.slug] = {
                "cadena": cine.cadena,
                "nombre": cine.nombre,
                "formatos": {},
            }
        formatos = precios[cine.slug]["formatos"]
        for pelicula in cine.peliculas:
            for funcion in pelicula.funciones:
                agregar_precio_tarifario(
                    formatos,
                    funcion.formato,
                    (
                        funcion.precio_general,
                        funcion.precio_jubilado,
                        funcion.precio_menor,
                    ),
                )
    return {
        slug: {
            **cine,
            "formatos": dict(sorted(cine["formatos"].items())),
        }
        for slug, cine in sorted(precios.items())
        if cine["formatos"]
    }


def cargar_json_existente(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def fusionar_precios(generados: dict, existentes: dict) -> dict:
    promociones = existentes.get("promociones")
    if promociones is None:
        promociones = [
            {
                "id": "ejemplo-2x1-miercoles",
                "nombre": "2x1 miércoles",
                "activa": False,
                "dias": [3],
                "cadenas": ["Cinemark Hoyts"],
                "formatos": ["*"],
                "tipo": "2x1",
            }
        ]
    resultado = {
        "version": 1,
        "cines": generados,
        "promociones": promociones,
    }
    for slug, cine_existente in existentes.get("cines", {}).items():
        cine_resultado = resultado["cines"].setdefault(
            slug,
            {
                "cadena": cine_existente.get("cadena", ""),
                "nombre": cine_existente.get("nombre", slug),
                "formatos": {},
            },
        )
        for clave, precio_existente in cine_existente.get("formatos", {}).items():
            if precio_existente.get("precio_general") is not None:
                cine_resultado["formatos"][clave] = precio_existente
            else:
                cine_resultado["formatos"].setdefault(clave, precio_existente)
    return resultado


def exportar_precios_json(cines: list, path: str):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    existentes = cargar_json_existente(path)
    data = fusionar_precios(recolectar_precios(cines), existentes)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def fecha_argentina_hoy() -> str:
    return datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).date().isoformat()


def descubrir_cantidad_dias_disponibles(session: requests.Session, debug: bool = False) -> int:
    """Lee del frontend de cartelera.ar cuántos días muestra el selector."""
    try:
        resp = session.get(f"{BASE_URL}/cines", headers=HEADERS, timeout=20)
        resp.raise_for_status()
        scripts = sorted(set(re.findall(r'src="([^"]+\.js)"', resp.text)))
        for src in scripts:
            url = src if src.startswith("http") else urljoin(BASE_URL, src)
            js = session.get(url, headers=HEADERS, timeout=20).text
            match = re.search(r"getNextDays\)\((\d+)\)", js) or re.search(
                r"getNextDays\((\d+)\)",
                js,
            )
            if match:
                cantidad = int(match.group(1))
                log(f"Fechas disponibles detectadas en cartelera.ar: {cantidad}", True, debug)
                return cantidad
    except Exception as e:
        log(f"  [debug] no se pudo detectar la cantidad de fechas: {e}", True, debug)
    return 7


def fechas_disponibles_cartelera(
    session: requests.Session,
    dias: Optional[int],
    fecha_inicio: Optional[str],
    debug: bool = False,
) -> list:
    """
    Devuelve las fechas que publica cartelera.ar en su selector.
    Si --dias no se pasa, detecta la cantidad desde el frontend del sitio.
    """
    inicio = fecha_inicio or fecha_argentina_hoy()
    cantidad = dias if dias is not None else descubrir_cantidad_dias_disponibles(session, debug)
    return [
        (datetime.fromisoformat(inicio) + timedelta(days=i)).date().isoformat()
        for i in range(max(cantidad, 1))
    ]


def filtrar_funciones_pasadas(cines: list, fecha: Optional[str]):
    """Quita funciones vencidas y películas que se quedaron sin funciones futuras."""
    fecha_objetivo = fecha or fecha_argentina_hoy()
    hoy = fecha_argentina_hoy()
    if fecha_objetivo > hoy:
        return

    ahora = datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).strftime("%H:%M")
    for cine in cines:
        peliculas_vigentes = []
        for peli in cine.peliculas:
            if fecha_objetivo < hoy:
                peli.funciones = []
            elif fecha_objetivo == hoy:
                peli.funciones = [f for f in peli.funciones if f.horario >= ahora]
            if peli.funciones:
                peliculas_vigentes.append(peli)
        cine.peliculas = peliculas_vigentes


def limpiar_posters_no_usados(cines: list, output_dir: str = "public/posters"):
    """Borra posters locales que ya no están referenciados por la cartelera vigente."""
    if not os.path.isdir(output_dir):
        return

    usados = set()
    for cine in cines:
        for peli in cine.peliculas:
            imagen = getattr(peli, "imagen", "") or ""
            if imagen.startswith("/posters/"):
                usados.add(os.path.basename(imagen))

    for filename in os.listdir(output_dir):
        path = os.path.join(output_dir, filename)
        if os.path.isfile(path) and filename not in usados:
            os.remove(path)


def limpiar_archivos_vencidos(directorio: str, extension: str):
    """Borra archivos YYYY-MM-DD.ext anteriores a hoy en Argentina."""
    if not os.path.isdir(directorio):
        return

    hoy = fecha_argentina_hoy()
    patron = re.compile(rf"^(\d{{4}}-\d{{2}}-\d{{2}})\.{re.escape(extension)}$")
    for filename in os.listdir(directorio):
        match = patron.match(filename)
        if match and match.group(1) < hoy:
            os.remove(os.path.join(directorio, filename))


def exportar_csv(cines: list, path: str):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "zona", "cadena", "cine", "direccion", "pelicula", "formato",
                "horario", "precio_general", "precio_jubilado", "precio_menor",
                "url_pelicula",
            ]
        )
        for cine in cines:
            for peli in cine.peliculas:
                for func in peli.funciones:
                    writer.writerow(
                        [
                            cine.zona,
                            cine.cadena,
                            cine.nombre,
                            cine.direccion,
                            peli.titulo,
                            func.formato,
                            func.horario,
                            "",
                            "",
                            "",
                            peli.url,
                        ]
                    )


def imprimir_resumen(cines: list):
    total_funciones = sum(len(p.funciones) for c in cines for p in c.peliculas)
    print(f"\n=== Resumen: {len(cines)} cines, {total_funciones} funciones ===\n")
    zona_actual = None
    for cine in cines:
        if not cine.peliculas:
            continue
        if cine.zona != zona_actual:
            zona_actual = cine.zona
            print(f"## {zona_actual}")
        print(f"### {cine.cadena} — {cine.nombre}")
        if cine.direccion:
            print(f"    {cine.direccion}")
        for peli in cine.peliculas:
            horarios = ", ".join(f"{f.horario} ({f.formato})" for f in peli.funciones)
            print(f"  - {peli.titulo}: {horarios}")
            precios = {
                (f.formato, f.precio_general, f.precio_jubilado, f.precio_menor)
                for f in peli.funciones
                if f.precio_general is not None
            }
            for formato, general, jubilado, menor in sorted(precios):
                extra = []
                if jubilado is not None:
                    extra.append(f"Jub. ${jubilado:,}".replace(",", "."))
                if menor is not None:
                    extra.append(f"Men. ${menor:,}".replace(",", "."))
                extra_str = f" ({', '.join(extra)})" if extra else ""
                print(f"      {formato}: ${general:,}".replace(",", ".") + extra_str)
        print()


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(
        description=(
            "Escanea horarios de cine en CABA y GBA (todas las cadenas) "
            "usando las zonas de cartelera.ar."
        )
    )
    parser.add_argument(
        "--zonas",
        default="caba,gba",
        help=(
            "Zonas a incluir, separadas por coma. "
            "Default: caba,gba (CABA + GBA Norte/Sur/Oeste). "
            "Valores: caba, gba, gba norte, gba sur, gba oeste, amba, todas, "
            "o el nombre publicado (Córdoba, Rosario, ...)."
        ),
    )
    parser.add_argument(
        "--cadenas",
        default="",
        help=(
            "Filtro opcional de cadenas, separadas por coma "
            "(ej. cinemark,atlas,cinepolis). Default: todas."
        ),
    )
    parser.add_argument("--fecha", default=None, help="Fecha inicial en formato YYYY-MM-DD (default: hoy).")
    parser.add_argument(
        "--dias",
        type=int,
        default=None,
        help=(
            "Cantidad de días consecutivos a escanear. "
            "Default: todas las fechas disponibles en cartelera.ar."
        ),
    )
    parser.add_argument("--json-dir", default="public/cartelera", help="Directorio de JSON por día.")
    parser.add_argument("--csv-dir", default="cartelera-csv", help="Directorio de CSV por día.")
    parser.add_argument("--precios", default="public/cartelera/precios.json", help="Archivo JSON único de precios.")
    parser.add_argument("--json", default=None, help="Archivo JSON de salida para un solo día.")
    parser.add_argument("--csv", default=None, help="Archivo CSV de salida para un solo día.")
    parser.add_argument("--delay", type=float, default=1.0, help="Segundos entre pedidos (default 1.0).")
    parser.add_argument("--debug", action="store_true", help="Mostrar info extra de diagnóstico.")
    parser.add_argument(
        "--no-descargar-imagenes",
        dest="descargar_imagenes",
        action="store_false",
        help="Desactivar la descarga de imágenes (por defecto SÍ se descargan).",
    )
    parser.add_argument(
        "--sin-extras",
        dest="usar_extras",
        action="store_false",
        help="No enriquecer Cinemark/Multiplex con los scrapers directos.",
    )
    parser.set_defaults(descargar_imagenes=True, usar_extras=True)
    args = parser.parse_args()

    cadenas = tuple(c.strip().lower() for c in args.cadenas.split(",") if c.strip())

    session_fechas = requests.Session()
    fechas = fechas_disponibles_cartelera(session_fechas, args.dias, args.fecha, args.debug)
    log(f"Fechas a escanear: {', '.join(fechas)}")

    resultados = []
    for fecha in fechas:
        json_path = args.json if args.json and len(fechas) == 1 else os.path.join(args.json_dir, f"{fecha}.json")
        csv_path = args.csv if args.csv and len(fechas) == 1 else os.path.join(args.csv_dir, f"{fecha}.csv")

        log(f"\n=== Escaneando fecha {fecha} ===")
        cines = escanear(args.zonas, cadenas, fecha, args.delay, debug=args.debug, descargar_imagenes=args.descargar_imagenes)
        if args.usar_extras:
            cines = enriquecer_con_scrapers_directos(
                cines,
                fecha,
                debug=args.debug,
                descargar_imagenes=args.descargar_imagenes,
            )
        filtrar_funciones_pasadas(cines, fecha)
        exportar_json(cines, json_path)
        exportar_csv(cines, csv_path)
        resultados.extend(cines)
        print(f"Guardado: {json_path} y {csv_path}")

    exportar_precios_json(resultados, args.precios)
    print(f"Guardado: {args.precios}")

    limpiar_archivos_vencidos(args.json_dir, "json")
    limpiar_archivos_vencidos(args.csv_dir, "csv")

    if args.descargar_imagenes:
        limpiar_posters_no_usados(resultados)
    imprimir_resumen(resultados)


if __name__ == "__main__":
    main()
