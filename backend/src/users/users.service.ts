import {
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

export interface UserResponse {
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
  ) {}

  toResponse(user: User): UserResponse {
    const { id, username, isAdmin, canDelete, isActive, createdAt, updatedAt } =
      user;
    return { id, username, isAdmin, canDelete, isActive, createdAt, updatedAt };
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.users.findOneBy({ username });
  }

  async findActiveById(id: string): Promise<UserResponse | null> {
    const user = await this.users.findOneBy({ id, isActive: true });
    return user ? this.toResponse(user) : null;
  }

  async findAll(): Promise<UserResponse[]> {
    const users = await this.users.find({ order: { username: 'ASC' } });
    return users.map((user) => this.toResponse(user));
  }

  async findOne(id: string): Promise<UserResponse> {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    return this.toResponse(user);
  }

  async create(dto: CreateUserDto): Promise<UserResponse> {
    const username = dto.username.trim();
    const passwordHash = await hashPassword(dto.password);
    try {
      const user = this.users.create({
        username,
        passwordHash,
        isAdmin: dto.isAdmin,
        canDelete: dto.canDelete,
        isActive: dto.isActive,
      });
      return this.toResponse(await this.users.save(user));
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

      const losesLastAdmin =
        user.isAdmin &&
        user.isActive &&
        ((dto.isAdmin !== undefined && !dto.isAdmin) ||
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
      if (dto.isAdmin !== undefined) user.isAdmin = dto.isAdmin;
      if (dto.canDelete !== undefined) user.canDelete = dto.canDelete;
      if (dto.isActive !== undefined) user.isActive = dto.isActive;

      try {
        return this.toResponse(await repository.save(user));
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
      'SELECT TOP (1) [id] FROM [users] WITH (TABLOCKX, HOLDLOCK)',
    );
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
