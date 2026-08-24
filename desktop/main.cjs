const { app: electronApp, BrowserWindow, dialog, shell } = require('electron');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');

let mainWindow = null;
let desktopServer = null;

function getAppRoot() {
  if (electronApp.isPackaged) {
    const asarRoot = path.join(process.resourcesPath, 'app.asar');
    if (pathExists(asarRoot)) return asarRoot;
    return path.join(process.resourcesPath, 'app');
  }
  return path.resolve(__dirname, '..');
}

function requireBffPackage(appRoot, packageName) {
  const candidates = [
    path.join(appRoot, 'node_modules', packageName),
    path.join(appRoot, 'bff', 'node_modules', packageName),
  ];
  for (const candidate of candidates) {
    if (pathExists(candidate)) return require(candidate);
  }
  throw new Error(`Missing packaged dependency: ${packageName}`);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function pathExists(value) {
  try {
    return fs.existsSync(value);
  } catch {
    return false;
  }
}

function prependBinaryPath(appRoot) {
  const candidates = [
    path.join(process.resourcesPath || '', 'bin'),
    path.join(appRoot, 'bin'),
  ].filter(Boolean);
  const existing = candidates.filter(pathExists);
  if (existing.length === 0) return;
  process.env.PATH = `${existing.join(path.delimiter)}${path.delimiter}${process.env.PATH || ''}`;
}

function joinUrlPath(left, right) {
  const normalizedLeft = left && left !== '/' ? left.replace(/\/+$/, '') : '';
  const normalizedRight = right && right !== '/' ? right.replace(/^\/+/, '') : '';
  if (!normalizedLeft && !normalizedRight) return '/';
  if (!normalizedLeft) return `/${normalizedRight}`;
  if (!normalizedRight) return normalizedLeft;
  return `${normalizedLeft}/${normalizedRight}`;
}

function rewritePath(originalUrl, sourcePrefix, targetPrefix = '') {
  const parsed = new URL(originalUrl, 'http://127.0.0.1');
  const suffix = parsed.pathname.slice(sourcePrefix.length) || '/';
  parsed.pathname = joinUrlPath(targetPrefix, suffix);
  return `${parsed.pathname}${parsed.search}`;
}

function proxyRequest(req, res, targetBase, targetPath) {
  const target = new URL(targetBase);
  const transport = target.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: target.host };

  const proxy = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: targetPath,
      headers,
      timeout: 900_000,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxy.on('timeout', () => {
    proxy.destroy(new Error('Proxy timeout'));
  });
  proxy.on('error', (error) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: `Desktop proxy error: ${error.message}` }));
  });

  req.pipe(proxy);
}

async function waitForBff(origin) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      // Keep probing until the local BFF is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('BFF did not become ready in time');
}

async function startBff(appRoot, bffPort, desktopOrigin) {
  process.env.BFF_PORT = String(bffPort);
  process.env.CORS_ORIGIN = desktopOrigin;
  process.env.VOICE_CORPUS_DIR ||= path.join(appRoot, 'voice_corpus', 'output');
  process.env.RENDER_WORK_DIR ||= path.join(electronApp.getPath('temp'), 'xiakeman-render-jobs');
  process.env.CLOUD_STORAGE_DIR ||= path.join(electronApp.getPath('userData'), 'cloud-store');
  process.env.AUTH_STORAGE_DIR ||= path.join(electronApp.getPath('userData'), 'auth-store');
  prependBinaryPath(appRoot);

  require(path.join(appRoot, 'bff', 'server.js'));
  await waitForBff(`http://127.0.0.1:${bffPort}`);
}

function createDesktopServer(appRoot, bffPort) {
  const express = requireBffPackage(appRoot, 'express');
  const serverApp = express();
  const bffOrigin = `http://127.0.0.1:${bffPort}`;
  const distDir = path.join(appRoot, 'dist');
  const indexHtml = path.join(distDir, 'index.html');

  serverApp.use('/api/prompt', (req, res) => {
    proxyRequest(req, res, bffOrigin, rewritePath(req.originalUrl, '/api/prompt', '/api'));
  });

  serverApp.use('/api/proxy', (req, res) => {
    proxyRequest(req, res, bffOrigin, req.originalUrl);
  });

  serverApp.use('/api/render', (req, res) => {
    proxyRequest(req, res, bffOrigin, req.originalUrl);
  });

  serverApp.use('/api/auth', (req, res) => {
    proxyRequest(req, res, bffOrigin, req.originalUrl);
  });

  serverApp.use('/api/admin', (req, res) => {
    proxyRequest(req, res, bffOrigin, req.originalUrl);
  });

  serverApp.use('/api/cloud', (req, res) => {
    proxyRequest(req, res, bffOrigin, req.originalUrl);
  });

  serverApp.use('/api/media', (req, res) => {
    proxyRequest(req, res, bffOrigin, req.originalUrl);
  });

  serverApp.use('/api/health', (req, res) => {
    proxyRequest(req, res, bffOrigin, req.originalUrl);
  });

  serverApp.use('/api/seedance', (req, res) => {
    proxyRequest(req, res, 'http://127.0.0.1:8033', rewritePath(req.originalUrl, '/api/seedance', '/api'));
  });

  serverApp.use('/api/seedance-cloud', (req, res) => {
    proxyRequest(req, res, 'http://127.0.0.1:8034', rewritePath(req.originalUrl, '/api/seedance-cloud', '/api'));
  });

  serverApp.use('/api/hm', (req, res) => {
    proxyRequest(req, res, 'https://api.huameng.space', rewritePath(req.originalUrl, '/api/hm', '/'));
  });

  serverApp.use('/api/volc', (req, res) => {
    proxyRequest(
      req,
      res,
      'https://ark.cn-beijing.volces.com',
      rewritePath(req.originalUrl, '/api/volc', '/api/v3'),
    );
  });

  serverApp.use(express.static(distDir, {
    index: false,
    maxAge: '1y',
    immutable: true,
  }));

  serverApp.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(indexHtml);
  });

  return serverApp;
}

async function startDesktopServer(appRoot, bffPort) {
  const port = await findFreePort();
  const serverApp = createDesktopServer(appRoot, bffPort);

  await new Promise((resolve, reject) => {
    desktopServer = serverApp.listen(port, '127.0.0.1', resolve);
    desktopServer.on('error', reject);
  });

  return `http://127.0.0.1:${port}`;
}

function createWindow(origin) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: 'Xiakeman',
    backgroundColor: '#09090b',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.loadURL(origin);
}

async function boot() {
  const appRoot = getAppRoot();
  const bffPort = await findFreePort();
  const desktopPort = await findFreePort();
  const desktopOrigin = `http://127.0.0.1:${desktopPort}`;

  await startBff(appRoot, bffPort, desktopOrigin);

  const serverApp = createDesktopServer(appRoot, bffPort);
  await new Promise((resolve, reject) => {
    desktopServer = serverApp.listen(desktopPort, '127.0.0.1', resolve);
    desktopServer.on('error', reject);
  });

  createWindow(desktopOrigin);
}

electronApp.whenReady().then(() => {
  boot().catch((error) => {
    dialog.showErrorBox('Xiakeman failed to start', error instanceof Error ? error.stack || error.message : String(error));
    electronApp.quit();
  });
});

electronApp.on('window-all-closed', () => {
  electronApp.quit();
});

electronApp.on('before-quit', () => {
  if (desktopServer) {
    desktopServer.close();
    desktopServer = null;
  }
});
