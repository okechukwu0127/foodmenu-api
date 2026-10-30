import { Injectable } from "@nestjs/common";
import { Request } from "express";
import { IdentityClientService } from "../../auth/identity-client.service";
import { fail } from "../persistence/contracts";

export type Actor = { customerId?: string; guestToken?: string };
@Injectable()
export class ConciergeAccessService {
  constructor(private readonly identity: IdentityClientService) {}
  async actor(req: Request, required = false): Promise<Actor> {
    const auth = req.headers.authorization;
    if (auth !== undefined) {
      const match = /^Bearer ([a-f0-9]{64})$/i.exec(auth);
      if (!match) fail("AI_UNAUTHORIZED", "Invalid bearer session", 401);
      const login = await this.identity.authenticate(match[1]);
      return { customerId: login.customerId };
    }
    if (required) fail("AI_UNAUTHORIZED", "A bearer session is required", 401);
    const guestToken = req.get("X-AI-Guest-Token");
    if (guestToken !== undefined && !/^[a-f0-9]{64}$/.test(guestToken))
      fail("AI_UNAUTHORIZED", "Invalid guest token", 401);
    return { guestToken };
  }
}
