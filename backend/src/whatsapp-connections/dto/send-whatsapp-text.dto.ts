import { IsString, Matches, MaxLength } from 'class-validator';

export class SendWhatsappTextDto {
  @IsString({ message: 'textContent deve ser um texto.' })
  @Matches(/\S/, { message: 'textContent não pode estar vazio.' })
  @MaxLength(4000, {
    message: 'textContent deve ter no máximo 4000 caracteres.',
  })
  textContent: string;
}
