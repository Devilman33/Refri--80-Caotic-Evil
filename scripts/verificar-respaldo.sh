#!/bin/sh
# Ejercita el ciclo completo de respaldo y restauración contra una base descartable.
#
#   DATABASE_URL=postgresql://refri:refri@localhost:5432/refri_backup_check \
#     ./scripts/verificar-respaldo.sh
#
# Es lo que corre la CI. Existe porque un script de restauración que nunca se ejecutó no es
# un procedimiento de recuperación, es un archivo: la única forma de saber que sirve es
# borrar un dato a propósito y comprobar que vuelve.
#
# NO apuntes esto a la base real: borra filas para probar que la restauración las trae.

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$SCRIPT_DIR/_common.sh"

URL="$(resolve_database_url "${1:-}")"
PG_URL="$(libpq_url "$URL")"
DB_NAME="$(database_name_from_url "$PG_URL")"

case "$DB_NAME" in
    *test*|*check*|*scratch*) ;;
    *)
        echo "Negado: '$DB_NAME' no parece una base descartable." >&2
        echo "  Este script BORRA filas para probar la restauración. Usá una base cuyo" >&2
        echo "  nombre contenga 'test', 'check' o 'scratch'." >&2
        exit 2
        ;;
esac

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

echo "1/5 · preparando el canario en '$DB_NAME'…"
psql "$PG_URL" -v ON_ERROR_STOP=1 -q -c "DROP TABLE IF EXISTS canario;"
psql "$PG_URL" -v ON_ERROR_STOP=1 -q -c "CREATE TABLE canario (id int primary key, nota text);"
psql "$PG_URL" -v ON_ERROR_STOP=1 -q -c "INSERT INTO canario VALUES (1, 'sobrevivi');"

echo "2/5 · respaldando…"
"$SCRIPT_DIR/backup.sh" --database-url "$URL" --out "$OUT" >/dev/null
DUMP="$(ls -1t "$OUT"/*.dump | head -1)"
test -s "$DUMP"

echo "3/5 · borrando el dato a propósito…"
psql "$PG_URL" -v ON_ERROR_STOP=1 -q -c "DELETE FROM canario;"

echo "4/5 · comprobando que el restore se niega sin confirmación…"
if "$SCRIPT_DIR/restore.sh" --database-url "$URL" --file "$DUMP" --database "$DB_NAME" >/dev/null 2>&1; then
    echo "FALLO: el restore corrió sin --yes." >&2
    exit 1
fi
if "$SCRIPT_DIR/restore.sh" --database-url "$URL" --file "$DUMP" --database no_es_esta --yes >/dev/null 2>&1; then
    echo "FALLO: el restore aceptó un nombre de base que no coincide." >&2
    exit 1
fi

echo "5/5 · restaurando…"
"$SCRIPT_DIR/restore.sh" --database-url "$URL" --file "$DUMP" --database "$DB_NAME" --yes >/dev/null

NOTA="$(psql "$PG_URL" -tAc "SELECT nota FROM canario WHERE id = 1;")"
if [ "$NOTA" != "sobrevivi" ]; then
    echo "FALLO: el dato no volvió (se leyó '$NOTA')." >&2
    exit 1
fi

echo "OK: el respaldo restaura, y las dos guardas del restore funcionan."
