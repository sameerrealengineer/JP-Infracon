import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { createCorsMiddleware } from "./cors";

type ResponseProbe = {
  headers: Record<string, string>;
  statusCode: number;
  body?: unknown;
  vary: (name: string) => ResponseProbe;
  header: (name: string, value: string) => ResponseProbe;
  status: (code: number) => ResponseProbe;
  json: (body: unknown) => ResponseProbe;
  sendStatus: (code: number) => ResponseProbe;
};

function invokeCors(origin?: string, method = "OPTIONS") {
  const response: ResponseProbe = {
    headers: {},
    statusCode: 200,
    vary: () => response,
    header: (name, value) => { response.headers[name.toLowerCase()] = value; return response; },
    status: (code) => { response.statusCode = code; return response; },
    json: (body) => { response.body = body; return response; },
    sendStatus: (code) => { response.statusCode = code; return response; },
  };
  const request = {
    headers: origin ? {
      origin,
      "access-control-request-headers": "content-type,x-jp-client-platform",
    } : {},
    method,
    hostname: "api.example",
  } as unknown as Request;
  let nextCalled = false;
  createCorsMiddleware(new Set(["https://preview.example"]), () => false)(
    request,
    response as unknown as Response,
    () => { nextCalled = true; },
  );
  return { response, nextCalled };
}

describe("Expo Preview CORS", () => {
  it("allows the app platform header for a trusted Preview preflight", () => {
    const { response, nextCalled } = invokeCors("https://preview.example");
    const allowedHeaders = response.headers["access-control-allow-headers"]
      .split(",")
      .map((header) => header.trim().toLowerCase());

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://preview.example");
    expect(allowedHeaders).toContain("x-jp-client-platform");
    expect(nextCalled).toBe(false);
  });

  it("continues to reject an untrusted browser origin", () => {
    const { response, nextCalled } = invokeCors("https://untrusted.example");

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ error: "origin_not_allowed" });
    expect(nextCalled).toBe(false);
  });

  it("allows native requests that do not carry an Origin header", () => {
    const { response, nextCalled } = invokeCors(undefined, "GET");

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(nextCalled).toBe(true);
  });
});
