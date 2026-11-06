# Etapa 8 · Correo y ciclo de cuenta en Postman

El backend usa Nodemailer y Gmail por SMTP. Las cuentas se siguen registrando e iniciando sesión con DNI. El correo verificado habilita la recuperación de contraseña.

## Preparación

En el entorno privado de la API, conserva los valores SMTP que preparaste. Usa la contraseña de aplicación de Google en `SMTP_PASS` y la misma cuenta en `SMTP_USER` y como dirección de `MAIL_FROM`. El servidor necesita salida TCP a `smtp.gmail.com:465`.

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=tu-cuenta@gmail.com
SMTP_PASS=
MAIL_FROM="Willariq <tu-cuenta@gmail.com>"
EMAIL_VERIFICATION_URL=http://localhost:5173/verificar-correo
PASSWORD_RESET_URL=http://localhost:5173/restablecer-contrasena
EMAIL_TOKEN_TTL_MINUTES=60
PASSWORD_RESET_TOKEN_TTL_MINUTES=30
```

El bloque SMTP, remitente y URLs se configura completo para habilitar el envío. Se aceptan destinos HTTPS y HTTP local en loopback. Si las pantallas todavía no existen, copia el parámetro `token` del enlace recibido y úsalo en Postman. Mantén los tokens de correo en un entorno privado de prueba.

Antes de arrancar la API, revisa las migraciones pendientes, aplícalas y regenera Prisma Client.

```bash
pnpm exec prisma migrate status --config prisma7.config.ts
pnpm exec prisma migrate deploy --config prisma7.config.ts
pnpm exec prisma generate --config prisma7.config.ts
```

La migración agrega `users.sessionVersion` con valor inicial cero. Las sesiones previas siguen funcionando hasta que expiren o se revoquen. Las tablas de enlaces se reutilizan.

En Postman define `UrlBase` (por ejemplo, `http://localhost:8000/api`). Usa Body → raw → JSON para todas las solicitudes con cuerpo. Inicia sesión mediante `POST /auth/mobile/login` y guarda `data.tokens.accessToken` y `data.tokens.refreshToken`. En rutas privadas selecciona **Bearer Token**. Limpia las cookies de pruebas web si quieres comprobar respuestas sin sesión.

## Registrar o cambiar el correo y verificarlo

1. Como usuario autenticado envía `PUT {{UrlBase}}/users/me/email`.

   ```json
   {
     "email": "tu-buzon-de-prueba@gmail.com",
     "currentPassword": "ContrasenaActualDePrueba"
   }
   ```

   Espera **200**, correo normalizado y `emailVerifiedAt: null` al cambiarlo. El correo anterior deja de ser elegible para recuperación. Las solicitudes de verificación y recuperación pendientes del correo anterior quedan invalidadas. Si repites el mismo correo, se conserva su verificación. Una contraseña actual incorrecta devuelve **401** y un correo ocupado por otra cuenta devuelve **409**.

2. Con el mismo Bearer, envía `POST {{UrlBase}}/users/me/email/verification-requests` con cuerpo JSON `{}`. Espera **202** cuando SMTP acepte el mensaje. Si reenvías dentro del minuto de espera devuelve **429**. Si SMTP falla, devuelve **503**. Si falta el correo o ya está verificado, devuelve **409**.

3. Abre el mensaje y copia `token`. Sin autenticación envía `POST {{UrlBase}}/users/email-verifications/confirm`.

   ```json
   { "token": "{{verificationToken}}" }
   ```

   Espera **200**. Con el Bearer original, `GET /users/me` muestra `emailVerifiedAt`. Reutilizar, alterar o vencer el token devuelve **400**.

## Recuperar la contraseña

1. Sin autenticación envía `POST {{UrlBase}}/auth/password/forgot`.

   ```json
   { "email": "tu-buzon-de-prueba@gmail.com" }
   ```

   Espera **202** con un mensaje genérico. Prueba otro correo válido que no pertenezca a una cuenta y compara la respuesta. Solo una cuenta activa con correo verificado recibe el enlace. La API intenta enviarlo en segundo plano y aplica un minuto de espera por cuenta. Si el proceso se reinicia antes del envío, vuelve a solicitarlo pasado ese minuto.

2. Antes de consumir el enlace, comprueba que la contraseña anterior sigue funcionando. Copia el token y envía `POST {{UrlBase}}/auth/password/reset`, sin autenticación.

   ```json
   {
     "token": "{{passwordResetToken}}",
     "newPassword": "ContrasenaRecuperadaDePrueba"
   }
   ```

   Espera **200**. Repetir el token devuelve **400**. Comprueba que la contraseña anterior, el Bearer anterior y el refresh token anterior reciben **401**. Inicia sesión con la nueva contraseña.

## Cambiar la contraseña y cerrar todas las sesiones

1. Con un Bearer vigente, envía `PATCH {{UrlBase}}/users/me/password`.

   ```json
   {
     "currentPassword": "ContrasenaRecuperadaDePrueba",
     "newPassword": "ContrasenaNuevaDePrueba"
   }
   ```

   Espera **200** y vuelve a iniciar sesión. La contraseña nueva admite de 8 caracteres a 72 bytes en UTF-8. Se invalidan los JWT, refresh tokens y enlaces de recuperación pendientes. Una contraseña actual incorrecta devuelve **401**.

2. Inicia sesión dos veces y guarda ambos pares de tokens. Con uno de los Bearer, envía `POST {{UrlBase}}/auth/logout-all` con cuerpo JSON `{}`. Espera **200**. Usa los dos Bearer en `GET /users/me` y los dos refresh tokens en `POST /auth/mobile/refresh`. Todos deben devolver **401**. Puedes volver a entrar con la misma contraseña.

3. Como ADMIN, consulta `GET /admin/audit-logs?entityType=User&entityId={{userId}}` para ver cambios de correo, verificación, recuperación, cambio de contraseña y revocación de sesiones. El registro guarda actor y acción, sin contraseñas, enlaces ni tokens.

Las dos acciones privadas `POST /users/me/email/verification-requests` y `POST /auth/logout-all` requieren `Content-Type: application/json`. Usa `{}` como cuerpo. Así, una solicitud web con cookies desde otro origen requiere la validación CORS del backend.

La prueba automatizada usa PostgreSQL temporal y un correo simulado. El envío real a Gmail se verifica con el recorrido anterior cuando enciendas el servidor.
