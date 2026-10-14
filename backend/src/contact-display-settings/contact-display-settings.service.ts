import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateContactDisplaySettingDto } from './dto/update-contact-display-setting.dto';
import { ContactDisplaySetting } from './entities/contact-display-setting.entity';

@Injectable()
export class ContactDisplaySettingsService {
  constructor(
    @InjectRepository(ContactDisplaySetting)
    private readonly settings: Repository<ContactDisplaySetting>,
  ) {}

  findAll(): Promise<ContactDisplaySetting[]> {
    return this.settings.find({ order: { displayOrder: 'ASC' } });
  }

  async update(
    id: string,
    dto: UpdateContactDisplaySettingDto,
  ): Promise<ContactDisplaySetting> {
    const setting = await this.settings.findOneBy({ id });
    if (!setting) {
      throw new NotFoundException(
        'Configuração de exibição do contato não encontrada.',
      );
    }
    Object.assign(setting, dto);
    return this.settings.save(setting);
  }
}
