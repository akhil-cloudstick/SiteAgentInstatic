import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';

import {
  resolveBrowserNetworkTarget,
  type BrowserNetworkPolicy,
} from './browser-network-policy.js';

export interface BrowserNetworkProxy {
  close: () => Promise<void>;
  port: number;
}

function proxyErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requestUrl(request: IncomingMessage, fallbackProtocol = 'http:'): URL {
  const raw = request.url ?? '';
  if (/^https?:\/\//i.test(raw)) return new URL(raw);
  if (/^wss?:\/\//i.test(raw)) {
    const parsed = new URL(raw);
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    return parsed;
  }
  const host = request.headers.host;
  if (!host) throw new Error('proxy request is missing Host');
  return new URL(`${fallbackProtocol}//${host}${raw.startsWith('/') ? raw : `/${raw}`}`);
}

function upstreamHeaders(request: IncomingMessage, host: string): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...request.headers, host };
  delete headers['proxy-authorization'];
  delete headers['proxy-connection'];
  return headers;
}

function writeProxyFailure(socket: Duplex, status: number, message: string): void {
  if (socket.destroyed) return;
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Bad Gateway'}\r\n`
    + 'Content-Type: text/plain; charset=utf-8\r\n'
    + `Content-Length: ${Buffer.byteLength(body)}\r\n`
    + 'Connection: close\r\n\r\n'
    + body,
  );
}

/**
 * Chrome is forced through this loopback proxy with its implicit localhost
 * bypass removed. The proxy resolves and connects to the exact vetted address,
 * closing the DNS-rebinding gap between URL validation and Chromium's socket.
 */
export async function createBrowserNetworkProxy(
  policy: BrowserNetworkPolicy = {},
): Promise<BrowserNetworkProxy> {
  const tunnels = new Set<Duplex>();
  const server = http.createServer((request, response) => {
    void proxyHttpRequest(request, response, policy);
  });

  server.on('connect', (request, client, head) => {
    void proxyConnect(request, client, head, policy, tunnels);
  });
  server.on('upgrade', (request, client, head) => {
    void proxyUpgrade(request, client, head, policy, tunnels);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('browser network proxy did not bind a TCP port');
  }

  return {
    port: address.port,
    close: async () => {
      for (const socket of tunnels) socket.destroy();
      tunnels.clear();
      if (!server.listening) return;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function proxyHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  policy: BrowserNetworkPolicy,
): Promise<void> {
  try {
    const target = await resolveBrowserNetworkTarget(requestUrl(request).href, policy);
    const upstream = http.request({
      family: target.family,
      headers: upstreamHeaders(request, target.url.host),
      host: target.address,
      method: request.method,
      path: `${target.url.pathname}${target.url.search}`,
      port: target.url.port ? Number(target.url.port) : 80,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.once('error', (error) => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`browser proxy upstream failed: ${proxyErrorMessage(error)}\n`);
    });
    request.pipe(upstream);
  } catch (error) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`browser proxy blocked request: ${proxyErrorMessage(error)}\n`);
  }
}

async function proxyConnect(
  request: IncomingMessage,
  client: Duplex,
  head: Buffer,
  policy: BrowserNetworkPolicy,
  tunnels: Set<Duplex>,
): Promise<void> {
  try {
    const authority = request.url ?? '';
    const target = await resolveBrowserNetworkTarget(`https://${authority}`, policy);
    const upstream = net.connect({
      family: target.family,
      host: target.address,
      port: target.url.port ? Number(target.url.port) : 443,
    });
    trackTunnel(client, upstream, tunnels);
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.once('error', (error) => writeProxyFailure(client, 502, proxyErrorMessage(error)));
  } catch (error) {
    writeProxyFailure(client, 403, `browser proxy blocked tunnel: ${proxyErrorMessage(error)}`);
  }
}

async function proxyUpgrade(
  request: IncomingMessage,
  client: Duplex,
  head: Buffer,
  policy: BrowserNetworkPolicy,
  tunnels: Set<Duplex>,
): Promise<void> {
  try {
    const target = await resolveBrowserNetworkTarget(requestUrl(request).href, policy);
    const upstream = net.connect({
      family: target.family,
      host: target.address,
      port: target.url.port ? Number(target.url.port) : 80,
    });
    trackTunnel(client, upstream, tunnels);
    upstream.once('connect', () => {
      const headers = upstreamHeaders(request, target.url.host);
      const serialized = Object.entries(headers)
        .filter(([, value]) => value != null)
        .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
        .join('\r\n');
      upstream.write(
        `${request.method ?? 'GET'} ${target.url.pathname}${target.url.search} HTTP/${request.httpVersion}\r\n`
        + `${serialized}\r\n\r\n`,
      );
      if (head.length > 0) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.once('error', (error) => writeProxyFailure(client, 502, proxyErrorMessage(error)));
  } catch (error) {
    writeProxyFailure(client, 403, `browser proxy blocked upgrade: ${proxyErrorMessage(error)}`);
  }
}

function trackTunnel(client: Duplex, upstream: Duplex, tunnels: Set<Duplex>): void {
  tunnels.add(client);
  tunnels.add(upstream);
  const forget = () => {
    tunnels.delete(client);
    tunnels.delete(upstream);
  };
  client.once('close', forget);
  upstream.once('close', forget);
}
