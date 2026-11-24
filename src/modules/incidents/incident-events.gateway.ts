import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { DatabaseService } from '@/database/database.service';
import type { JwtPayload } from '@/shared/interfaces/jwt-payload.interface';
import type { Namespace, Socket } from 'socket.io';

@WebSocketGateway({ namespace: '/incidents' })
export class IncidentEventsGateway implements OnGatewayInit {
  @WebSocketServer()
  private namespace?: Namespace;

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly db: DatabaseService,
  ) {}

  afterInit(namespace: Namespace) {
    const origins = this.config
      .getOrThrow<string>('CORS_ORIGINS')
      .split(',')
      .map((origin) => origin.trim());
    const cookieName = this.config.getOrThrow<string>(
      'AUTH_ACCESS_COOKIE_NAME',
    );
    const authenticate = async (socket: Socket) => {
      const { origin, cookie } = socket.handshake.headers;
      if (!origin || !origins.includes(origin)) throw new Error();
      const token = cookie
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(cookieName + '='))
        ?.slice(cookieName.length + 1);
      if (!token) throw new Error();
      const payload = await this.jwt.verifyAsync<JwtPayload>(
        decodeURIComponent(token),
        {
          algorithms: ['HS256'],
          issuer: this.config.getOrThrow<string>('JWT_ISSUER'),
          audience: this.config.getOrThrow<string>('JWT_AUDIENCE'),
        },
      );
      const user = await this.db.user.findUnique({
        where: { id: payload.sub },
        select: { status: true, role: true, sessionVersion: true },
      });
      if (
        !user ||
        user.status !== 'ACTIVE' ||
        (user.role !== 'ADMIN' && user.role !== 'OPERATOR') ||
        user.sessionVersion !== (payload.sessionVersion ?? 0) ||
        !payload.exp
      )
        throw new Error();
      const expiry = setTimeout(
        () => socket.disconnect(),
        Math.max(0, payload.exp * 1000 - Date.now()),
      );
      expiry.unref();
      socket.once('disconnect', () => clearTimeout(expiry));
    };
    namespace.use((socket, next) => {
      void authenticate(socket).then(
        () => next(),
        () => next(new Error('UNAUTHORIZED')),
      );
    });
  }

  publish(id: string, version: number, isNew = false) {
    this.namespace?.emit('incident.changed', { id, version, isNew });
  }
}
