"""Reglas de limpieza puras (docs/DATOS.md), sin Excel ni base de datos."""

from datetime import date

import pytest

from app.importer.cleaning import (
    clean_environ_id,
    clean_tipo,
    parse_caja_numero,
    parse_encargado,
    parse_fecha_entrada,
    parse_fecha_salida,
    parse_pasaje,
    parse_posicion,
    parse_propietario_caja,
    parse_rack_letter,
    parse_seccion,
    parse_si_no,
)


@pytest.mark.parametrize(
    "raw",
    ["Medio condicionado", "Medio Condicionado", "MC", " medio condicionado "],
)
def test_clean_tipo_medio_condicionado_variants(raw):
    assert clean_tipo(raw) == ("medio_condicionado", None, None)


@pytest.mark.parametrize("raw", ["RNA later", "RNA-later", "RNA Later"])
def test_clean_tipo_rna_later_variants(raw):
    assert clean_tipo(raw) == ("rna_later", None, None)


def test_clean_tipo_vial_maps_to_vial_de_celulas():
    assert clean_tipo("Vial") == ("vial_celulas", None, None)


@pytest.mark.parametrize("raw", ["Linea celular", "Lineas celulares", "Línea celular"])
def test_clean_tipo_linea_celular_falls_back_to_otros(raw):
    tipo, type_other, reason = clean_tipo(raw)
    assert tipo == "otros"
    assert type_other == "Línea celular"
    assert reason is None


def test_clean_tipo_empty_is_reported():
    tipo, type_other, reason = clean_tipo(None)
    assert tipo is None
    assert reason == "Tipo vacío"


def test_clean_tipo_unrecognized_falls_back_to_otros_and_reports():
    tipo, type_other, reason = clean_tipo("Suero congelado")
    assert tipo == "otros"
    assert type_other == "Suero congelado"
    assert reason is not None


@pytest.mark.parametrize("raw,expected", [("Si", True), ("SI", True), ("si", True), ("No", False), ("NO", False)])
def test_parse_si_no_variants(raw, expected):
    assert parse_si_no(raw) is expected


@pytest.mark.parametrize("raw", ["-", "", None, "tal vez"])
def test_parse_si_no_unknown(raw):
    assert parse_si_no(raw) is None


@pytest.mark.parametrize("raw,expected", [("3", 3), (4.0, 4), (5, 5)])
def test_parse_pasaje_valid(raw, expected):
    assert parse_pasaje(raw) == expected


@pytest.mark.parametrize("raw", ["-", "N/A", "n/a", None, "mezclado-3"])
def test_parse_pasaje_invalid_is_null(raw):
    assert parse_pasaje(raw) is None


def test_parse_seccion_legacy_numeric():
    assert parse_seccion("1") == ("I", None)


def test_parse_seccion_roman_is_valid():
    assert parse_seccion("III") == ("III", None)


@pytest.mark.parametrize("raw", ["!", "", None, "V"])
def test_parse_seccion_invalid_is_reported(raw):
    codigo, reason = parse_seccion(raw)
    assert codigo is None
    assert reason == "Sección inválida"


def test_parse_rack_letter_valid():
    assert parse_rack_letter("a") == ("A", None)


def test_parse_rack_letter_invalid():
    letter, reason = parse_rack_letter("Z")
    assert letter is None
    assert reason == "Rack inválido"


def test_parse_caja_numero_valid():
    assert parse_caja_numero("5") == (5, None)


def test_parse_caja_numero_invalid_letters():
    numero, reason = parse_caja_numero("F8")
    assert numero is None
    assert reason == "Número de caja inválido"


@pytest.mark.parametrize(
    "raw,expected_position,expected_type",
    [("1A", "1A", "carton_81"), ("9i", "9I", "carton_81"), ("100", "100", "plastic_100"), ("1", "1", "plastic_100")],
)
def test_parse_posicion_valid(raw, expected_position, expected_type):
    position, box_type, reason = parse_posicion(raw)
    assert position == expected_position
    assert box_type == expected_type
    assert reason is None


@pytest.mark.parametrize("raw", ["-", "", None])
def test_parse_posicion_empty_is_reported(raw):
    position, box_type, reason = parse_posicion(raw)
    assert position is None
    assert reason == "Posición vacía"


@pytest.mark.parametrize("raw", ["0", "101", "10J", "abc"])
def test_parse_posicion_out_of_range_is_reported(raw):
    position, box_type, reason = parse_posicion(raw)
    assert position is None
    assert reason == "Posición inválida"


def test_parse_encargado_simple():
    assert parse_encargado("GC") == ("GC", None, None)


def test_parse_encargado_combined_keeps_first_and_reports_original():
    initials, reason, original = parse_encargado("JCI BPG")
    assert initials == "JCI"
    assert reason is not None
    assert original == "JCI BPG"


def test_parse_encargado_empty_is_sin_asignar():
    assert parse_encargado(None) == ("SIN_ASIGNAR", None, None)
    assert parse_encargado("-") == ("SIN_ASIGNAR", None, None)


def test_clean_environ_id_empty_is_reported():
    value, reason = clean_environ_id(None)
    assert value is None
    assert reason == "ID Environ vacío"


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("10-01-2023", date(2023, 1, 10)),
        ("10/01/23", date(2023, 1, 10)),
        ("10.01.23", date(2023, 1, 10)),
    ],
)
def test_parse_fecha_entrada_mixed_formats(raw, expected):
    parsed, reason = parse_fecha_entrada(raw)
    assert parsed == expected
    assert reason is None


def test_parse_fecha_entrada_impossible_year_is_rejected():
    parsed, reason = parse_fecha_entrada("25/07/2184")
    assert parsed is None
    assert reason == "Fecha fuera de rango plausible"


@pytest.mark.parametrize("raw", ["16-21-2021", "30-04-XXXX"])
def test_parse_fecha_entrada_unparseable_is_rejected(raw):
    parsed, reason = parse_fecha_entrada(raw)
    assert parsed is None
    assert reason == "Fecha con formato no reconocido"


def test_parse_fecha_salida_extracts_date_and_initials():
    fecha, iniciales, nota, reason = parse_fecha_salida("21-4-25 VF")
    assert fecha == date(2025, 4, 21)
    assert iniciales == "VF"
    assert nota == "21-4-25 VF"
    assert reason is None


def test_parse_fecha_salida_extracts_date_with_trailing_note():
    fecha, iniciales, nota, reason = parse_fecha_salida("21.02.23 (Cambio de Caja)")
    assert fecha == date(2023, 2, 21)
    assert nota == "21.02.23 (Cambio de Caja)"


@pytest.mark.parametrize("raw", ["revisar ubicación", "no está"])
def test_parse_fecha_salida_note_only_is_reported(raw):
    fecha, iniciales, nota, reason = parse_fecha_salida(raw)
    assert fecha is None
    assert nota == raw
    assert reason is not None


def test_parse_propietario_caja_ignores_embedded_date():
    assert parse_propietario_caja("12-05-25 VF") == "VF"
