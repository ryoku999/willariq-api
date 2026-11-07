# Perfiles de embeddings y reindexación

## Aplicar el cambio

Con la API detenida, desde el repositorio de la API ejecuta:

```bash
pnpm exec prisma migrate status --config prisma7.config.ts
pnpm exec prisma migrate deploy --config prisma7.config.ts
pnpm exec prisma generate --config prisma7.config.ts
```

La migración `20261107120000_embedding_profiles` crea la tabla y sus restricciones. Conserva los documentos, publicaciones, vectores y trabajos existentes. Los trabajos ya en cola conservan su configuración original.

Puedes quitar estas variables del `.env` de la API:

- `OPENROUTER_EMBEDDING_MODEL`
- `OPENROUTER_EMBEDDING_DIMENSIONS`
- `OPENROUTER_EMBEDDING_TIMEOUT_MS`
- `OPENROUTER_EMBEDDING_BATCH_SIZE`

Conserva `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` si la configuraste, y los ajustes de PostgreSQL, Redis, RustFS, fragmentación y RAG. No se agregan paquetes ni variables. Arranca la API y el panel como de costumbre.

## Probar en el panel

1. Entra como ADMIN a **Configuración de IA → Embeddings de conocimiento**. Registra `nvidia/nemotron-3.5-embed-1b:free` con 2048 dimensiones, 30 000 ms y lote de 4. Pulsa **Validar y guardar** y luego **Activar**. Las publicaciones que ya coinciden con ese modelo y dimensión se reutilizan.
2. Abre el chatbot y formula una pregunta que ya devolvía citas de un Markdown publicado. Comprueba que las citas siguen disponibles sin reprocesarlo.
3. Para cambiar de modelo, indica su identificador en OpenRouter, la dimensión que devuelve, el tiempo máximo y el lote. Pulsa **Validar y guardar**. La API prueba una entrada de documento y otra de consulta. Si el proveedor falla o la dimensión no coincide, el perfil no se guarda. Guardar la misma combinación actualiza el tiempo máximo y el lote para trabajos nuevos.
4. En el perfil inactivo, pulsa **Reindexar publicados**. La API encola los Markdown publicados que faltan para ese perfil y reutiliza el contenido original de RustFS. Los borradores se mantienen fuera del chatbot. En **Conocimiento**, revisa los trabajos hasta que terminen. Si alguno falla, corrige la causa y repite la reindexación.
5. Pulsa **Activar**. La API publica los conjuntos completos y verifica la cobertura antes de cambiar el perfil activo. Si todavía falta un documento, el perfil anterior sigue activo. Repite la consulta del chatbot y comprueba sus citas. Puedes volver al perfil anterior si conserva cobertura para el corpus publicado.

## Probar en Postman

Usa `Authorization: Bearer {{adminToken}}` y una `{{UrlBase}}` que incluya `/api`.

| Método y ruta | Resultado esperado |
| --- | --- |
| `GET {{UrlBase}}/admin/ai/embedding-profiles` | Lista vacía antes del registro inicial y un único perfil activo después de activarlo |
| `POST {{UrlBase}}/admin/ai/embedding-profiles` | Perfil guardado tras validar ambas entradas. Un fallo del proveedor o una dimensión incorrecta devuelve 422 |
| `POST {{UrlBase}}/admin/ai/embedding-profiles/{{profileId}}/reindex` | Cantidad de documentos solicitados y conflictos por documento |
| `POST {{UrlBase}}/admin/ai/embedding-profiles/{{profileId}}/activate` | Perfil activo al completar la cobertura. Devuelve 409 si faltan vectores |
| `GET {{UrlBase}}/knowledge/documents/{{documentId}}/jobs` | Estado de los trabajos del documento |

Ejemplo de cuerpo JSON para validar la configuración inicial:

```json
{
  "model": "nvidia/nemotron-3.5-embed-1b:free",
  "dimensions": 2048,
  "timeoutMs": 30000,
  "batchSize": 4
}
```

Con un token de SUPERVISOR u OPERATOR, las rutas de perfiles deben devolver 403. Con un ADMIN, comprueba que una activación prematura devuelve 409 y que el GET sigue indicando el perfil anterior como activo.
