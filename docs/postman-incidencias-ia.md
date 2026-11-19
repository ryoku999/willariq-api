# Clasificación de incidencias: BullMQ, Redis y proveedores IA

## Alcance de esta entrega

API de envío, historial de trabajos, diagnóstico y reintentos. Worker y dispatcher conviven con Nest; no hay un servidor adicional que iniciar. Se reutilizan `AiJob`, `AiAttempt`, `QueueOutbox`, los prompts versionados, rutas y permisos existentes. No se requieren paquetes ni migraciones nuevas en esta fase.

La clasificación es una **propuesta para revisión humana**. Nunca acepta, rechaza, asigna ni resuelve incidencias. En esta versión se envían al proveedor el mensaje y las referencias textuales de dirección: no se envían fotos, URLs de MinIO, DNI, teléfono, identidad del reportante ni coordenadas. Las evidencias permanecen privadas y siguen cargándose en memoria, sin carpetas temporales.

## 1. Preparar y arrancar

Confirma estas variables privadas del backend (ejemplo sin credenciales reales):

```dotenv
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=REEMPLAZAR
REDIS_DB=0
BULLMQ_PREFIX=willariq-dev
AI_ENABLED=true
AI_WORKER_ENABLED=true
AI_WORKER_CONCURRENCY=2
AI_JOB_MAX_ROUNDS=2
AI_JOB_LEASE_SECONDS=120
AI_JOB_HEARTBEAT_SECONDS=30
AI_JOB_MAX_TOTAL_MS=180000
OUTBOX_POLL_INTERVAL_MS=2000
OUTBOX_BATCH_SIZE=25
OUTBOX_MAX_ATTEMPTS=10
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
CEREBRAS_API_KEY=REEMPLAZAR_SI_USAS_ESTE_PROVEEDOR
# GROQ_API_KEY y OPENROUTER_API_KEY solo si habilitas sus rutas.
```

`AI_ENABLED` y `AI_WORKER_ENABLED` tienen valor predeterminado `false`: actívalas explícitamente para esta prueba. El heartbeat debe ser menor que la mitad del lease. No uses el mismo prefijo entre pruebas, desarrollo y producción. En Docker, `REDIS_HOST` es el hostname accesible desde el contenedor de la API, no su propio `localhost`.

`OPENROUTER_BASE_URL` se restringe al endpoint HTTPS oficial para impedir que una configuración errónea envíe credenciales a otro host. Los modelos se eligen en las rutas de BD, no en código ni en variables nuevas. Escoge un modelo de chat de tu cuenta compatible con `response_format: { "type": "json_object" }`; la compatibilidad genérica con chat no garantiza que todos los modelos acepten JSON mode. No se instala ningún SDK.

En infraestructura se añadió `--maxmemory-policy noeviction` al Compose de Redis. Para aplicarlo, desde `willariq-infrastructure/redis`:

```powershell
docker compose up -d redis
```

Esto puede recrear el contenedor: hazlo en tu entorno de desarrollo, conserva el volumen y **no uses `down -v`**. El asistente no reinició tu Redis. Comprueba posteriormente `CONFIG GET maxmemory-policy` con tu autenticación habitual.

Inicia o reinicia la API:

```powershell
pnpm start:dev
```

Ya deben estar aplicadas las migraciones de etapas anteriores, incluido el índice de prompt activo. Esta entrega no modifica el esquema Prisma ni aplica migraciones a tu base de negocio.

## 2. Variables de Postman

Usa un environment privado con:

```text
baseUrl = http://localhost:8000/api
citizenToken = JWT del ciudadano
adminToken = JWT ADMIN
supervisorToken = JWT SUPERVISOR (opcional)
incidentId = UUID de una incidencia del ciudadano
jobId = UUID devuelto por submit
outboxId = UUID de una entrada de outbox
incidentVersion = versión actual de la incidencia
```

Ajusta puerto y prefijo a tu configuración. Autenticación: **Authorization → Bearer Token**. Para JSON: **Body → raw → JSON**. La respuesta exitosa conserva `{ success, path, data }`.

## 3. Flujo completo exitoso

### Crear el reporte y cargar evidencias

`POST {{baseUrl}}/incidents`, token ciudadano:

```json
{
  "clientRequestId": "postman-ia-prueba-001",
  "originalMessage": "Hay basura acumulada frente al mercado municipal desde ayer.",
  "latitude": -12.0464,
  "longitude": -77.0428,
  "address": "Frente al mercado municipal"
}
```

Cambia `clientRequestId` para un reporte distinto. Guarda `data.id` y `data.version`. Opcionalmente carga las evidencias con los endpoints ya probados **antes** del envío. Después de cada evidencia vuelve a consultar `GET /incidents/:id`: su versión cambia. Espera a que todas las cargas finalicen.

### Comprobar configuración sin gastar tokens

`POST {{baseUrl}}/admin/ai/config/check`, token ADMIN:

```json
{ "capability": "INCIDENT_CLASSIFICATION" }
```

Debe indicar `configurationReady: true` y `executionImplemented: true`. No comprueba saldo, modelo ni disponibilidad real del proveedor. Necesitas exactamente un prompt activo y al menos una ruta habilitada cuya credencial esté configurada.

### Enviar a clasificación

`POST {{baseUrl}}/incidents/{{incidentId}}/submit`, token del ciudadano propietario:

```json
{ "expectedVersion": 1 }
```

Reemplaza `1` por la versión actual. Respuesta **202**:

```json
{
  "success": true,
  "path": "/api/incidents/UUID/submit",
  "data": {
    "incidentId": "UUID",
    "trackingCode": "TU-CODIGO",
    "status": "AI_ANALYSIS",
    "version": 2,
    "jobId": "UUID-TRABAJO",
    "analysisMode": "AI"
  }
}
```

Guarda `jobId`. El 202 confirma persistencia en PostgreSQL, **no** que el proveedor haya terminado. No mantengas Postman esperando una llamada IA síncrona. Tras el envío ya no puedes agregar/eliminar evidencias ni cancelar por el endpoint actual, que admite únicamente `RECEIVED`.

### Consultar seguimiento

`GET {{baseUrl}}/incidents/{{incidentId}}/ai-jobs?page=1&limit=20`, token propietario o personal con acceso al caso. Respuesta **200**, listado resumido y paginado, más reciente primero.

Estados normales: `PENDING` → `QUEUED` → `PROCESSING` → `COMPLETED`. Pueden avanzar tan rápido que no alcances a observar todos. `FAILED` indica agotamiento de análisis; `CANCELLED` significa resultado descartado, por ejemplo por una modificación posterior de la incidencia. La cola puede seguir mostrando un trabajo técnico completado aunque el análisis de negocio sea `FAILED`; la fuente de verdad es `AiJob` en PostgreSQL.

Consulta cada 2–3 segundos solo mientras esté pendiente. No hay un endpoint adicional de polling por trabajo para el ciudadano; usa este listado.

### Ver detalle administrativo

`GET {{baseUrl}}/admin/ai/jobs/{{jobId}}`, token ADMIN o SUPERVISOR. Respuesta **200**.

Comprueba `status`, `resultApplied`, `finalProvider`, `finalModel`, hashes, rondas, tiempos y `attempts`. Cada intento registra proveedor, modelo, estado, código de error saneado, latencia y tokens si el proveedor los devuelve. No se exponen el prompt completo, entrada, respuesta cruda, cabeceras, claves ni detalles privados de errores externos.

### Ver resultado e historial

`GET {{baseUrl}}/incidents/{{incidentId}}`, token propietario o personal autorizado. Debe pasar a `IN_REVIEW` con `classificationSource: "AI"`, descripción mejorada, acción sugerida, tipo, categoría, urgencia, sentimiento, palabras clave y confianza. El mensaje original y la ubicación no se modifican. Las entidades se guardan en BD; su consulta dedicada queda para la fase de revisión, no se añadió un endpoint aparte en esta entrega.

`GET {{baseUrl}}/incidents/{{incidentId}}/history`, mismo alcance. Debe incluir envío y paso a revisión. Se crea una notificación interna al reportante; bandeja y entrega push/email siguen pendientes de su etapa.

## 4. Reintentar un análisis fallido

`POST {{baseUrl}}/incidents/{{incidentId}}/ai/retry`, token ADMIN o SUPERVISOR:

```json
{ "expectedVersion": 3 }
```

Usa la versión actual de `GET /incidents/:id`. Respuesta **202** con **nuevo** `jobId`. Guarda el nuevo valor. `retryOfJobId` conserva la relación con el trabajo anterior. Se fijan nuevamente el prompt y las rutas actuales; no se borra ningún intento histórico.

Condiciones: incidencia `IN_REVIEW`, último análisis `FAILED`, IA habilitada, ninguna revisión humana aplicada y ningún trabajo activo. Un análisis ya exitoso no admite reemplazo por este endpoint. Una revisión humana o una versión posterior no puede ser sobrescrita por un worker antiguo.

Un OPERATOR solo puede reintentar si es MANAGER activo del área activa con asignación vigente al caso; pertenecer a un área o ser operador asignado no basta. Como la asignación aún corresponde a la siguiente etapa, para las pruebas actuales usa ADMIN/SUPERVISOR. Ciudadano: **403**.

## 5. Inspeccionar y recuperar outbox

`GET {{baseUrl}}/admin/queues/outbox?page=1&limit=20`, token ADMIN. Respuesta **200**. Filtro opcional: `&status=PENDING`, `PROCESSING`, `PUBLISHED` o `DEAD`.

`aggregateId` corresponde a **jobId**, no a incidentId. El listado incluye intentos de publicación, creación, próxima disponibilidad, publicación y código de error. Ordena primero las entradas antiguas para atenderlas. No revela la carga útil.

