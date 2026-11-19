import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProvider } from '@/generated/prisma/enums';

@Injectable()
export class AiProvidersService {
  constructor(private readonly config: ConfigService) {}

  isConfigured(provider: AiProvider): boolean {
    const keys: Record<AiProvider, string> = {
      CEREBRAS: 'CEREBRAS_API_KEY',
      GROQ: 'GROQ_API_KEY',
      OPENROUTER: 'OPENROUTER_API_KEY',
    };
    return Boolean(this.config.get<string>(keys[provider])?.trim());
  }

  status() {
    return {
      items: Object.values(AiProvider).map((provider) => ({
        provider,
        credentialConfigured: this.isConfigured(provider),
        availability: 'NOT_CHECKED',
      })),
      externalRequestsMade: false,
    };
  }
}
