// Serves a fetch handler with node:http. Used by the local development server, the stubbed E2E backend and the
// manual's screenshot backend; production runs the same handler inside the Cloudflare Worker.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ApiHandler } from '../http/app';

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function toRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(name, item));
    } else if (typeof value === 'string') {
      headers.set(name, value);
    }
  }
  const method = (req.method ?? 'GET').toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(await readBody(req));
  return new Request(new URL(req.url ?? '/', origin), { method, headers, body });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

export interface RunningServer {
  baseUrl: string;
  close: () => Promise<void>;
}

/** Listens on 127.0.0.1 only; `port` 0 picks a free port. */
export async function serveFetchHandler(handler: ApiHandler, port: number): Promise<RunningServer> {
  const server: Server = createServer((req, res) => {
    toRequest(req, `http://127.0.0.1:${port}`)
      .then(handler)
      .then((response) => send(res, response))
      .catch(() => {
        res.statusCode = 500;
        res.end();
      });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: actualPort } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${actualPort}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
