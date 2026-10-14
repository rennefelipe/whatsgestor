import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserResponse } from '../../users/users.service';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserResponse =>
    context.switchToHttp().getRequest<{ user: UserResponse }>().user,
);