Si Redis no está disponible, el envío HTTP sigue persistiendo y devuelve 202; outbox reintenta con espera creciente hasta `OUTBOX_MAX_ATTEMPTS`. Entonces pasa a `DEAD` y permanece visible para intervención. Restablece Redis antes de recuperar una entrada:

`POST {{baseUrl}}/admin/queues/outbox/{{outboxId}}/retry`, token ADMIN, **sin body**. Respuesta **202**. Admite únicamente `DEAD` y trabajo `PENDING`/`QUEUED`; reinicia los intentos de publicación del **mismo** job, no crea otra clasificación. Se audita. Una entrada `PUBLISHED`/`PENDING` o un trabajo terminal devuelve **409**.

El reconciliador recupera leases vencidos y vuelve a publicar trabajos pendientes incluso si Redis perdió su copia después de publicar. Conserva un ID de BullMQ estable y protege el resultado mediante token, lease, estado y versión en PostgreSQL. Hay entrega al menos una vez, no promesa de llamadas externas exactamente una vez.

## 6. Salud y pruebas negativas

`GET {{baseUrl}}/health`, sin autenticación: **200** con `status: "ok"`, PostgreSQL y Redis disponibles. Redis caído: **200** con `status: "degraded"`, porque todavía se pueden recibir reportes. PostgreSQL caído: **503**. Con ambos flags IA deshabilitados, Redis se muestra como `null` y la cola como `disabled`; no se abre conexión solo para esa salud. Esto no verifica disponibilidad de proveedores, credenciales reales ni MinIO.

Pruebas recomendadas sobre reportes nuevos de desarrollo:

| Prueba                                                     | Resultado esperado                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Sin JWT                                                    | 401 en endpoints protegidos.                                                                     |
| Ciudadano ajeno                                            | 404 en consulta/envío; no revela existencia.                                                     |
| `expectedVersion` faltante, texto o campo extra            | 400.                                                                                             |
| Versión vieja, envío repetido o dos envíos simultáneos     | 409; un solo trabajo activo.                                                                     |
| Carga de evidencia pendiente                               | 409 hasta finalizarla.                                                                           |
| Ciudadano consulta diagnóstico/outbox                      | 403. SUPERVISOR tampoco accede a outbox.                                                         |
| Modelo deliberadamente inválido en una ruta de desarrollo  | Intento con código HTTP saneado; si no hay alternativa válida, FAILED + IN_REVIEW + supervisión. |
| Principal falla y secundaria válida                        | Intentos en orden de prioridad y resultado de secundaria.                                        |
| Redis desconectado en tu entorno de prueba                 | Envío persiste; outbox pendiente/dead; recupera al restaurarlo. No borres volúmenes.             |
| Worker detenido (`AI_WORKER_ENABLED=false`, reiniciar API) | Trabajos permanecen en cola; al reactivarlo se procesan.                                         |
| Cambiar prompt/ruta tras un envío pendiente                | El trabajo conserva su snapshot; nuevos envíos usan configuración nueva.                         |
| `AI_ENABLED=false`, reiniciar y enviar reporte nuevo       | 202, `IN_REVIEW`, `MANUAL_WITHOUT_AI`, `jobId:null`. No finge clasificación.                     |

Antes de probar fallos, anota la configuración y restáurala al terminar. Las llamadas reales a proveedores consumen cuota; no generes 429 intencionalmente contra tu cuenta. Timeout, 429, JSON incompatible, duplicados y recuperación se cubren también con proveedores simulados en la prueba automatizada.

## 7. Verificaciones locales y siguiente fase

```powershell
pnpm run build
$env:RUN_AI_CONFIG_INTEGRATION_TESTS='1'
node --test test/ai-config.integration.test.cjs
$env:RUN_INCIDENT_AI_INTEGRATION_TESTS='1'
node --test test/incident-ai.integration.test.cjs
```

La prueba nueva crea/elimina exclusivamente un esquema PostgreSQL temporal y una cola Redis con prefijo aleatorio `test-willariq-*`. No limpia tu Redis compartido, no modifica filas de negocio ni llama a proveedores reales. Requiere permisos para crear el esquema temporal y Redis disponible. La desconexión de publicación se simula; no detiene tu servidor Redis.

Cuando valides el flujo real en Postman, sigue la **etapa 6: revisión humana, aceptación/rechazo, asignación y atención**. Revisaremos antes los paquetes y variables que realmente falten. El panel web y React Native no se modificaron en esta entrega; el móvil permanece al final del plan.

Referencias de protocolos: [Cerebras chat](https://inference-docs.cerebras.ai/api-reference/chat-completions), [Groq compatible API](https://console.groq.com/docs/openai), [OpenRouter](https://openrouter.ai/docs/api_reference/overview), [conexiones BullMQ](https://docs.bullmq.io/guide/connections).
