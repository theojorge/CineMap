"""Tests para los identificadores de butacas del scanner (df Multiplex,
payload Cinemark). Se ejecutan con `py -m unittest test_scan_cines -v`."""

import unittest

from scan_cines import (
    armar_df_atlas,
    armar_df_multiplex,
    armar_payload_cinemark,
    elegir_funcion_atlas,
    elegir_url_pelicula,
    extraer_codigos_atlas,
    extraer_df_booking,
)


class TestExtraerDfBooking(unittest.TestCase):
    def test_booking_multiplex_extrae_df(self):
        self.assertEqual(
            extraer_df_booking("https://ventas.cinemultiplex.com.ar/funcion?df=187-211-9608-20261006"),
            "187-211-9608-20261006",
        )

    def test_booking_multiplex_con_tech_extrae_df(self):
        self.assertEqual(
            extraer_df_booking("https://ventas.cinemultiplex.com.ar/funcion?df=187-178-8955-20260921-1"),
            "187-178-8955-20260921-1",
        )

    def test_booking_otras_cadenas_devuelve_none(self):
        self.assertIsNone(extraer_df_booking("https://www.cinemark.com.ar/cartelera/dot"))
        self.assertIsNone(
            extraer_df_booking("https://www.atlascines.com/Peliculas?codPelicula=586&codComplejo=191")
        )

    def test_booking_vacio_devuelve_none(self):
        self.assertIsNone(extraer_df_booking(""))
        self.assertIsNone(extraer_df_booking(None))


class TestArmarDfMultiplex(unittest.TestCase):
    def test_df_con_tech_code(self):
        self.assertEqual(
            armar_df_multiplex(
                complejo="180",
                pelicula_id="195",
                funcion_id="6233",
                fecha_iso="2026-10-06",
                tech_code="1",
            ),
            "180-195-6233-20261006-1",
        )

    def test_df_sin_tech_code(self):
        self.assertEqual(
            armar_df_multiplex(
                complejo="187",
                pelicula_id="211",
                funcion_id="9608",
                fecha_iso="2026-10-06",
                tech_code="",
            ),
            "187-211-9608-20261006",
        )

    def test_df_sin_ids_devuelve_none(self):
        self.assertIsNone(
            armar_df_multiplex(
                complejo="",
                pelicula_id="195",
                funcion_id="6233",
                fecha_iso="2026-10-06",
                tech_code="1",
            )
        )


class TestArmarPayloadCinemark(unittest.TestCase):
    def test_payload_completo(self):
        showtime = {"sessionId": 164063, "cinemaId": 733, "corporateId": 112892}
        payload = armar_payload_cinemark(showtime, {"id": 1})
        self.assertIn("cinemark", payload)

    def test_sin_session_id_no_hay_payload(self):
        self.assertEqual(armar_payload_cinemark({"cinemaId": 733}, {"id": 733}), {})


FUNCIONES_ATLAS = [
    {
        "horaComienzoOriginal": "16:00",
        "horaComienzoAjustada": "16:20",
        "subtitulada": False,
        "doblada": True,
        "codFuncion": 23798,
        "codTecnologia": 1,
        "codPelicula": 586,
    },
    {
        "horaComienzoOriginal": "12:00",
        "horaComienzoAjustada": "12:20",
        "subtitulada": False,
        "doblada": True,
        "codFuncion": 23818,
        "codTecnologia": 1,
        "codPelicula": 586,
    },
    {
        "horaComienzoOriginal": "12:00",
        "horaComienzoAjustada": "12:20",
        "subtitulada": True,
        "doblada": False,
        "codFuncion": 23819,
        "codTecnologia": 1,
        "codPelicula": 586,
    },
]


class TestArmarDfAtlas(unittest.TestCase):
    def test_df_atlas_completo(self):
        self.assertEqual(
            armar_df_atlas(
                cod_complejo="191",
                fecha_iso="2026-10-06",
                cod_pelicula="586",
                cod_funcion=23798,
                cod_tecnologia=1,
            ),
            "191-20261006-586-23798-1",
        )

    def test_df_atlas_sin_datos_devuelve_none(self):
        self.assertIsNone(
            armar_df_atlas(
                cod_complejo="191",
                fecha_iso="2026-10-06",
                cod_pelicula="586",
                cod_funcion=None,
                cod_tecnologia=1,
            )
        )


