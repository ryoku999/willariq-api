# Evidencias con Multer y MinIO — Postman

Esta entrega usa `MulterModule.registerAsync`, `FileInterceptor('file')` y `memoryStorage()`: el archivo se recibe en RAM y se envía al bucket privado. No se crean archivos locales, carpetas temporales ni URLs de carga presignadas. La descarga también pasa por la API con autenticación.

No necesitas paquetes ni migraciones adicionales: se reutilizan `minio`, `multer`, `@types/multer`, `IncidentEvidence` y `EvidenceUploadIntent` existentes. Los intents son registros internos de seguimiento/limpieza; el cliente no los crea ni confirma y no guardan el binario en PostgreSQL.

## 1. Preparación

Reinicia con `pnpm run start:dev`. Al arrancar con MinIO habilitado, la API verifica que el bucket configurado exista y sea accesible. No lo crea ni modifica sus políticas. Usa el bucket privado y la credencial limitada que preparaste.

Variables de API usadas en esta fase:

```dotenv
MINIO_ENABLED=true
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=TU_ACCESS_KEY_DE_APLICACION
MINIO_SECRET_KEY=TU_SECRET_KEY_DE_APLICACION
MINIO_REGION=us-east-1
MINIO_EVIDENCE_BUCKET=incident-evidence
EVIDENCE_MAX_IMAGE_BYTES=5242880
EVIDENCE_MAX_FILES_PER_INCIDENT=5
EVIDENCE_MAX_TOTAL_BYTES_PER_INCIDENT=26214400
UPLOAD_MAX_CONCURRENT_REQUESTS=4
```

El endpoint es solo host, sin `http://`, puerto ni rutas. Dentro de Docker será el hostname accesible de MinIO, no `localhost`. No se utiliza `UPLOAD_TEMP_DIR`, `MINIO_PUBLIC_ENDPOINT`, credenciales raíz ni bucket de conocimiento para estos endpoints. Las variables booleanas convierten explícitamente `true`/`false`; `MINIO_ENABLED=false` deshabilita almacenamiento sin exigir credenciales.

Los límites predeterminados son 5 MiB por archivo, cinco archivos y 25 MiB por incidencia, con cuatro cargas simultáneas por proceso de API. El esquema admite como máximo 20 MiB por imagen, 50 archivos, 1 GiB total y 16 cargas concurrentes; configura valores acordes a la memoria del servidor.

En Postman conserva el entorno de incidencias:

| Variable | Valor |
| --- | --- |
| `baseUrl` | `http://localhost:8000/api`, ajustado a tu entorno |
| `citizenToken` | Access token del ciudadano propietario |
| `incidentId` | UUID de una incidencia propia en RECEIVED |
| `evidenceId` | Se guarda después de adjuntar |
| `incidentVersion` | Se actualiza con las respuestas |

En todas las peticiones usa Authorization → Bearer Token → `{{citizenToken}}`. Si tus reportes anteriores están cancelados, crea uno nuevo siguiendo [incidencias-postman.md](incidencias-postman.md). Ten imágenes JPEG, PNG o WebP pequeñas para comenzar.

## 2. Adjuntar una imagen

```http
POST {{baseUrl}}/incidents/{{incidentId}}/evidence
```

En Body selecciona **form-data**. Agrega una sola fila:

| Key | Tipo de campo | Value |
| --- | --- | --- |
| `file` | File | Selecciona una imagen de tu computadora |

No envíes JSON, `bucket`, `objectKey`, `reporterId`, `clientRequestId`, `expectedVersion` ni otros campos. Deja que Postman genere `Content-Type: multipart/form-data` con su boundary; elimina un `Content-Type: application/json` heredado de otra petición.

Esperado: **201** con el envoltorio `{ success, path, data }`. Ejemplo abreviado de `data`:

```json
{
  "id": "UUID_DE_LA_EVIDENCIA",
  "incidentId": "UUID_DE_LA_INCIDENCIA",
  "type": "IMAGE",
  "status": "AVAILABLE",
  "fileName": "foto.png",
  "mimeType": "image/png",
  "sizeBytes": "12345",
  "checksumAlgorithm": "SHA256",
  "incidentVersion": 2,
  "reused": false
}
```

`sizeBytes` se devuelve como texto decimal porque en BD es BigInt. El objeto se almacena con clave aleatoria dentro de `evidence/api-v1/<incidentId>/`, no con el nombre suministrado por el usuario. La respuesta no expone bucket, clave S3 ni credenciales.

En Scripts → Post-response puedes guardar los valores:

```javascript
pm.test('Evidencia adjuntada', () => pm.response.to.have.status(201));
const evidence = pm.response.json().data;
pm.environment.set('evidenceId', evidence.id);
pm.environment.set('incidentVersion', evidence.incidentVersion);
```

La validación de tipo usa `FileTypeValidator` de Nest con inspección de la firma del contenido, sin confiar en el MIME declarado. La extensión debe corresponder al contenido detectado: `.jpg`/`.jpeg`, `.png` o `.webp`. Es identificación por firma, no decodificación completa/recodificación de la imagen; no se incorpora un procesador de imágenes adicional en esta fase.

Reenviar los mismos bytes a la misma incidencia devuelve la misma evidencia activa con `reused=true`, sin incrementar versión, historial ni cuota. El nombre distinto del archivo no genera otro registro si su contenido es idéntico. Dos cargas simultáneas iguales se resuelven del mismo modo. Si retiras esa evidencia, subirla otra vez crea un registro nuevo, conservando la trazabilidad anterior.

## 3. Listar evidencias

```http
GET {{baseUrl}}/incidents/{{incidentId}}/evidence?page=1&limit=20
```

Esperado: **200**, con `data.items`, `data.pagination` y `data.incidentVersion`. Se listan las evidencias AVAILABLE, en orden de creación. Los archivos retirados no aparecen. `limit` admite hasta 100 y la paginación sigue el contrato de incidencias.

ADMIN/SUPERVISOR también pueden listar según el acceso a la incidencia; OPERATOR requiere el alcance de asignación/membresía vigente ya implementado. Otro ciudadano obtiene **404**. No se generan URLs públicas.

## 4. Ver o descargar el archivo privado

```http
GET {{baseUrl}}/incidents/{{incidentId}}/evidence/{{evidenceId}}/content
```

Esperado: **200**, con los bytes de la imagen y su `Content-Type`, no una respuesta JSON. Postman puede mostrar la imagen o guardarla mediante la opción de descargar/guardar respuesta. Esa descarga en tu computadora es una acción del cliente: la API no escribe el archivo en su disco.

La respuesta usa `Cache-Control: private, no-store`, `nosniff` y un nombre de descarga generado a partir del ID. Necesita autenticación en cada petición; no es una URL pública de MinIO. En el panel futuro se solicitará como Blob con el Axios autenticado existente.

Una evidencia de otra incidencia, retirada, inexistente o fuera de tu alcance devuelve **404**. Si el objeto falta físicamente en MinIO, también devuelve **404**; otros fallos de acceso al almacenamiento devuelven **503**, sin exponer credenciales ni errores crudos del proveedor.

## 5. Retirar una evidencia

```http
DELETE {{baseUrl}}/incidents/{{incidentId}}/evidence/{{evidenceId}}
```

No lleva body. Esperado: **200**:

```json
{
  "success": true,
  "path": "/api/incidents/INCIDENT_ID/evidence/EVIDENCE_ID",
  "data": {
    "id": "UUID_DE_LA_EVIDENCIA",
    "status": "REJECTED",
    "incidentVersion": 3,
    "storageCleanupPending": false
  }
}
```

En el enum actual no existe DELETED; se usa REJECTED para la retirada lógica y se conserva la fila como trazabilidad. Se elimina el objeto de MinIO después de confirmar en BD el estado, historial y auditoría. El archivo deja de ser descargable/listable en cuanto se confirma la retirada.

