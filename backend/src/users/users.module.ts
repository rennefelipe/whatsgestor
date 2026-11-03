import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { AdminGuard } from '../auth/guards/admin.guard';
import { UsersProfileStore } from './users-profile.store';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService, UsersProfileStore, AdminGuard],
  exports: [UsersService, UsersProfileStore],
})
export class UsersModule {}
