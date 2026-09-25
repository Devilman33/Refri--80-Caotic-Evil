# Formulario de movimientos (especificación obligatoria)

La página parte del **mismo formulario** que el laboratorio ya usa en Google Forms
("Registro Núcleo Environ"): mismos campos, mismo orden y mismas opciones, salvo las
desviaciones acordadas con el laboratorio que se listan abajo ("Desviaciones del Google Form"). Cada envío es un **movimiento** (evento) sobre una muestra, no solo un alta:
de ahí sale la trazabilidad.

## Campos (en este orden)

| # | Etiqueta exacta | Tipo | Obligatorio | Opciones / reglas |
|---|---|---|---|---|
| 1 | **Acción** | Opción única | Sí | `Congelamiento`, `Descongelamiento` |
| 2 | **Fecha** | Fecha (DD/MM/AAAA) | Sí | Por defecto, hoy |
| 3 | **ID Environ** | Texto corto | Sí | Ver prefijos en `docs/DATOS.md` |
| 4 | **Descripción** | Texto corto | No | Corresponde a "ID Origen o Descripción" en el Excel |
| 5 | **Tipo** | Opción única | Sí | `Vial de Células`, `RNA`, `RNA later`, `Proteínas`, `Medio Condicionado`, `Reactivo`, `Plasma`, `Otros` |
| 6 | **En caso de haber seleccionado otros, especifique el tipo:** | Texto corto | Solo si Tipo = `Otros` | Se muestra únicamente cuando Tipo = `Otros` |
| 7 | **Operador (a)** | Lista desplegable | Sí | `BPG`, `DB`, `DM`, `EV`, `GC`, `JCI`, `MN`, `MS`, `RL`, `VC`, `JF` |
| 8 | **Pasaje (Si es que existe)** | Texto corto | No | Numérico cuando exista |
| 9 | **Sección** | Opción única | Sí | `I`, `II`, `III`, `IV` |
| 10 | **Nombre Caja (Letra rack y N° de caja)** | Texto corto | Sí | Letra del rack + número de caja, p. ej. `A12` |
| 11 | **Posición en la caja (81 espacios caja cartón)** | Grilla | Una de 11 o 12 | Filas `A`–`I` × columnas `1`–`9` |
| 12 | **Posición en la caja (100 espacios caja plástica)** | Opción única | Una de 11 o 12 | `1`–`100` |
| 13 | **¿Pertenece al Núcleo Environ?** | Opción única | Sí | `Si`, `No` |
| 14 | **Encargado de la muestra** | Lista desplegable | Sí | Usuarios registrados (carga inicial: `BPG`, `DB`, `DM`, `GC`, `JCI`, `MN`, `MS`, `APS`, `VF`, `DRZ`, `VC`, `JF`) |

Instrucciones que el formulario muestra y que la página debe mantener:
- **Caja de cartón:** el orden de los tubos se lee de arriba hacia abajo y de izquierda a derecha.
- **Caja plástica:** el orden de los tubos se lee de izquierda a derecha y de arriba hacia abajo.

## Desviaciones del Google Form (acordadas con el laboratorio, parte 2)

- **Núcleo es una marca, no un encargado.** En el Google Form el campo 14 ("Si la respuesta es
  no, indicar propietario") solo aparecía cuando Núcleo = `No`, porque la muestra de Núcleo
  quedaba a cargo del Núcleo. Ahora toda muestra tiene como encargado a **una persona** y el
  campo 14 se pide siempre. Núcleo = `Si` solo agrega el **warning** visible en todas las vistas.
- **"¿La caja está llena?" ya no se pregunta:** se calcula (llena = todas las posiciones de la
  caja ocupadas) después de cada ingreso, retiro o traslado.
- **Sección se completa sola** a partir de la letra del rack de "Nombre Caja": pedirla aparte
  solo permitía que no coincidieran.
- **Operador** se prellena con el usuario que inició sesión (sigue editable: alguien puede
  registrar por otra persona).
- **Congelar y descongelar son dos formularios distintos** (ver abajo), para no confundirlos.

## Comportamiento en la página

- **Mapeo con `requirements.md`:** Operador = usuario que registra; Encargado = dueño de la muestra
  (campo 14). Si una muestra es de Núcleo, la UI muestra el **warning**.
- **Congelamiento:** crea la muestra (o la vuelve a ingresar) en la posición indicada. Rechaza
  posiciones ocupadas por una muestra activa y ofrece la siguiente libre.
- **Descongelamiento:** equivale a *retirar*. La muestra pasa a estado retirada y queda en el
  historial. **Nunca se borra.** La posición queda libre (luz verde). Tiene **su propio
  formulario**, distinto del de congelamiento:
  - Se editan: Fecha, Operador, la caja (Nombre Caja, con la Sección deducida) y la Posición,
    que se elige sobre la grilla de **posiciones ocupadas**, y el **Motivo del retiro** (se
    guarda en el evento: "retirar = quién, cuándo y motivo").
  - Los demás campos del Google Form (ID Environ, Descripción, Tipo, Pasaje, Núcleo, Encargado)
    se **muestran** con los datos de la muestra elegida, sin editarse: la muestra ya queda
    identificada por su posición, y pedirlos de nuevo solo permitiría que no coincidan.
  - Solo el encargado de la muestra puede retirarla (ver `docs/adr/0002-autenticacion.md`).
- **Campos 11 y 12:** se muestra solo el que corresponde al tipo de la caja elegida (cartón 9×9 o plástica 10×10).
- **Posición desde el visor:** hacer clic en una posición libre del visor abre este formulario prellenado.
- **Autocompletado (QOL):**
  - Recordar el último Operador.
  - Al escribir un ID Environ existente, sugerir Tipo, Descripción, Pasaje, Núcleo, propietario y caja de sus otras muestras.
  - Modo **"guardar y agregar otra del mismo set"**: conserva todo menos la posición y avanza a la siguiente posición libre según el orden de lectura de la caja.
- **Listas desplegables:** las opciones de Operador y propietario vienen de la tabla de usuarios
  (administrable), con los valores de arriba como carga inicial.
