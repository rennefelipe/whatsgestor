import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;
const BCRYPT_MAX_PASSWORD_BYTES = 72;

export function isPasswordWithinHashLimit(password: string): boolean {
  return Buffer.byteLength(password, 'utf8') <= BCRYPT_MAX_PASSWORD_BYTES;
}

export function hashPassword(password: string): Promise<string> {
  if (!isPasswordWithinHashLimit(password)) {
    throw new BadRequestException(
      'A senha não pode exceder 72 bytes em UTF-8.',
    );
  }
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
