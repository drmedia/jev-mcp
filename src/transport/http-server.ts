import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JevCore } from "../core/jev-core.js";
import { createJevMcpServer } from "../mcp/server.js";
import type { Logger } from "../observability/logger.js";

/** The single MCP endpoint path. */
export const MCP_PATH = "/mcp";

/** The default listen address. `0.0.0.0` is allowed only inside a container (AGENTS.md Phase 11). */
export const HTTP_BIND_ADDRESS = "127.0.0.1";

/**
 * Largest accepted request body. A single request may carry 8 MiB of images, which
 * base64 makes about 11 MB; batches with several image items need more. Larger
 * image sets should use `images[].path` instead of `data`.
 */
export const MAX_HTTP_BODY_BYTES = 32 * 1024 * 1024;

const LOOPBACK_HOSTNAMES = ["127.0.0.1", "localhost", "[::1]"];

export interface JevHttpServerOptions {
  core: JevCore;
  /** Shared secret every request must present as a Bearer token. */
  token: string;
  logger: Logger;
  maxBodyBytes?: number;
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time comparison; hashing first makes the lengths equal. */
function tokenMatches(header: string | undefined, expectedDigest: Buffer): boolean {
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
  if (!match) return false;
  return timingSafeEqual(sha256(match[1]!), expectedDigest);
}

/** Host and Origin values a loopback client on `port` sends. */
function loopbackValues(port: number): { hosts: Set<string>; origins: Set<string> } {
  const hosts = new Set(LOOPBACK_HOSTNAMES.map((name) => `${name}:${port}`));
  const origins = new Set(LOOPBACK_HOSTNAMES.map((name) => `http://${name}:${port}`));
  return { hosts, origins };
}

/** A JSON-RPC error response without an id, as the transport specification allows. */
function reject(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  const body = JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body);
}

/**
 * Handles one HTTP request. The server is stateless: each POST gets its own MCP
 * server and transport over the shared JEV Core, as in the SDK's stateless examples.
 */
export function createJevHttpRequestListener(
  options: JevHttpServerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { core, logger } = options;
  const expectedDigest = sha256(options.token);
  const maxRequestBodySize = options.maxBodyBytes ?? MAX_HTTP_BODY_BYTES;

  return async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== MCP_PATH) {
      reject(res, 404, `Not found; the MCP endpoint is ${MCP_PATH}`);
      return;
    }

    // DNS rebinding protection: only loopback names for the port actually in use.
    const { hosts, origins } = loopbackValues(req.socket.localPort ?? 0);
    if (!hosts.has((req.headers.host ?? "").toLowerCase())) {
      logger.warn(`Rejected a request with Host ${JSON.stringify(req.headers.host ?? "")}`);
      reject(res, 403, "Forbidden: the Host header must be a loopback address");
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin.toLowerCase())) {
      logger.warn(`Rejected a request with Origin ${JSON.stringify(origin)}`);
      reject(res, 403, "Forbidden: the Origin header must be a loopback origin");
      return;
    }

    if (!tokenMatches(req.headers.authorization, expectedDigest)) {
      // The header value is never logged.
      logger.warn("Rejected a request without a valid bearer token");
      reject(res, 401, "Unauthorized: send Authorization: Bearer <JEV_HTTP_TOKEN>", {
        "WWW-Authenticate": 'Bearer realm="jev-mcp"',
      });
      return;
    }

    if (req.method !== "POST") {
      // No SSE stream and no sessions: GET and DELETE are not offered.
      reject(res, 405, "Method not allowed; send JSON-RPC messages with POST", { Allow: "POST" });
      return;
    }

    const server = createJevMcpServer(core, { logger });
    // No sessionIdGenerator: stateless mode. JSON responses: nothing is streamed.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      // The SDK's own optional callback types differ under exactOptionalPropertyTypes.
      await server.connect(transport as Transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      logger.error("Unexpected error while handling an HTTP request", error);
      if (!res.headersSent) reject(res, 500, "Internal server error");
      else res.end();
    }
  };
}

/** Creates the HTTP server; the caller listens on `HTTP_BIND_ADDRESS`. */
export function createJevHttpServer(options: JevHttpServerOptions): Server {
  const listener = createJevHttpRequestListener(options);
  return createServer((req, res) => {
    void listener(req, res);
  });
}
