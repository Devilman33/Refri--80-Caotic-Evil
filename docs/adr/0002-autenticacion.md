# ADR 0002 · Autenticación: identificación sin contraseña y permisos por encargado

**Estado:** aceptada (revisada en la parte 2) · **Fecha:** 2026-09-25 · **Contexto:** issue #8,
`requirements_parte2.md`

## Historia

La primera versión de este ADR (issue #8) difería la autenticación: nadie había pedido
permisos por usuario, y la recomendación era, si hacía falta, empezar por basic auth en el
reverse proxy. La parte 2 de los requisitos sí los pide:

> Que un usuario no pueda hacer update y delete de muestras que no son de él (al inicio de
> la página setear un "Login" para que un user se identifique quién es).

Con ese pedido, la opción del proxy deja de alcanzar (no distingue personas) y se pasa a una
variante liviana de la opción B de la versión anterior.

## Decisión

**Identificación, no autenticación.** Al entrar a la página cada persona elige quién es de la
lista de usuarios registrados (o se registra con su nombre completo). No hay contraseña: el
laboratorio lo confirmó ("con el nombre está bien").

- El frontend guarda el usuario elegido en `localStorage` y lo manda en cada request como
  header `X-User-Id`.
- El backend exige ese header (`CurrentUser` en `app/api/deps.py`) en las escrituras sobre
  muestras y en la administración del freezer: `POST /movements` (y `/movements/thaw-batch`),
  `PATCH /samples/{id}`, `POST /samples/{id}/movements`, `POST /samples/{id}/return`,
  `POST /boxes/{id}/move|deactivate` y `POST /racks/{id}/move|deactivate|activate`. Sin él, o
  con un usuario desactivado, responde 401.
- **Solo sus encargados** (una muestra puede tener varios; cualquiera de ellos) pueden editarla
  o trasladarla (`app/services/permissions.py`, 403 en otro caso). Las muestras sin encargado
  (`SIN_ASIG`, centinela del importador) las puede tocar cualquiera, para poder asignarles uno.
- **Retirar** (una o varias) y **devolver** una muestra retirada lo puede hacer cualquier
  persona identificada (parte 3: quien está frente al freezer saca lo que le piden).
- **Congelar** lo puede hacer cualquier persona identificada, para sí o para otro encargado.
- **Trasladar una subcaja o un rack entero**, y **dar de baja** cajas o racks vacíos, lo
  puede hacer cualquier persona identificada: tienen muestras de varios encargados y
  reordenar el freezer es una tarea del laboratorio.
- El **Operador** del formulario se prellena con la persona de la sesión y sigue editable
  (alguien puede registrar por otro, que es la razón por la que el Google Form lo pedía).
- Núcleo **no** restringe quién manipula una muestra: es solo una marca con su warning.

## El riesgo que se acepta, escrito

Esto evita errores, no ataques. Cualquiera puede elegir el nombre de otra persona en la
lista, y cualquier host de la red puede mandar el header que quiera:

```bash
curl -X PATCH -H 'X-User-Id: 3' http://<host>:8000/samples/42 -d '...'
```

Además siguen abiertos, sin sesión, los endpoints de administración (secciones, racks,
cajas, usuarios, `POST /samples`) y las lecturas (`GET /samples/export` se lleva el
inventario completo; `GET /imports/{id}/anomalies` publica celdas crudas del Excel).

Con el despliegue actual —red interna del laboratorio, sin exposición a internet— el riesgo
es aceptable. **Deja de serlo el día que esto se publique fuera de la LAN.** Ese día hay que:

1. Poner autenticación de verdad delante (basic auth u OAuth en el reverse proxy), y
2. Reemplazar el header `X-User-Id` por una sesión firmada (cookie) que emita el backend
   después de autenticar, para que el usuario no lo elija el cliente.

El cambio 2 no toca los endpoints: solo `get_current_user` en `app/api/deps.py`.