Si MinIO falla al eliminar, la operación lógica sigue confirmada y responde `storageCleanupPending=true`. Una tarea interna persistida reintenta la eliminación cada minuto, en lotes de hasta 25. También puedes repetir DELETE mientras el reporte siga RECEIVED; no duplica historial ni vuelve a incrementar la versión. No hace falta borrar nada manualmente en BD o en el servidor.

Solo el ciudadano propietario puede agregar/retirar, y solo en RECEIVED. ADMIN/SUPERVISOR pueden consultar, pero no adjuntar ni retirar evidencias ciudadanas por estas rutas. Una futura evidencia de resolución tendrá su contrato y permisos específicos.

## 6. Pruebas negativas y coherencia con incidencias

| Prueba | Esperado |
| --- | --- |
| Sin token válido | 401 (elimina también cookies del dominio si estás probando sin sesión) |
| Ciudadano ajeno | 404 |
| ADMIN/OPERATOR intenta subir o retirar | 403 |
| Reporte propio cancelado o en otro estado | 409 en carga/retirada |
| No enviar archivo, campo distinto de `file`, varios archivos o campos adicionales | 400 |
| Texto/ejecutable/SVG renombrado como imagen | 400 |
| PNG con extensión `.jpg` | 400 |
| Archivo mayor que el límite configurado | 413 |
| Superar cantidad o bytes totales de la incidencia | 409 |
| Límite de peticiones por IP | 429 |
| Todas las plazas de carga del proceso ocupadas | 503, reintentar después |
| MinIO deshabilitado/no disponible durante operación | 503 |

Las peticiones de carga tienen límite de 10 por minuto por IP; espera la ventana si haces muchas pruebas inválidas seguidas. Solo JPEG/PNG/WebP están habilitados, aunque el enum permita otros tipos.

Cada alta/retirada real incrementa `Incident.version` y añade historial y auditoría dentro de la misma transacción. Un duplicado activo no incrementa nada. Antes de cancelar, usa `data.incidentVersion` de la última operación o consulta `GET /incidents/:id`: cancelar con la versión anterior al upload devuelve **409**. Si la incidencia se cancela mientras MinIO recibe una imagen, la finalización de esa carga devuelve 409 y su objeto se limpia.

La cuota incluye AVAILABLE y QUARANTINED; una retirada libera cuota. La comprobación final se serializa por incidencia, así que dos uploads simultáneos no pueden exceder el límite. No se mantiene una transacción SQL abierta durante la transferencia a MinIO.

Los intents PENDING abandonados expiran tras una hora; la tarea periódica los reclama y limpia. Solo procesa la ruta reservada de esta implementación, sin listar/eliminar indiscriminadamente objetos del bucket ni tocar los uploads antiguos de otra estrategia.

## 7. Verificación y continuación

Se verificaron build, lint y 17 escenarios de integración con HTTP, JWT, PostgreSQL y MinIO reales: carga, descarga, permisos, duplicados, cuotas, concurrencia, cancelación durante upload, rollback por auditoría, limpieza pendiente y recuperación. Se usa un esquema PostgreSQL descartable y objetos pertenecientes exclusivamente a esos reportes de prueba; se eliminan al terminar.

Para repetir las pruebas, con servicios activos y permisos para crear un esquema temporal, desde PowerShell:

```powershell
pnpm run build
$env:RUN_EVIDENCE_INTEGRATION_TESTS='1'
node --test test/evidence.integration.test.cjs
Remove-Item Env:RUN_EVIDENCE_INTEGRATION_TESTS
```

El test reduce límites solo dentro de su aplicación de prueba y evita el throttler por IP para comprobar concurrencia de negocio. No modifica tu `.env`, políticas del bucket ni tablas de negocio de la aplicación.

Después de tu validación manual sigue la configuración administrativa de prompts/versiones y rutas IA. Esa etapa primero crea el CRUD; después se incorporan proveedores y BullMQ. No necesitas aún instalar SDK de IA ni Redis para terminar las pruebas de evidencias.
