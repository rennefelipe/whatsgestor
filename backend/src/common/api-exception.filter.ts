import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      status(code: number): { json(body: unknown): void };
    }>();
    if (error instanceof HttpException) {
      const body = error.getResponse();
      response.status(error.getStatus()).json(typeof body === 'string'
        ? { statusCode: error.getStatus(), message: body }
        : body);
      return;
    }
    const invalidJson = typeof error === 'object' && error !== null &&
      'type' in error && error.type === 'entity.parse.failed';
    const unavailable = error instanceof QueryFailedError;
    const status = invalidJson ? 400 : unavailable ? 503 : 500;
    if (!invalidJson) Logger.error('Falha de operacao; detalhes sensiveis omitidos.', undefined, 'API');
    response.status(status).json({
      statusCode: status,
      message: invalidJson ? 'JSON inválido.' : unavailable ? 'Serviço temporariamente indisponível.' : 'Erro interno do servidor.',
    });
  }
}
