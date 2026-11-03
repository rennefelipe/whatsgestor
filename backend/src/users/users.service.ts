import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserActiveDto } from './dto/update-user-active.dto';
import { UpdateUserDeletePermissionDto } from './dto/update-user-delete-permission.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { hashPassword } from './password-hash';
import { UsersProfileStore } from './users-profile.store';
import { effectiveRole, type UserProfile, type UserRole } from './user-profile';

export interface UserResponse {
  fullName?: string | null;
  email?: string | null;
  role?: UserRole;
  id: string;
  username: string;
  isAdmin: boolean;
  canDelete: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly profiles: UsersProfileStore,
  ) {}

  toResponse(user: User & Partial<UserProfile>): UserResponse {
    const { id, username, isAdmin, canDelete, isActive, createdAt, updatedAt } =
      user;
    return { id, username, isAdmin, canDelete, isActive, createdAt, updatedAt,
      ...(user.role ? { fullName: user.fullName ?? null, email: user.email ?? null, role: effectiveRole(user) } : {}) };
  }

  async schemaStatus() {
    return { profileFieldsAvailable: await this.profiles.available() };
  }

  private async enrich<T extends User>(users: T[], manager?: EntityManager): Promise<(T & Partial<UserProfile>)[]> {
    const profiles = await this.profiles.read(users.map((user) => user.id), manager);
    return users.map((user) => ({ ...user, ...profiles.get(user.id.toLowerCase()) }));
  }

  async findByUsername(username: string): Promise<(User & Partial<UserProfile>) | null> {
    const user = await this.users.createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.username = :username', { username })
      .getOne();
    return user ? (await this.enrich([user]))[0] : null;
  }

  async findActiveById(id: string): Promise<UserResponse | null> {
    const user = await this.users.findOneBy({ id, isActive: true });
    return user ? this.toResponse((await this.enrich([user]))[0]) : null;
  }

  async findAll(): Promise<UserResponse[]> {
    const users = await this.users.find({ order: { username: 'ASC' } });
    return (await this.enrich(users)).map((user) => this.toResponse(user));
  }

  async findOne(id: string): Promise<UserResponse> {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    return this.toResponse((await this.enrich([user]))[0]);
  }

  async create(dto: CreateUserDto): Promise<UserResponse> {
    const username = dto.username.trim();
    const passwordHash = await hashPassword(dto.password);
    const profileRequested = dto.fullName !== undefined || dto.email !== undefined || dto.role !== undefined;
    if (profileRequested) await this.profiles.requireAvailable();
    const ready = await this.profiles.available();
    if (ready && !dto.fullName?.trim()) throw new BadRequestException('Informe o nome completo do usuário.');
    const role = this.resolveRole(dto, dto.isAdmin ? 'administrator' : 'attendant');
    this.validateTester(role, dto.canDelete);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(User);
        const user = repository.create({
          username,
          passwordHash,
          isAdmin: dto.isAdmin,
          canDelete: dto.canDelete,
          isActive: dto.isActive,
        });
        const saved = await repository.save(user);
        if (ready) await this.profiles.write(saved.id, { fullName: dto.fullName!.trim(), email: dto.email ?? null, role }, saved, manager);
        return this.toResponse((await this.enrich([saved], manager))[0]);
      });
    } catch (error) {
      if (this.isUniqueUsernameError(error)) {
        throw new ConflictException('Esse username já está cadastrado.');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserResponse> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockUserRows(manager);
      const repository = manager.getRepository(User);
      const user = await repository.findOneBy({ id });
      if (!user) throw new NotFoundException('Usuário não encontrado.');
      const current = (await this.enrich([user], manager))[0];
      const profileRequested = dto.fullName !== undefined || dto.email !== undefined || dto.role !== undefined;
      if (profileRequested) await this.profiles.requireAvailable(manager);
      const role = this.resolveRole(dto, effectiveRole(current));
      this.validateTester(role, dto.canDelete ?? user.canDelete);

      const losesLastAdmin =
        user.isAdmin &&
        user.isActive &&
        ((role !== 'administrator') ||
          (dto.isActive !== undefined && !dto.isActive));
      if (losesLastAdmin && (await this.countActiveAdmins(repository)) <= 1) {
        throw new ConflictException(
          'Não é possível inativar ou remover o perfil do último administrador ativo.',
        );
      }

      if (dto.username !== undefined) user.username = dto.username.trim();
      if (dto.password !== undefined) {
        user.passwordHash = await hashPassword(dto.password);
      }
      user.isAdmin = role === 'administrator';
      if (dto.canDelete !== undefined) user.canDelete = dto.canDelete;
      if (dto.isActive !== undefined) user.isActive = dto.isActive;

      try {
        if (current.role) await this.profiles.write(id, {
          fullName: dto.fullName ?? current.fullName ?? null,
          email: dto.email === undefined ? current.email ?? null : dto.email,
          role,
        }, user, manager);
        if (current.role) user.updatedAt = (await this.profiles.read([id], manager)).get(id.toLowerCase())!.updatedAt;
        const saved = await repository.save(user);
        return this.toResponse((await this.enrich([saved], manager))[0]);
      } catch (error) {
        if (this.isUniqueUsernameError(error)) {
          throw new ConflictException('Esse username já está cadastrado.');
        }
        throw error;
      }
    });
  }

  updateActive(id: string, dto: UpdateUserActiveDto): Promise<UserResponse> {
    return this.update(id, { isActive: dto.isActive });
  }

  updateDeletePermission(
    id: string,
    dto: UpdateUserDeletePermissionDto,
  ): Promise<UserResponse> {
    return this.update(id, { canDelete: dto.canDelete });
  }

  private async lockUserRows(manager: EntityManager): Promise<void> {
    await manager.query(
      'SELECT TOP (1) [id] FROM [dbo].[users] WITH (TABLOCKX, HOLDLOCK)',
    );
  }

  private resolveRole(dto: { role?: UserRole; isAdmin?: boolean }, current: UserRole): UserRole {
    if (dto.role) {
      if (dto.isAdmin !== undefined && dto.isAdmin !== (dto.role === 'administrator')) throw new BadRequestException('Perfil e permissão administrativa incompatíveis.');
      return dto.role;
    }
    if (dto.isAdmin === true) return 'administrator';
    if (dto.isAdmin === false && current === 'administrator') return 'attendant';
    return current;
  }

  private validateTester(role: UserRole, canDelete: boolean): void {
    if (role === 'tester' && canDelete) throw new BadRequestException('Testadores não podem receber permissão de exclusão.');
  }

  private countActiveAdmins(repository: Repository<User>): Promise<number> {
    return repository.countBy({ isAdmin: true, isActive: true });
  }

  private isUniqueUsernameError(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { number?: number };
    return driverError.number === 2601 || driverError.number === 2627;
  }
}
