# Incidencias — pruebas de la primera fase

> Actualización de etapa 6: revisión, asignaciones, cancelación administrativa ampliada y evidencias del responsable durante IN_PROGRESS están descritas en [revisión y asignaciones](revision-asignaciones-postman.md). Los límites de la entrega original indicados abajo se conservan como contexto histórico.


Implementado: creación, listado, detalle, historial y cancelación inicial. Se utilizan las tablas existentes; no necesitas paquetes nuevos ni ejecutar migraciones para esta entrega. Coordenadas normales, sin PostGIS. MinIO, upload, envío a IA, revisión y asignaciones se incorporarán en fases posteriores.

## 1. Preparación

Reinicia la API para cargar el código y las variables:

```bash
pnpm run start:dev
```

En `.env` deben estar `INCIDENT_TRACKING_PREFIX=WIL` y `INCIDENT_TRACKING_TIME_ZONE=America/Lima`. El prefijo admite de 1 a 10 caracteres A–Z o dígitos; la zona debe ser válida. No compartas tu archivo de secretos.

En Postman crea un entorno local con estas variables:

| Variable | Valor |
| --- | --- |
| `baseUrl` | `http://localhost:8000/api` (ajusta puerto/prefijo reales) |
| `citizenToken` | Access token de un ciudadano |
| `otherCitizenToken` | Token de otro ciudadano para acceso cruzado |
| `adminToken` | Token de ADMIN para consultar toda la bandeja |
| `incidentId` | Se guardará al crear |
| `incidentVersion` | Se guardará al crear y actualizar |
| `trackingCode` | Se guardará al crear |
| `clientRequestId` | `postman-incidencia-001` para la primera prueba |

Puedes registrar ciudadanos con el endpoint existente `POST {{baseUrl}}/auth/register`, usando DNI/teléfono que no estén registrados:

```json
{
  "firstName": "Ciudadano",
  "lastName": "Prueba",
  "dni": "87654321",
  "phone": "987654321",
  "password": "PruebaLocal2026!"
}
```

No pases `role` al registro público: crea CITIZEN. Para ADMIN usa una cuenta administrativa existente.

Inicia sesión con `POST {{baseUrl}}/auth/mobile/login`, Body → raw → JSON:

```json
{
  "dni": "87654321",
  "password": "PruebaLocal2026!"
}
```

En Scripts → Post-response del login ciudadano:

```javascript
pm.test('Login correcto', () => pm.response.to.have.status(200));
pm.environment.set('citizenToken', pm.response.json().data.tokens.accessToken);
```

Para las cinco peticiones de incidencias, Authorization → Bearer Token → `{{citizenToken}}`. Body JSON lleva `Content-Type: application/json`. Si el token expira, vuelve a iniciar sesión o usa el refresh móvil ya existente. Para comprobar 401, elimina también las cookies web del dominio si anteriormente iniciaste sesión en el panel.

## 2. Crear — POST /incidents

`POST {{baseUrl}}/incidents`, con token CITIZEN:

```json
{
  "clientRequestId": "{{clientRequestId}}",
  "originalMessage": "Hay basura acumulada frente al mercado municipal",
  "latitude": -12.0464,
  "longitude": -77.0428,
  "address": "Mercado municipal",
  "addressReference": "Junto a la entrada principal"
}
```

Esperado: **201**, `data.status=RECEIVED`, `data.version=1`, código como `WIL-2026-000001` y coordenadas numéricas. El código usa el año de la zona configurada. `address` y `addressReference` son opcionales y admiten null; las cadenas vacías de dirección se normalizan a null. El cuerpo no recibe `reporterId`, `source`, `status`, clasificación ni rol: el servidor determina el propietario y fija `source=MOBILE_APP` para este contrato ciudadano.

Límites: `clientRequestId` 100 caracteres; mensaje 5000; dirección 300; referencia 1000. Mensaje y clave no pueden estar vacíos. Latitud entre -90 y 90; longitud entre -180 y 180, ambas como números JSON con hasta siete decimales.

En Scripts → Post-response:

```javascript
pm.test('Incidencia creada', () => pm.response.to.have.status(201));
const incident = pm.response.json().data;
pm.environment.set('incidentId', incident.id);
pm.environment.set('incidentVersion', incident.version);
pm.environment.set('trackingCode', incident.trackingCode);
```

Idempotencia:

- Reenvía exactamente la misma petición con la misma clave: devuelve **201 y el mismo ID**, sin consumir otro correlativo ni duplicar historial/auditoría. Se conserva el estado actual, incluso si ya fue cancelada.
- Cambia mensaje, coordenadas o dirección conservando la clave: **409**.
- Para un reporte nuevo cambia `clientRequestId`, por ejemplo `postman-incidencia-002`.
- La clave se limita a su reportante: dos ciudadanos pueden usar la misma clave para sus reportes independientes.
- Crear con token ADMIN, SUPERVISOR u OPERATOR: **403**.

## 3. Listar — GET /incidents

`GET {{baseUrl}}/incidents?page=1&limit=20`

Esperado: **200** con este formato dentro del envoltorio existente:

```json
{
  "success": true,
  "path": "/api/incidents?page=1&limit=20",
  "data": {
    "items": [],
    "pagination": { "page": 1, "limit": 20, "total": 0, "pages": 0 }
  }
}
```

Si creaste reportes, `items` tendrá esos registros. El listado muestra datos de bandeja; usa el detalle para leer el mensaje completo. Orden: más recientes primero, desempate por ID. `page` inicia en 1, máximo 100000; `limit` predeterminado 20, máximo 100.

Filtros opcionales:

| Parámetro | Ejemplo / significado |
| --- | --- |
| `status` | `RECEIVED` o `CANCELLED` para los estados alcanzables en esta fase |
| `trackingCode` | Código completo o fragmento, sin distinguir mayúsculas |
| `createdFrom` | `2026-10-01T00:00:00-05:00`, límite inclusivo |
| `createdTo` | `2026-10-31T23:59:59.999-05:00`, límite inclusivo |
| `type` | Por ejemplo `ENVIRONMENT` |
| `category` | Por ejemplo `GARBAGE_ACCUMULATION` |
| `urgency` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `areaId` / `operatorId` | UUID de asignación; útil al implementar esa fase |

Usa la pestaña Params de Postman para que codifique correctamente los valores. Las clasificaciones empiezan en null y todavía no se pueden asignar por estos endpoints, por lo que filtrar por categoría/tipo/urgencia puede devolver vacío. Área y operador también devolverán vacío mientras no existan asignaciones.

Prueba `GET {{baseUrl}}/incidents?status=RECEIVED&trackingCode={{trackingCode}}`. Debe incluir el reporte si aún no fue cancelado.

Permisos: CITIZEN solo sus reportes; ADMIN y SUPERVISOR tienen bandeja global. OPERATOR solo ve su asignación vigente no cancelada o el alcance de un área donde sea MANAGER; además requiere membresía y área activas. No obtiene acceso por una asignación ya reemplazada. Una asignación completada conserva consulta mientras siga autorizado. Por ahora un operador sin asignaciones verá `items: []`.

Compara resultados con los tokens de dos ciudadanos y ADMIN. `page=0`, `limit=101`, estado desconocido, UUID inválido, fecha inválida o rango invertido → **400**. No existe un filtro `reporterId` que permita al ciudadano consultar reportes ajenos.

## 4. Detalle — GET /incidents/:id

`GET {{baseUrl}}/incidents/{{incidentId}}`

Esperado: **200** con mensaje original, ubicación, clasificación aún vacía, estado, versión, fechas y nombre básico del reportante. No devuelve hash de contraseña, DNI, teléfono, fingerprint de idempotencia ni referencias internas de MinIO.

Usa este endpoint para obtener la versión antes de una mutación:

```javascript
pm.test('Detalle disponible', () => pm.response.to.have.status(200));
pm.environment.set('incidentVersion', pm.response.json().data.version);
```

Con otro ciudadano → **404**. Con un UUID inexistente → **404**. Con un ID que no sea UUID → **400**. Se usa 404 para recursos ajenos y así no confirmar su existencia. ADMIN/SUPERVISOR pueden consultar; OPERATOR depende del alcance explicado arriba.

## 5. Historial — GET /incidents/:id/history