class TestExtraerCodigosAtlas(unittest.TestCase):
    def test_booking_atlas_extrae_complejo_y_pelicula(self):
        self.assertEqual(
            extraer_codigos_atlas("https://www.atlascines.com/Peliculas?codPelicula=586&codComplejo=191"),
            ("191", "586"),
        )

    def test_booking_otras_cadenas_devuelve_nones(self):
        self.assertEqual(
            extraer_codigos_atlas("https://ventas.cinemultiplex.com.ar/funcion?df=187-211-9608-20261006"),
            (None, None),
        )
        self.assertEqual(extraer_codigos_atlas(None), (None, None))


class TestElegirFuncionAtlas(unittest.TestCase):
    def test_matchea_por_hora_e_idioma(self):
        elegida = elegir_funcion_atlas(FUNCIONES_ATLAS, horario="16:00", formato="2D Doblada")
        self.assertIsNotNone(elegida)
        assert elegida is not None
        self.assertEqual(elegida["codFuncion"], 23798)

    def test_distingue_doblada_de_subtitulada(self):
        elegida = elegir_funcion_atlas(FUNCIONES_ATLAS, horario="12:00", formato="2D Subtitulada")
        self.assertIsNotNone(elegida)
        assert elegida is not None
        self.assertEqual(elegida["codFuncion"], 23819)

    def test_horario_inexistente_devuelve_none(self):
        self.assertIsNone(elegir_funcion_atlas(FUNCIONES_ATLAS, horario="23:00", formato="2D Doblada"))

    def test_hora_ambigua_devuelve_none(self):
        # 12:00 Doblada sin especificar tecnologia duplicada: dos iguales -> None
        dup = [dict(FUNCIONES_ATLAS[1]), dict(FUNCIONES_ATLAS[1])]
        self.assertIsNone(elegir_funcion_atlas(dup, horario="12:00", formato="2D Doblada"))

    def test_hora_unica_acepta_otro_nombre_de_tecnologia(self):
        # Atlas llama "4D 3D INFINITY VISION" a lo que cartelera.ar marca "4DX":
        # si la hora es única, iguala por hora e idioma.
        funciones = [
            {
                "horaComienzoOriginal": "14:40",
                "horaComienzoAjustada": "15:00",
                "subtitulada": False,
                "doblada": True,
                "codFuncion": 23796,
                "codTecnologia": 7,
                "codPelicula": 546,
                "tecnologiaNombre": "4D 3D INFINITY VISION",
            }
        ]
        elegida = elegir_funcion_atlas(funciones, horario="14:40", formato="4DX Doblada")
        self.assertIsNotNone(elegida)
        assert elegida is not None
        self.assertEqual(elegida["codFuncion"], 23796)


class TestElegirUrlPelicula(unittest.TestCase):
    ATLAS_BOOKING = "https://www.atlascines.com/Peliculas?codPelicula=586&codComplejo=191"
    GENERICA = "https://cartelera.ar/pelicula/vengadores-endgame"

    def test_atlas_usa_booking_url(self):
        self.assertEqual(
            elegir_url_pelicula("Atlas Cines", self.GENERICA, self.ATLAS_BOOKING),
            self.ATLAS_BOOKING,
        )

    def test_atlas_sin_booking_conserva_url(self):
        self.assertEqual(
            elegir_url_pelicula("Atlas Cines", self.GENERICA, ""),
            self.GENERICA,
        )

    def test_otras_cadenas_no_tocan_url(self):
        self.assertEqual(
            elegir_url_pelicula(
                "Multiplex",
                "https://multiplex.com.ar/peliculas/x/",
                self.ATLAS_BOOKING,
            ),
            "https://multiplex.com.ar/peliculas/x/",
        )


if __name__ == "__main__":
    unittest.main()
