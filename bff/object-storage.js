const crypto = require('crypto');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { getEffectiveObjectStorageConfig } = require('./commercial-settings');

const LOCAL_OBJECT_ROOT = process.env.OBJECT_STORAGE_LOCAL_DIR
  || path.join(os.tmpdir(), 'xiakeman-object-store');
const COS_CONNECTION_TIMEOUT_MS = Number(process.env.COS_CONNECTION_TIMEOUT_MS || 15_000);
const COS_REQUEST_TIMEOUT_MS = Number(process.env.COS_REQUEST_TIMEOUT_MS || 180_000);
const COS_MAX_ATTEMPTS = Math.max(1, Number(process.env.COS_MAX_ATTEMPTS || 3));
const COS_SIGNED_PUT_URL_TTL_SECONDS = Math.min(
  3600,
  Math.max(60, Number(process.env.COS_SIGNED_URL_TTL_SECONDS || 900)),
);
const COS_SIGNED_GET_URL_TTL_SECONDS = Math.min(
  604800,
  Math.max(60, Number(process.env.COS_SIGNED_GET_URL_TTL_SECONDS || 604800)),
);

let cosClient;
let cosClientSignature;

function getObjectStorageDriver() {
  return String(process.env.OBJECT_STORAGE_DRIVER || process.env.MEDIA_STORAGE_DRIVER || 'local').toLowerCase();
}

function sanitizeObjectKey(key) {
  const text = String(key || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!text || text.includes('..')) throw new Error('Invalid object key');
  return text;
}

async function getTencentCosConfig(overrideConfig) {
  const config = await getEffectiveObjectStorageConfig(overrideConfig);
  const SecretId = config.secretId;
  const SecretKey = config.secretKey;
  const Bucket = config.bucket;
  const Region = config.region;
  const Endpoint = config.endpoint;
  const Prefix = String(config.prefix || '').replace(/^\/+|\/+$/g, '');

  if (!SecretId || !SecretKey || !Bucket || !Region) {
    throw new Error('TENCENT_COS_SECRET_ID, TENCENT_COS_SECRET_KEY, TENCENT_COS_BUCKET and TENCENT_COS_REGION are required');
  }

  return { SecretId, SecretKey, Bucket, Region, Endpoint, Prefix };
}

function resetObjectStorageClient() {
  cosClient = undefined;
  cosClientSignature = undefined;
}

async function getCosClient(overrideConfig) {
  const config = await getTencentCosConfig(overrideConfig);
  const signature = [
    config.SecretId,
    config.SecretKey,
    config.Bucket,
    config.Region,
    config.Endpoint,
  ].join('\n');

  if (!cosClient || cosClientSignature !== signature) {
    const { S3Client } = require('@aws-sdk/client-s3');
    const { NodeHttpHandler } = require('@smithy/node-http-handler');
    cosClient = new S3Client({
      region: config.Region,
      endpoint: config.Endpoint || `https://cos.${config.Region}.myqcloud.com`,
      credentials: {
        accessKeyId: config.SecretId,
        secretAccessKey: config.SecretKey,
      },
      forcePathStyle: false,
      maxAttempts: COS_MAX_ATTEMPTS,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: COS_CONNECTION_TIMEOUT_MS,
        requestTimeout: COS_REQUEST_TIMEOUT_MS,
        throwOnRequestTimeout: true,
      }),
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    cosClientSignature = signature;
  }
  return { client: cosClient, config };
}

function withCosPrefix(key, config) {
  const Prefix = String(config.Prefix || '').replace(/^\/+|\/+$/g, '');
  const cleanKey = sanitizeObjectKey(key);
  return Prefix ? `${Prefix}/${cleanKey}` : cleanKey;
}

function isRetryableCosError(error) {
  const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || 0);
  const code = String(error?.code || error?.name || '');
  return status >= 500
    || error?.$retryable
    || ['AbortError', 'TimeoutError', 'RequestTimeout', 'UserNetworkTooSlow', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(code);
}

function formatCosError(error, operation) {
  const status = error?.$metadata?.httpStatusCode;
  const code = error?.Code || error?.code || error?.name;
  const message = error?.message || String(error);
  const statusPart = status ? `HTTP ${status}` : '';
  const codePart = code ? String(code) : '';
  const detail = [statusPart, codePart, message].filter(Boolean).join(' ');
  return new Error(`${operation} failed: ${detail || 'unknown COS error'}`);
}

async function sendCosCommand(command, operation, overrideConfig) {
  let lastError;
  for (let attempt = 1; attempt <= COS_MAX_ATTEMPTS; attempt += 1) {
    const { client } = await getCosClient(overrideConfig);
    try {
      return await client.send(command);
    } catch (error) {
      lastError = error;
      resetObjectStorageClient();
      if (attempt >= COS_MAX_ATTEMPTS || !isRetryableCosError(error)) {
        throw formatCosError(error, operation);
      }
    }
  }
  throw formatCosError(lastError, operation);
}