`GET {{baseUrl}}/incidents/{{incidentId}}/history?page=1&limit=20`

Esperado: **200**, `data.items` y `data.pagination`. Orden cronológico ascendente. Después de crear, hay una entrada con `previousStatus=null`, `newStatus=RECEIVED`, `actorType=USER` y comentario de registro.

Después de cancelar debe aparecer otra entrada `RECEIVED → CANCELLED` con tu motivo. No se exponen los metadatos internos de la bitácora ni payloads crudos de proveedores.

Mismos permisos que el detalle: token de otro ciudadano → **404**; paginación inválida → **400**. Este endpoint no permite editar/eliminar historial.

## 6. Cancelar — POST /incidents/:id/cancel

Ejecuta esta prueba después de las consultas iniciales:

`POST {{baseUrl}}/incidents/{{incidentId}}/cancel`

```json
{
  "expectedVersion": {{incidentVersion}},
  "reason": "Registré el reporte por error y necesito cancelarlo"
}
```

`expectedVersion` es número JSON: no pongas comillas alrededor de la variable. `reason` es obligatorio, no vacío y de hasta 1000 caracteres.

Esperado: **200**, `data.status=CANCELLED`, versión incrementada (1 → 2), `cancelledAt` informado y una nueva entrada de historial/auditoría. Guarda la versión devuelta si la necesitas:

```javascript
pm.test('Cancelación correcta', () => pm.response.to.have.status(200));
pm.environment.set('incidentVersion', pm.response.json().data.version);
```

En esta entrega solo se permite cancelar **RECEIVED**, por el ciudadano propietario o ADMIN/SUPERVISOR. OPERATOR no cancela. Las cancelaciones desde otros estados del plan se implementarán junto al flujo operativo correspondiente.

Pruebas negativas:

- `expectedVersion=999` → **409**, sin cambios.
- Volver a cancelar el mismo reporte, incluso con versión actual → **409**.
- Motivo vacío, versión ausente, versión cero o `"1"` como texto → **400**.
- Otro ciudadano → **404**; OPERATOR → **403**.
- Dos cancelaciones simultáneas con la misma versión → una **200** y otra **409**; un único cambio e historial.

No se elimina el reporte físicamente ni se permite cambiar arbitrariamente su estado con PATCH.

## 7. Límites y siguiente fase

Crear incidencias tiene límite específico de **10 peticiones por minuto por IP**, además del límite global configurado. Las peticiones de creación inválidas y los reenvíos también consumen ese límite. Si obtienes 429 durante pruebas, espera la ventana correspondiente. El test de integración evita este límite únicamente dentro de su aplicación aislada para comprobar concurrencia de negocio.

Verificaciones de esta entrega: build, lint de archivos modificados y pruebas HTTP con JWT real sobre PostgreSQL en un esquema descartable. Se prueban permisos, validación, idempotencia concurrente, correlativos, cancelación concurrente y rollback por fallo de auditoría. Para repetirlas después de compilar, en PowerShell:

```powershell
pnpm run build
$env:RUN_INCIDENT_DB_TESTS='1'
node --test test/incidents.integration.test.cjs
Remove-Item Env:RUN_INCIDENT_DB_TESTS
```

El test requiere las variables habituales y permiso para crear un esquema temporal en la BD configurada. Usa únicamente ese esquema para fixtures y lo elimina al terminar; requiere que `vector` ya esté disponible, igual que el esquema existente. No modifica datos de las tablas de la aplicación. Tras una interrupción forzada, cualquier limpieza manual debe dirigirse exclusivamente al nombre temporal exacto mostrado por PostgreSQL, nunca a `public` ni a patrones de esquemas.

Después de validar estos cinco endpoints, la siguiente fase de backend es Storage + evidencias con Multer/MinIO. Prepara MinIO, bucket privado y credencial limitada; `minio` y `multer` ya aparecen en tu package.json actual. Antes de esa entrega revisaremos lo instalado y si falta `@types/multer`. No necesitas todavía Cerebras, Groq, OpenRouter ni Redis para cargar imágenes. La bandeja/detalle del panel se podrá conectar a estos GET sin cambiar los contratos de autenticación existentes.
