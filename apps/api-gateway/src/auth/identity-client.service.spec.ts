import { ConfigService } from "@nestjs/config";
import { ClientProxy } from "@nestjs/microservices";
import { NEVER, of, throwError } from "rxjs";
import { IDENTITY_PATTERNS } from "@app/common";
import { IdentityClientService } from "./identity-client.service";

describe("Gateway identity client", () => {
  const client = { send: jest.fn() };
  let identity: IdentityClientService;
  beforeEach(() => {
    jest.resetAllMocks();
    identity = new IdentityClientService(
      client as unknown as ClientProxy,
      new ConfigService({ IDENTITY_SERVICE_TIMEOUT_MS: 100 }),
    );
  });
  it("forwards token validation to identity", async () => {
    client.send.mockReturnValue(of({ customerId: "customer-1" }));
    await expect(identity.authenticate("token")).resolves.toEqual({
      customerId: "customer-1",
    });
    expect(client.send).toHaveBeenCalledWith(IDENTITY_PATTERNS.AUTHENTICATE, {
      token: "token",
    });
  });
  it.each([400, 401, 409, 503])(
    "preserves HTTP %s from RPC failures",
    async (statusCode) => {
      client.send.mockReturnValue(
        throwError(() => ({ statusCode, message: "Identity error" })),
      );
      await expect(identity.authenticate("token")).rejects.toMatchObject({
        status: statusCode,
      });
    },
  );
  it("preserves the inactive-account flag and code through RPC", async () => {
    client.send.mockReturnValue(
      throwError(() => ({
        statusCode: 403,
        code: "ACCOUNT_NOT_ACTIVATED",
        message: "Verify your email",
        details: { requiresEmailVerification: true },
      })),
    );
    await expect(
      identity.signin({ email: "member@example.com", password: "password" }),
    ).rejects.toMatchObject({
      code: "ACCOUNT_NOT_ACTIVATED",
      statusCode: 403,
      details: { requiresEmailVerification: true },
    });
  });
  it("fails closed on service disconnection", async () => {
    client.send.mockReturnValue(throwError(() => new Error("ECONNREFUSED")));
    await expect(identity.authenticate("token")).rejects.toMatchObject({
      status: 503,
    });
  });
  it("times out an unresponsive identity service", async () => {
    client.send.mockReturnValue(NEVER);
    await expect(identity.authenticate("token")).rejects.toMatchObject({
      status: 503,
    });
  });
});
