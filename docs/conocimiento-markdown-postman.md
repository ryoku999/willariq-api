# Etapa 9 · Conocimiento en Markdown y embeddings

La API guarda el original en RustFS, fragmenta el Markdown y genera vectores en una cola independiente de clasificación de incidencias. La búsqueda exacta por coseno queda disponible para el chatbot de la etapa 10 y solo consulta publicaciones del perfil solicitado.

## Preparación

Conserva tu configuración de PostgreSQL con pgvector, Redis, RustFS y OpenRouter. El bucket privado de conocimiento debe ser distinto del de evidencias. Usa la misma credencial S3 de la API con permisos para leer, escribir y eliminar objetos en ese bucket. La eliminación permite compensar cargas si falla el registro en PostgreSQL.

```dotenv
MINIO_KNOWLEDGE_BUCKET=municipal-knowledge
KNOWLEDGE_MAX_DOCUMENT_BYTES=1048576
KNOWLEDGE_CHUNK_TARGET_CHARS=800
KNOWLEDGE_CHUNK_OVERLAP_CHARS=100
KNOWLEDGE_WORKER_CONCURRENCY=1
```

El modelo, las dimensiones, el tiempo máximo y el tamaño de lote se administran desde **Configuración de IA → Embeddings de conocimiento**. La migración crea la tabla vacía y conserva los vectores existentes. El ADMIN registra y activa el perfil desde el panel. [Guía de perfiles y reindexación](embeddings-perfiles-pruebas.md).

El módulo reutiliza `MINIO_ENABLED=true`, `BULLMQ_PREFIX`, `OPENROUTER_API_KEY` y `OPENROUTER_BASE_URL`. Configurar el bucket activa el worker y su outbox. La migración vincula trabajos, fragmentos y publicaciones, y conserva la columna vectorial de longitud variable.

Antes de arrancar la API, revisa las migraciones pendientes, aplícalas y regenera Prisma Client.

```bash
pnpm exec prisma migrate status --config prisma7.config.ts
pnpm exec prisma migrate deploy --config prisma7.config.ts
pnpm exec prisma generate --config prisma7.config.ts
```

Usa contenido público sin datos personales para el primer documento. NVIDIA indica que el endpoint gratuito puede registrar el contenido enviado. [Nemotron 3.5 Embed 1B en OpenRouter](https://openrouter.ai/nvidia/nemotron-3.5-embed-1b:free)

## Recorrido en Postman

Define `UrlBase` (por ejemplo `http://localhost:8000/api`) y `adminToken`. Usa Authorization → Bearer Token con `{{adminToken}}` en todas las rutas. Las respuestas JSON exitosas usan `{ success, path, data }`.

1. Crea un archivo `licencias.md` en UTF-8 con este contenido ficticio:

   ```markdown
   # Licencias municipales de prueba

   ## Requisitos

   La solicitud de prueba se presenta en la mesa de partes.

   ## Horario

   La atención de prueba es de lunes a viernes de 8:00 a 16:00.
   ```

2. Envía `POST {{UrlBase}}/knowledge/documents`. En **Body → form-data** usa los campos siguientes y deja que Postman genere el encabezado multipart.

   | Campo | Tipo | Ejemplo |
   | --- | --- | --- |
   | `file` | File | `licencias.md` |
   | `title` | Text | Licencias municipales de prueba |
   | `sourceType` | Text | `PROCEDURE` |

   Se admiten `MANUAL`, `MUNICIPAL_REGULATION`, `FAQ`, `PROCEDURE` y `OTHER`. Espera **201** y estado `DRAFT`. Guarda `data.id` como `documentId`. El límite inicial es 1 MiB y se admiten hasta 512 fragmentos por documento.

3. Consulta `GET {{UrlBase}}/knowledge/documents?page=1&limit=20` y `GET {{UrlBase}}/knowledge/documents/{{documentId}}`. Ambos devuelven **200**. Usa `GET {{UrlBase}}/knowledge/documents/{{documentId}}/content` con **Send and Download** para guardar el original como adjunto.

4. Envía `POST {{UrlBase}}/knowledge/documents/{{documentId}}/process` sin cuerpo. Espera **202** y guarda `data.id` como `jobId`. Al repetir la solicitud mientras está activo, obtienes el mismo job.

5. Consulta `GET {{UrlBase}}/knowledge/documents/{{documentId}}/jobs?page=1&limit=20`. Al finalizar, el job queda `COMPLETED`, `inputPayload.dimensions` es `2048` y `finalOutput.embedded` coincide con `finalOutput.total`. El documento queda `READY`, con `publications: []` en la primera carga.

6. Envía `POST {{UrlBase}}/knowledge/documents/{{documentId}}/publish` sin cuerpo. Espera **200** y una publicación con `jobId`, modelo, dimensión y fecha. La publicación del mismo job es idempotente. Si el documento aún se procesa, espera **409**.

7. Envía `POST {{UrlBase}}/knowledge/documents/{{documentId}}/archive` sin cuerpo. Espera **200** con estado `ARCHIVED`. El archivo y el historial siguen disponibles para ADMIN. La búsqueda excluye el documento de todos los perfiles. Procesarlo o publicarlo otra vez devuelve **409**.

## Fallos y permisos

| Prueba | Resultado esperado |
| --- | --- |
| Sin sesión o con token de otro rol | **401** o **403**, respectivamente. |
| PDF, imagen, TXT o Markdown con UTF-8 inválido | **400**. |
| Archivo por encima del límite multipart | **413**. |
| OpenRouter responde 429 o falla temporalmente | Reintentos con el mismo job y perfil. Tras el último intento queda `FAILED` y el documento queda `ERROR`. |
| OpenRouter devuelve vectores de longitud distinta de 2048 | `FAILED` con `INVALID_EMBEDDING_VECTOR`. |
| Redis falla y la outbox agota sus intentos | El job muestra `dispatchStatus: DEAD`. Tras recuperar Redis, repite `/process` para reactivar su despacho. |
| Un job termina en `FAILED` | Repite `/process` para crear otro con la configuración vigente. Las publicaciones anteriores quedan disponibles en sus perfiles. |

Los reintentos automáticos vuelven a procesar el documento desde el inicio. Los jobs guardan la huella y el perfil, y los fragmentos quedan asociados al job que los produjo. Para cambiar explícitamente de modelo o dimensión, procesa y publica los Markdown con el nuevo perfil. Ambos conjuntos pueden coexistir y cada consulta usa solo uno.

La prueba automatizada usa PostgreSQL y pgvector en un esquema temporal, un servidor HTTP que simula OpenRouter y dobles de almacenamiento y despacho. Este recorrido en Postman verifica tus servicios reales.