async function streamToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }

  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function putLocalObject(key, buffer) {
  const objectKey = sanitizeObjectKey(key);
  const filePath = path.join(LOCAL_OBJECT_ROOT, objectKey);
  const resolvedRoot = path.resolve(LOCAL_OBJECT_ROOT);
  const resolvedPath = path.resolve(filePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Invalid local object path');
  }
  await fsp.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fsp.writeFile(resolvedPath, buffer);
}

async function getLocalObject(key) {
  const objectKey = sanitizeObjectKey(key);
  const filePath = path.join(LOCAL_OBJECT_ROOT, objectKey);
  return await fsp.readFile(filePath);
}

async function deleteLocalObject(key) {
  const objectKey = sanitizeObjectKey(key);
  await fsp.rm(path.join(LOCAL_OBJECT_ROOT, objectKey), { force: true });
}

async function resolveObjectStorageDriver(overrideConfig) {
  if (overrideConfig && typeof overrideConfig === 'object') {
    const config = await getEffectiveObjectStorageConfig(overrideConfig);
    return config.driver;
  }
  return (await getEffectiveObjectStorageConfig()).driver;
}

async function getDirectObjectStorageStatus(overrideConfig) {
  const driver = await resolveObjectStorageDriver(overrideConfig);
  if (driver !== 'tencent-cos' && driver !== 'cos') {
    return { enabled: false, driver };
  }

  const { config } = await getCosClient(overrideConfig);
  return {
    enabled: true,
    driver: 'tencent-cos',
    bucket: config.Bucket,
    region: config.Region,
    endpoint: config.Endpoint || `https://cos.${config.Region}.myqcloud.com`,
    prefix: config.Prefix,
    signedUrlTtlSeconds: COS_SIGNED_GET_URL_TTL_SECONDS,
  };
}

async function createSignedPutUrl(key, contentType = 'application/octet-stream', expiresIn = COS_SIGNED_PUT_URL_TTL_SECONDS, overrideConfig) {
  const objectKey = sanitizeObjectKey(key);
  const driver = await resolveObjectStorageDriver(overrideConfig);
  if (driver !== 'tencent-cos' && driver !== 'cos') {
    throw new Error('Direct upload requires Tencent COS object storage');
  }

  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const { client, config } = await getCosClient(overrideConfig);
  const command = new PutObjectCommand({
    Bucket: config.Bucket,
    Key: withCosPrefix(objectKey, config),
    ContentType: contentType || 'application/octet-stream',
  });
  const ttl = Math.min(COS_SIGNED_PUT_URL_TTL_SECONDS, Math.max(60, Number(expiresIn || COS_SIGNED_PUT_URL_TTL_SECONDS)));
  return {
    method: 'PUT',
    url: await getSignedUrl(client, command, { expiresIn: ttl }),
    headers: {
      'Content-Type': contentType || 'application/octet-stream',
    },
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
  };
}

async function createSignedGetUrl(key, expiresIn = COS_SIGNED_GET_URL_TTL_SECONDS, overrideConfig) {
  const objectKey = sanitizeObjectKey(key);
  const driver = await resolveObjectStorageDriver(overrideConfig);
  if (driver !== 'tencent-cos' && driver !== 'cos') {
    throw new Error('Direct download requires Tencent COS object storage');
  }

  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const { client, config } = await getCosClient(overrideConfig);
  const ttl = Math.min(COS_SIGNED_GET_URL_TTL_SECONDS, Math.max(60, Number(expiresIn || COS_SIGNED_GET_URL_TTL_SECONDS)));
  const command = new GetObjectCommand({
    Bucket: config.Bucket,
    Key: withCosPrefix(objectKey, config),
  });
  return {
    method: 'GET',
    url: await getSignedUrl(client, command, { expiresIn: ttl }),
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
  };
}

async function createPublicObjectUrl(key, overrideConfig) {
  const objectKey = sanitizeObjectKey(key);
  const driver = await resolveObjectStorageDriver(overrideConfig);
  if (driver !== 'tencent-cos' && driver !== 'cos') {
    throw new Error('Public object URLs require Tencent COS object storage');
  }
  const config = await getTencentCosConfig(overrideConfig);
  const fullKey = withCosPrefix(objectKey, config);
  const host = `${config.Bucket}.cos.${config.Region}.myqcloud.com`;
  return `https://${host}/${fullKey.split('/').map(encodeURIComponent).join('/')}`;
}

