# Etapa 10 · Chatbot municipal con fuentes

El chat separa las preguntas sobre documentos públicos del seguimiento de incidencias. Las preguntas municipales recuperan Markdown publicado con el perfil de embeddings de la etapa 9. El seguimiento consulta PostgreSQL con las mismas reglas de acceso de incidencias y entrega únicamente el código y el estado.

## Preparación

El módulo reutiliza PostgreSQL con pgvector, Redis/BullMQ y la configuración de embeddings de la etapa 9. Las tablas ya existen en el historial de Prisma. Comprueba que las migraciones anteriores estén aplicadas antes de arrancar.

```bash
pnpm exec prisma migrate status --config prisma7.config.ts
```

Conserva `OPENROUTER_API_KEY` y `OPENROUTER_BASE_URL`. El chat usa el perfil de embeddings activo en PostgreSQL y busca publicaciones con ese modelo y dimensiones. [Guía de perfiles](embeddings-perfiles-pruebas.md). Asegúrate de tener al menos un documento **publicado**. Un documento en READY sin publicación todavía queda fuera de la búsqueda.

```dotenv
RAG_TOP_K=5
RAG_MIN_SIMILARITY=0.70
RAG_MAX_CONTEXT_TOKENS=4000
CHAT_MAX_MESSAGE_CHARS=4000
CHAT_MAX_HISTORY_MESSAGES=20
```

El límite de contexto aplica un presupuesto conservador en bytes UTF-8 a las fuentes serializadas, sin tokenizer adicional. El historial municipal también está acotado y queda fuera del conjunto de evidencia. El chat se activa por defecto cuando hay un bucket de conocimiento configurado. Puedes controlar el módulo con `CHAT_ENABLED=true|false` y fijar el canal oficial con la variable opcional `CHAT_MUNICIPAL_CONTACT`.

## Configurar el modelo de chat

Define `UrlBase` en Postman (por ejemplo `http://localhost:8000/api`) y usa un Bearer **ADMIN** en esta sección. Si ya tienes un prompt CHATBOT con el contrato siguiente y una ruta habilitada, pasa a la comprobación.

1. Envía `POST {{UrlBase}}/admin/ai/prompts` con un nombre y versión libres:

   ```json
   {
     "name": "asistente-municipal",
     "version": 1,
     "capability": "CHATBOT",
     "systemPrompt": "Eres el asistente municipal de Willariq. Explica trámites en español claro y conserva las condiciones y excepciones de la fuente.",
     "responseSchema": {
       "type": "object",
       "additionalProperties": false,
       "properties": {
         "answer": { "type": "string", "minLength": 1, "maxLength": 4000 },
         "citations": { "type": "array", "maxItems": 20, "items": { "type": "integer", "minimum": 1 } }
       },
       "required": ["answer", "citations"]
     }
   }
   ```

2. Guarda `data.id` como `promptId` y activa el prompt con `POST {{UrlBase}}/admin/ai/prompts/{{promptId}}/activate`.
3. Envía `POST {{UrlBase}}/admin/ai/routes`. Sustituye el modelo por tu ID de chat con soporte para respuesta JSON. El worker considera hasta tres rutas habilitadas con credenciales, por prioridad ascendente.

   ```json
   {
     "capability": "CHATBOT",
     "provider": "OPENROUTER",
     "model": "reemplazar/por-tu-modelo-de-chat",
     "priority": 1,
     "enabled": true,
     "timeoutMs": 30000
   }
   ```

4. Envía `POST {{UrlBase}}/admin/ai/config/check` con `{"capability":"CHATBOT"}`. Comprueba `configurationReady: true` y `executionImplemented: true`. El recorrido siguiente verifica la generación efectiva.

Para las pruebas de RAG usa documentos y preguntas de carácter público. El proveedor de embeddings recibe el texto de la pregunta y el modelo de chat recibe la pregunta, historial municipal acotado y fragmentos seleccionados. Los resultados y el historial de seguimiento quedan en PostgreSQL.

