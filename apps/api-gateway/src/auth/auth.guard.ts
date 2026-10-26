import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { IdentityClientService } from "./identity-client.service";
import { IdentityLogin } from "@app/dto";
export type Login = IdentityLogin;

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: IdentityClientService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const match = /^Bearer ([a-f0-9]{64})$/i.exec(
      req.headers.authorization ?? "",
    );
    if (!match)
      throw new UnauthorizedException(
        "Provide a login token in Authorization: Bearer <token>",
      );
    req.login = await this.auth.authenticate(match[1]);
    return true;
  }
}
export const CurrentLogin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Login =>
    context.switchToHttp().getRequest().login,
);