async function headObject(key, overrideConfig) {
  const objectKey = sanitizeObjectKey(key);
  const driver = await resolveObjectStorageDriver(overrideConfig);
  if (driver === 'tencent-cos' || driver === 'cos') {
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    const { config } = await getCosClient(overrideConfig);
    const data = await sendCosCommand(new HeadObjectCommand({
      Bucket: config.Bucket,
      Key: withCosPrefix(objectKey, config),
    }), 'COS HeadObject', overrideConfig);
    return {
      contentLength: Number(data.ContentLength || 0),
      contentType: data.ContentType || 'application/octet-stream',
      etag: data.ETag || '',
      lastModified: data.LastModified,
    };
  }

  const buffer = await getLocalObject(objectKey);
  return {
    contentLength: buffer.byteLength,
    contentType: 'application/octet-stream',
    etag: '',
    lastModified: undefined,
  };
}

async function putObjectBuffer(key, buffer, contentType = 'application/octet-stream', overrideConfig) {
  const objectKey = sanitizeObjectKey(key);
  const driver = await resolveObjectStorageDriver(overrideConfig);

  if (driver === 'tencent-cos' || driver === 'cos') {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const { config } = await getCosClient(overrideConfig);
    const putParams = {
      Bucket: config.Bucket,
      Key: withCosPrefix(objectKey, config),
      Body: buffer,
      ContentType: contentType,
      ContentLength: buffer.byteLength,
    };
    if (overrideConfig?.publicRead || overrideConfig?.acl === 'public-read') {
      putParams.ACL = 'public-read';
    }
    await sendCosCommand(new PutObjectCommand(putParams), 'COS PutObject', overrideConfig);
    return;
  }

  await putLocalObject(objectKey, buffer);
}

async function getObjectBuffer(key, overrideConfig) {
  const objectKey = sanitizeObjectKey(key);
  const driver = await resolveObjectStorageDriver(overrideConfig);

  if (driver === 'tencent-cos' || driver === 'cos') {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { config } = await getCosClient(overrideConfig);
    const data = await sendCosCommand(new GetObjectCommand({
      Bucket: config.Bucket,
      Key: withCosPrefix(objectKey, config),
    }), 'COS GetObject', overrideConfig);
    return await streamToBuffer(data.Body);
  }

  return await getLocalObject(objectKey);
}

async function deleteObjects(keys, overrideConfig) {
  const cleanKeys = [...new Set((keys || []).filter(Boolean).map(sanitizeObjectKey))];
  if (cleanKeys.length === 0) return;

  const driver = await resolveObjectStorageDriver(overrideConfig);
  if (driver === 'tencent-cos' || driver === 'cos') {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const { config } = await getCosClient(overrideConfig);
    await Promise.all(cleanKeys.map((key) => sendCosCommand(new DeleteObjectCommand({
      Bucket: config.Bucket,
      Key: withCosPrefix(key, config),
    }), 'COS DeleteObject', overrideConfig).catch(() => undefined)));
    return;
  }

  await Promise.all(cleanKeys.map((key) => deleteLocalObject(key).catch(() => undefined)));
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function getObjectStorageStatus() {
  const config = await getEffectiveObjectStorageConfig();
  const driver = config.driver;
  if (driver === 'tencent-cos' || driver === 'cos') {
    return {
      driver: 'tencent-cos',
      bucket: config.bucket,
      region: config.region,
      endpoint: config.endpoint || `https://cos.${config.region}.myqcloud.com`,
      prefix: config.prefix,
      source: config.source,
      secretIdMasked: config.secretId
        ? `${config.secretId.slice(0, 4)}...${config.secretId.slice(-4)}`
        : '',
      secretKeySet: !!config.secretKey,
    };
  }
  return {
    driver: 'local',
    root: LOCAL_OBJECT_ROOT,
  };
}

async function testObjectStorageConfig(overrideConfig) {
  const key = `admin-config-test/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.txt`;
  const expected = `xiakeman-object-storage-test-${new Date().toISOString()}`;
  await putObjectBuffer(key, Buffer.from(expected, 'utf8'), 'text/plain', overrideConfig);
  const actual = (await getObjectBuffer(key, overrideConfig)).toString('utf8');
  if (actual !== expected) throw new Error('Object storage roundtrip mismatch');
  await deleteObjects([key], overrideConfig);
  return { key };
}

module.exports = {
  createPublicObjectUrl,
  createSignedGetUrl,
  createSignedPutUrl,
  deleteObjects,
  getDirectObjectStorageStatus,
  getObjectBuffer,
  getObjectStorageDriver,
  getObjectStorageStatus,
  headObject,
  putObjectBuffer,
  resetObjectStorageClient,
  sha256,
  testObjectStorageConfig,
};
