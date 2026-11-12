import * as express from "express";
import * as request from "supertest";
import { createCompressionMiddleware } from "../apps/api-gateway/src/compression";

describe("Gateway response compression (e2e)", () => {
  const largeBody = {
    data: Array.from({ length: 200 }, (_, i) => ({
      id: `food-${i}`,
      name: { en: "Margarita pizza", fr: "Pizza margarita" },
    })),
  };
  const app = express();
  app.use(createCompressionMiddleware());
  app.get("/large", (_req, res) => {
    res.json(largeBody);
  });
  app.get("/small", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/stream", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.end("data: ".concat("x".repeat(4096), "\n\n"));
  });
  app.get("/icon.webp", (_req, res) => {
    res.type("image/webp").send(Buffer.alloc(4096, 1));
  });

  it("gzips large JSON when the client accepts gzip", async () => {
    const res = await request(app)
      .get("/large")
      .set("Accept-Encoding", "gzip")
      .expect(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.headers.vary).toMatch(/Accept-Encoding/i);
    expect(res.body).toEqual(largeBody);
  });

  it("sends plain JSON to clients that do not accept gzip", async () => {
    const res = await request(app)
      .get("/large")
      .set("Accept-Encoding", "identity")
      .expect(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body).toEqual(largeBody);
  });

  it("skips responses under the 1 KB threshold", async () => {
    const res = await request(app)
      .get("/small")
      .set("Accept-Encoding", "gzip")
      .expect(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("does not buffer server-sent event streams", async () => {
    const res = await request(app)
      .get("/stream")
      .set("Accept-Encoding", "gzip")
      .expect(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("does not re-compress images", async () => {
    const res = await request(app)
      .get("/icon.webp")
      .set("Accept-Encoding", "gzip")
      .expect(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
  });
});
