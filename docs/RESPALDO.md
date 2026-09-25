# Respaldo y restauración

Hoy el inventario vive en un solo lugar: la base Postgres del contenedor `db`. Si ese
volumen se pierde, se pierde todo, y no hay forma de reconstruirlo desde el Excel porque el
Excel es histórico y no tiene los movimientos registrados desde la web.

Este documento es el procedimiento. Los comandos crudos van primero **a propósito**:
funcionan en cualquier shell, incluido PowerShell, mientras que los scripts de
`scripts/` son `sh` y en Windows necesitan Git Bash.

> **Un dump contiene datos del personal.** Las iniciales y los nombres de la tabla `users`
> van adentro. Tratalo como un archivo con datos de personas: no lo subas al repo (la
> carpeta `backups/` está en `.gitignore`), no lo mandes por chat, y guardalo donde
> guardás el resto de la información del laboratorio.

## Respaldar

### Con el cliente de Postgres instalado

```bash
pg_dump --format=custom --no-owner --no-privileges \
  --file="backups/refri-$(date +%Y%m%d-%H%M%S).dump" \
  "postgresql://refri:refri@localhost:5432/refri"
```

En PowerShell:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
pg_dump --format=custom --no-owner --no-privileges `
  --file="backups/refri-$stamp.dump" `
  "postgresql://refri:refri@localhost:5432/refri"
```

### Sin cliente de Postgres

El contenedor `db` ya lo trae, así que no hace falta instalar nada. Ojo con el `-T`: sin
él, Docker mete secuencias de terminal en el archivo y el dump queda corrupto.

```bash
docker compose exec -T db pg_dump --format=custom --no-owner --no-privileges \
  -U refri refri > "backups/refri-$(date +%Y%m%d-%H%M%S).dump"
```

### Con el script

```bash
./scripts/backup.sh --database-url "postgresql://refri:refri@localhost:5432/refri"
```

Toma `--database-url` o la variable `DATABASE_URL`, y **corta si no hay ninguna**: no
asume una base por defecto, porque respaldar la equivocada es peor que no hacer nada.
Borra el archivo si `pg_dump` falla o si queda vacío, para no dejar un respaldo a medias
que parezca bueno.

> La URL de la app es `postgresql+psycopg://…` (el sufijo es el dialecto de SQLAlchemy).
> Las herramientas de Postgres no lo entienden; los scripts se lo sacan solos, pero si
> escribís el comando a mano usá `postgresql://` sin el `+psycopg`.

## Verificar que el respaldo sirve

Un respaldo que nadie abrió no es un respaldo. Listar su contenido no restaura nada:

```bash
pg_restore --list backups/refri-20260925-021500.dump | head -20
```

Tiene que mostrar las tablas (`samples`, `movements`, `boxes`, `racks`, `sections`,
`users`). Si está vacío o da error, el archivo no sirve.

## Restaurar

**Destructivo: reemplaza lo que haya en la base.** Frená el backend primero, para que no
escriba a mitad de camino:

```bash
docker compose stop backend
```

```bash
./scripts/restore.sh --file backups/refri-20260925-021500.dump --database refri --yes
```

El script pide el nombre de la base **escrito a mano** además de la URL, y corta si los dos
no coinciden. Es la misma guarda que `backend/tests/conftest.py` usa para que los tests no
borren la base de desarrollo: dos fuentes que tienen que decir lo mismo.

Sin script:

```bash
pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction \
  --dbname="postgresql://refri:refri@localhost:5432/refri" \
  backups/refri-20260925-021500.dump
```

`--single-transaction` importa: o entra todo o no entra nada. Una restauración a medias
dejaría el inventario en un estado que nadie sabe leer.

Después:

```bash
docker compose start backend
```

## Automatizarlo

Un respaldo que falla y nadie mira es peor que no tenerlo, así que lo importante es que el
**código de salida distinto de 0 llegue a alguien**. Los scripts salen 0 solo si el archivo
quedó escrito y no vacío.

### Linux/macOS (cron)

```cron
# 02:15 todos los días. MAILTO hace que cron mande el error si el script falla.
MAILTO=alguien@laboratorio.cl
15 2 * * * cd /ruta/al/repo && DATABASE_URL=postgresql://refri:refri@localhost:5432/refri ./scripts/backup.sh >> backups/backup.log 2>&1
```

### Windows (Programador de tareas)

Los scripts son `sh`, así que se ejecutan con el `bash.exe` de Git Bash:

- **Programa:** `C:\Program Files\Git\bin\bash.exe`
- **Argumentos:** `-lc "cd /c/Users/<vos>/Desarrollo/Refri--80-Caotic-Evil && DATABASE_URL=postgresql://refri:refri@localhost:5432/refri ./scripts/backup.sh"`
- **Iniciar en:** la carpeta del repo

En la pestaña **Configuración**, marcá "Ejecutar la tarea lo antes posible después de
omitir un inicio programado": si la máquina estaba apagada a las 2 AM, el respaldo se hace
igual al encenderla.

El Programador **no avisa** cuando una tarea falla: revisá el historial de la tarea de vez
en cuando, o hacé que el comando escriba a un log que alguien mire.

### Rotación

Ni cron ni el Programador borran nada. Sin rotación, `backups/` crece hasta llenar el
disco, y un disco lleno hace fallar el respaldo siguiente. Borrar los de más de 30 días:

```bash
find backups -name "*.dump" -mtime +30 -delete
```

```powershell
Get-ChildItem backups\*.dump | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item
```

Guardá además una copia mensual **fuera de esta máquina**. Un respaldo en el mismo disco que
la base no protege del caso que más importa: que el disco muera.

## Migraciones: volver atrás

El backend corre `alembic upgrade head` en cada arranque, encadenado con `&&` y bajo
`restart: unless-stopped`. Si una migración falla, el contenedor reinicia en loop y en la
web no se ve nada: parece que "no levanta".

Lo primero es mirar el log, que sí dice qué pasó:

```bash
docker compose logs --tail 50 backend
```

| Revisión | Qué introduce | Volver atrás con |
|---|---|---|
| `0001_initial_schema` | esquema completo | `alembic downgrade base` (borra todo) |
| `0002_sample_source_row` | `samples.source_file` y `source_row` | `alembic downgrade 0001_initial_schema` |
| `0003_layout_integrity` | CHECK de sección y letra de rack, unicidad de slot diferible, default de capacidad | `alembic downgrade 0002_sample_source_row` |

Para bajar una revisión sin que el contenedor reinicie en el medio:

```bash
docker compose stop backend
docker compose run --rm --entrypoint sh backend -c "alembic downgrade -1"
```

`0003` puede fallar al aplicarse si la base **ya tiene** una sección fuera de I–IV o una
letra de rack fuera de A–H: el CHECK no se puede crear sobre datos que lo violan. En ese
caso el mensaje dice qué fila es. Se corrige el dato y se vuelve a levantar. Por eso esa
migración conviene aplicarla **antes** de cargar los datos reales.
