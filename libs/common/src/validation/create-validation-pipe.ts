import { ValidationPipe } from "@nestjs/common";

export const createValidationPipe = () =>
  new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  });
