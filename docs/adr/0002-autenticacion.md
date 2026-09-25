# ADR 0002 · Autenticación: diferida, con el riesgo escrito

**Estado:** aceptada · **Fecha:** 2026-09-25 · **Contexto:** issue #8

## Decisión

No se implementa autenticación en este issue. Se documenta el riesgo aceptado, el diseño
elegido para cuando se pida, y el conflicto que hay que resolver **antes** de implementarla.

## Por qué se difiere

El issue #8 lista "autenticación simple por usuario (el operador se toma de la sesión)"
entre siete ideas de calidad de vida, sin modelo de amenaza y sin que ningún otro documento
la pida. Implementarla significa tocar todos los endpoints y todos los tests, e introducir
una superficie de seguridad nueva (almacenamiento de contraseñas, sesiones, expiración).

Eso no es una mejora de comodidad: es un proyecto con su propio issue.

## El conflicto que hay que resolver primero

`docs/FORMULARIO.md` exige que el formulario sea **idéntico** al Google Form del
laboratorio: mismos campos, mismo orden, mismas opciones. El campo 7, "Operador (a)", es una
lista desplegable obligatoria.

"El operador se toma de la sesión" se lee como sacar ese campo. Si se saca, el formulario
deja de ser idéntico y se rompe una regla que hoy es no negociable.

**Lectura propuesta:** la sesión **prellena** el operador, no lo elimina. El campo sigue
visible y editable, porque alguien registra por otro — que es exactamente la razón por la
que el Google Form lo pide en vez de deducirlo.

Si el laboratorio confirma que quiere el campo fuera, hay que cambiar `docs/FORMULARIO.md`
primero: hoy los dos documentos se contradicen y ese conflicto no lo puede resolver quien
implemente.

## El riesgo que se acepta, escrito

**CORS no es autorización.** El hallazgo High del PR #23 se cerró restringiendo orígenes, y
está bien, pero conviene no confundirse con lo que eso protege: CORS solo limita lo que un
**navegador de otro origen** puede hacer. Cualquier host de la red del laboratorio puede:

```bash
curl -X POST http://<host>:8000/movements -d '...'   # registrar un movimiento
curl http://<host>:8000/samples/export               # bajarse el inventario completo
curl http://<host>:8000/imports/1/anomalies          # leer celdas crudas del Excel
```

Tres cosas que este issue agregó o hizo más fáciles y que van nombradas acá a propósito:

1. **`GET /samples/export`** convierte "paginar de a 200" en "un GET se lleva todo". El tope
   de 25.000 filas es el presupuesto de DoS, no una protección de privacidad.
2. **`GET /imports/{id}/anomalies`** publica celdas del Excel tal como venían, y algunas
   traen nombres del personal (`docs/DATOS.md`, "Propietario de Caja": `12-05-25 VF`). Se
   sirven recortadas a 80 caracteres, que reduce la exposición pero no la elimina.
3. **`POST /samples/{id}/movements`** y `PATCH /samples/{id}` permiten mover y editar sin
   credenciales.

Con el despliegue actual —red interna del laboratorio, sin exposición a internet— el riesgo
es aceptable. **Deja de serlo el día que esto se publique fuera de la LAN**, y ese día esta
decisión hay que revisarla antes de exponer nada.

## Diseño elegido para cuando se pida

**Opción A · Autenticación en el reverse proxy (recomendada).**
Basic auth o auth headers en nginx/Caddy delante del backend. No toca una línea de la
aplicación ni de los tests, y el operador se toma del header que el proxy inyecta.
Contra: no distingue permisos por usuario, solo "entra o no entra". Para un laboratorio
donde todos pueden ver todo y el objetivo es que no entre nadie de afuera, alcanza.

**Opción B · Sesión en la aplicación.**
`users.password_hash` (argon2 o bcrypt), login que devuelve una cookie de sesión, y una
dependencia de FastAPI que la valide. Permite permisos por usuario y auditoría real de quién
hizo qué, más allá del campo Operador que hoy se escribe a mano.
Contra: toca todos los endpoints, todos los tests, y agrega el manejo de contraseñas —
recuperación, expiración, rotación— que es donde estas cosas se rompen.

**Recomendación: empezar por A.** Cierra el riesgo real (acceso desde fuera del laboratorio)
sin tocar el dominio. B solo vale la pena si aparece el requisito de permisos diferenciados,
que hoy nadie pidió.

## Qué ya está hecho y no depende de la autenticación

El selector de identidad del encabezado prellena el operador y el filtro "Mis muestras"
desde un solo lugar, usando `localStorage`. No es seguridad —cualquiera puede elegir
cualquier nombre— y no pretende serlo: es la parte de comodidad de la idea, que se puede
tener sin la parte de riesgo.
