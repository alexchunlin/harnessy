import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { ApiError, createApi, type Api } from "./api";

export const API_PREFIX = "/__harnessy";

/**
 * Vite plugin serving the file API. Engineers run Vite locally anyway, so
 * every browser gets folder access through it instead of the Chromium-only
 * File System Access API.
 */
export function harnessyServer(options: { home?: string } = {}): Plugin {
  let api: Api;
  return {
    name: "harnessy-server",
    configResolved(config) {
      api = createApi({ home: options.home ?? process.env.HARNESSY_HOME, repoLibrary: path.resolve(config.root, "library") });
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(API_PREFIX)) return next();
        try {
          const result = await route(api, req);
          json(res, 200, result);
        } catch (e) {
          if (e instanceof ApiError) json(res, e.status, { error: e.message });
          else json(res, 500, { error: (e as Error).message });
        }
      });
    },
  };
}

async function route(api: Api, req: IncomingMessage): Promise<unknown> {
  const url = new URL(req.url!, "http://localhost");
  const op = url.pathname.slice(API_PREFIX.length);
  const body = req.method === "POST" ? ((await readJson(req)) as Record<string, unknown>) : {};
  switch (`${req.method} ${op}`) {
    case "GET /home":
      return { home: api.home() };
    case "GET /list":
      return api.list(url.searchParams.get("path") ?? undefined);
    case "POST /open":
      return api.open(String(body.path));
    case "GET /read":
      return { text: await api.read(url.searchParams.get("root")!, url.searchParams.get("path")!) };
    case "POST /write":
      await api.write(String(body.root), (body.files as Record<string, string>) ?? {}, (body.remove as string[]) ?? []);
      return { ok: true };
    case "GET /library":
      return { files: await api.library() };
    default:
      throw new ApiError(404, `no route ${req.method} ${op}`);
  }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new ApiError(400, `bad JSON body: ${(e as Error).message}`));
      }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}
