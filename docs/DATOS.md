# Datos de origen y reglas de importación

El archivo `Data/Inventario Freezer -80 Environ (Nucleo).xlsx` **no se versiona** (está en
`.gitignore`) porque contiene datos del laboratorio. La carga la hace una persona ejecutando el
importador en local. Los tests usan un Excel **sintético** con la misma estructura
(`backend/tests/fixtures/`), generado por código.

## Hojas

| Hoja | Uso |
|---|---|
| `Inventario-80` | **Inventario actual del freezer (~7.600 filas, una fila = un tubo).** Es la que se importa. Encabezados en la **fila 2**; la fila 1 tiene los nombres técnicos (`tbl_44_Tipo`, …) |
| `Inventario-80 Glosa` | Diccionario de valores válidos de la hoja anterior |
| `Nucleo (2)`, `Nucleo Glosa`, `Cultivo` | Metadatos clínicos y de cultivo por ID Environ (institución, diagnóstico, caracterización, pasajes). **Fuera del alcance inicial**; el modelo debe permitir agregarlos después |

## Columnas de `Inventario-80`

| Columna | Destino | Reglas de limpieza observadas |
|---|---|---|
| ID Environ | `sample.environ_id` | ~6 % vacío: importar con marca "sin ID" y reportar. Un mismo ID tiene muchos tubos (hasta cientos) |
| ID Origen o Descripción | `sample.description` | Texto libre; `-` = vacío |
| Caja origen | `box.label` (nombre histórico) | Texto libre; informativo |
| Tipo | `sample.type` | Normalizar variantes: `Medio condicionado`/`Medio Condicionado`/`MC` → Medio Condicionado; `RNA later`/`RNA-later`/`RNA Later` → RNA later; `Vial` → Vial de Células; `Linea celular`/`Lineas celulares` → Línea celular. Recortar espacios |
| Encargado | `sample.owner` (usuario) | Iniciales (GC, DB, VC, APS, MN, MS, DM, VF, JCI, …). Hay combinados como `JCI BPG` o `AA RZ`: tomar el primero como encargado y guardar el valor original. Vacío (~20 %) → "Sin asignar" |
| Pasaje | `sample.passage` (entero o nulo) | Números mezclados con `-` y `N/A` → nulo |
| Nucleo | `sample.is_core` | `Si`/`SI`/`si` → true; `No`/`NO` → false; `-` o vacío → desconocido (reportar) |
| Seccion | `section` | `I`–`IV`; `1` → `I`; `!` o vacío → ubicación inválida (reportar) |
| Rack | `rack` | Letras `A`–`H` |
| Caja | `box.number` | Entero 1–30; valores como `F8` → reportar |
| Posición | `position` | Cartón 9×9: `1A`…`9I` (número + letra; la glosa también usa `1a`). Plástica 10×10: `1`…`100`. `-` o vacío → reportar |
| Fecha de entrada | evento de ingreso | **Formatos mezclados**: fechas de Excel, `dd-mm-yyyy`, `dd/mm/yy`, `dd.mm.yy`. Hay valores imposibles (`25/07/2184`, años 1905 por números seriales mal tipeados, `16-21-2021`, `30-04-XXXX`) → nulo + reporte |
| Caja Completa Si/No | `box.is_full` (informativo) | Normalizar Si/No |
| Propietario de Caja | `box.owner` | Iniciales; puede traer fecha pegada (`12-05-25 VF`) |
| Fecha de salida | **si tiene valor, la muestra está retirada** | Mezcla fechas y notas (`revisar ubicación`, `no está`, `21-4-25 VF`, `21.02.23 (Cambio de Caja)`): extraer fecha e iniciales si existen y guardar el texto como nota del evento de retiro |
| Comentarios | `sample.notes` | Texto libre |

**Posiciones repetidas:** ~100 posiciones aparecen en más de una fila. Normalmente se explica
por muestras retiradas que dejaron el lugar a otra. Regla: solo puede haber **una muestra activa
por posición**. Los conflictos entre activas se importan como retirada-por-conflicto y se reportan.

## Prefijos de ID Environ (glosa)

`BP` Biopsia prostática · `BPF` Biopsia prostática por fusión · `PR` Prostatectomía radical ·
`PH` Prostatectomía HoLEP · `Co` Colon · `Br` Mama · `Pa` Páncreas · `Lu` Pulmón ·
`HN` Cabeza y cuello · `Li` Hígado · `BL` Sangre · `PL` Plasma · `SE` Suero.
También hay líneas celulares (p. ej. `PC3`) y prefijos como `MC Co1241` (medio condicionado).

## Importador

- Comando: `python -m app.importer <ruta.xlsx> [--dry-run]`. Debe ser **idempotente**: reimportar no duplica.
- Al terminar genera un **reporte de anomalías** (CSV) con fila, columna, valor original y
  motivo, para que el laboratorio lo corrija. Nunca debe abortar por una fila mala.
- Crea automáticamente usuarios (por iniciales), secciones, racks y cajas que encuentre.
  El tipo de caja (cartón 81 / plástica 100) se infiere del formato de las posiciones.

## Modelo físico: visor vs. datos reales

`demo.html` modela 4 estantes × 3 racks × 5 pisos × 4 cajas (240 cajas de 9×9). Los datos reales
tienen racks con letras `A`–`H` repartidos en las secciones `I`–`IV`, hasta 30 cajas por rack y
cajas plásticas de 100 posiciones. Por eso **la geometría del visor se genera a partir de la base de
datos** (secciones, racks, cajas y su tipo) y no está fija en el código. Se mantienen la estética y
las interacciones del demo.

Pendiente de definir con el laboratorio: qué es exactamente una **"subcaja"** en `requirements.md`.
Mientras tanto, el % de uso se calcula por **sección, rack y caja**. Si "subcaja" resulta ser otro
nivel, se agrega sin romper el resto.
