import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { type Request } from 'express';
import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import { type AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { AiPromptsService } from './ai-prompts.service';
import { AiRoutesService } from './ai-routes.service';
import { AiProvidersService } from './ai-providers.service';
import { AiSchemaService } from './ai-schema.service';
import {
  CheckAiConfigDto,
  CreateAiRouteDto,
  CreatePromptDto,
  ListAiRoutesQueryDto,
  ListPromptsQueryDto,
  ReorderAiRoutesDto,
  UpdateAiRouteDto,
  ValidatePromptOutputDto,
} from './dto/ai-config.dto';

@Controller('admin/ai')
@Auth(UserRole.ADMIN)
export class AiConfigController {
  constructor(
    private readonly prompts: AiPromptsService,
    private readonly routes: AiRoutesService,
    private readonly providers: AiProvidersService,
    private readonly schemas: AiSchemaService,
  ) {}

  @Get('contracts/incident-classification')
  contract() {
    return {
      capability: 'INCIDENT_CLASSIFICATION',
      contractVersion: 1,
      responseSchema: this.schemas.classificationContract(),
    };
  }

  @Post('prompts')
  createPrompt(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreatePromptDto,
    @Req() request: Request,
  ) {
    return this.prompts.create(actor, body, this.context(request));
  }

  @Get('prompts')
  listPrompts(@Query() query: ListPromptsQueryDto) {
    return this.prompts.list(query);
  }

  @Get('prompts/:id')
  prompt(@Param('id', ParseUUIDPipe) id: string) {
    return this.prompts.findById(id);
  }

  @Post('prompts/:id/activate')
  @HttpCode(HttpStatus.OK)
  activate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.prompts.setActive(actor, id, true, this.context(request));
  }

  @Post('prompts/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.prompts.setActive(actor, id, false, this.context(request));
  }

  @Post('prompts/:id/validate-output')
  @HttpCode(HttpStatus.OK)
  validateOutput(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ValidatePromptOutputDto,
  ) {
    return this.prompts.validateOutput(id, body.output);
  }

  @Post('routes')
  createRoute(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateAiRouteDto,
    @Req() request: Request,
  ) {
    return this.routes.create(actor, body, this.context(request));
  }

  @Get('routes')
  listRoutes(@Query() query: ListAiRoutesQueryDto) {
    return this.routes.list(query);
  }

  @Patch('routes/:id')
  updateRoute(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAiRouteDto,
    @Req() request: Request,
  ) {
    return this.routes.update(actor, id, body, this.context(request));
  }

  @Put('routes/priorities')
  reorder(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: ReorderAiRoutesDto,
    @Req() request: Request,
  ) {
    return this.routes.reorder(actor, body, this.context(request));
  }

  @Get('providers/status')
  providersStatus() {
    return this.providers.status();
  }

  @Post('config/check')
  @HttpCode(HttpStatus.OK)
  check(@Body() body: CheckAiConfigDto) {
    return this.routes.check(body?.capability);
  }

  private context(request: Request) {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }
}
