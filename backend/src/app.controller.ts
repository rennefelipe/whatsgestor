import { Public } from './auth/decorators/public.decorator';
﻿import { Controller, Get } from '@nestjs/common';

@Public()
@Controller()
export class AppController {
  @Get()
  status() {
    return {
      sistema: 'WhatsGestor',
      componente: 'Backend',
      status: 'online',
      versao: '1.0.0',
    };
  }
}