## Conversación municipal

Usa un Bearer de **CITIZEN**. Los POST de chat requieren **Body → raw → JSON**.

1. Envía `POST {{UrlBase}}/chat/sessions` con `{"title":"Consulta sobre licencias"}` o `{}`. Espera **201** y guarda `data.id` como `chatSessionId`.
2. Envía `POST {{UrlBase}}/chat/sessions/{{chatSessionId}}/messages` con una pregunta cubierta por uno de tus Markdown publicados:

   ```json
   {
     "clientRequestId": "b8253445-ef35-413e-97a5-69da7797f481",
     "content": "¿Dónde presento mi solicitud de licencia?"
   }
   ```

   Espera **202**. Guarda `data.job.id` como `chatJobId`. Repetir el mismo UUID y contenido devuelve el mismo mensaje y job. Cambiar el contenido con el mismo UUID o enviar otra pregunta mientras hay un trabajo activo devuelve **409**. Genera otro UUID para cada pregunta nueva.

3. Consulta `GET {{UrlBase}}/chat/jobs/{{chatJobId}}` hasta `COMPLETED`. Guarda `data.finalOutput.messageId`. Busca ese ID en `GET {{UrlBase}}/chat/sessions/{{chatSessionId}}/messages?page=1&limit=20`. El listado muestra primero los mensajes recientes.
4. Comprueba que la respuesta `ASSISTANT` tenga `metadata.sources` con `ref`, `documentId`, `chunkId`, `title`, `section` y `chunkIndex`. La API valida las referencias contra los fragmentos entregados al modelo y guarda las relaciones de cita.
5. Pregunta algo fuera de tus documentos. Si no hay evidencia suficiente, la respuesta debe indicarlo, mostrar el canal oficial configurado cuando exista y traer `sources: []`. Si una pregunta cubierta produce ese resultado, revisa el perfil de publicación y ajusta el umbral con ejemplos conocidos.

Usa `GET /chat/sessions?page=1&limit=20` para listar tus conversaciones y `GET /chat/sessions/{{chatSessionId}}` para consultar su estado.

## Seguimiento autorizado

Envía otro mensaje con UUID nuevo y un código de una incidencia que pueda leer tu cuenta. Puedes incluirlo en el texto o enviarlo en `trackingCode`:

```json
{
  "clientRequestId": "5c189997-4126-4648-97ab-ad237275253f",
  "content": "¿En qué estado está mi reporte?",
  "trackingCode": "WQ-2026-000001"
}
```

Sustituye el código por uno real. Cuando el trabajo termine, la respuesta indica el estado registrado. Prueba un código de otro ciudadano y luego uno inexistente. Ambos casos muestran el mismo mensaje de incidencia no disponible. Si cambian los permisos del usuario, la lectura del historial vuelve a comprobar el acceso a los resultados de seguimiento.

## Privacidad, cierre y errores

- Cambia a otra cuenta e intenta leer el detalle, historial y job de la primera. Espera **404**. Sin sesión válida, espera **401**.
- Envía `POST /chat/sessions/{{chatSessionId}}/close` con `{}`. Espera **200** y `CLOSED`. Los trabajos activos se cancelan y los mensajes ya guardados siguen disponibles para su propietario. Un mensaje nuevo devuelve **409**.
- Si la generación falla temporalmente, consulta el job para ver su estado y el código de error. Los reintentos conservan el mismo perfil y rutas. Un job `FAILED` requiere una solicitud nueva con otro UUID.
- Si `dispatchStatus` es `DEAD`, recupera Redis y repite exactamente el mensaje con el mismo `clientRequestId` para reactivar el despacho.
- Los endpoints de seguimiento siguen funcionando aunque falte configurar un modelo generativo. Una consulta municipal sin prompt activo, ruta habilitada o clave de embeddings devuelve **503**.

La prueba automatizada usa PostgreSQL y pgvector temporales, proveedores HTTP simulados y un doble de despacho. El recorrido de Postman verifica la instalación real.
