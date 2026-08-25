const { createReadStream } = require("node:fs");
const { stat } = require("node:fs/promises");
const { Readable } = require("node:stream");

const MEDIA_PROTOCOL_SCHEME = "asr-media";

function parseMediaProtocolToken(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${MEDIA_PROTOCOL_SCHEME}:` || !parsed.hostname || parsed.pathname !== "/source") {
      return null;
    }
    return parsed.hostname;
  } catch {
    return null;
  }
}

function getHeader(headers, name) {
  if (typeof headers?.get === "function") {
    return headers.get(name);
  }
  return Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || null;
}

function parseSingleByteRange(value, size) {
  if (!value) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value).trim());
  if (!match || size <= 0) {
    return { invalid: true };
  }
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) {
    return { invalid: true };
  }
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { invalid: true };
    }
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) {
    return { invalid: true };
  }
  return { start, end: Math.min(size - 1, requestedEnd) };
}

function createMediaProtocolHandler({
  resolveAuthorization,
  statFile = stat,
  createFileStream = createReadStream,
  toWebStream = Readable.toWeb,
  createResponse = (body, init) => new Response(body, init),
}) {
  return async (request) => {
    const token = parseMediaProtocolToken(request.url);
    if (!token || !["GET", "HEAD"].includes(request.method)) {
      return createResponse("Not found", { status: 404 });
    }

    const authorization = await resolveAuthorization(token);
    if (!authorization) {
      return createResponse("Not found", { status: 404 });
    }

    let fileInfo;
    try {
      fileInfo = await statFile(authorization.filePath);
    } catch {
      return createResponse("Not found", { status: 404 });
    }
    if (!fileInfo.isFile()) {
      return createResponse("Not found", { status: 404 });
    }

    const range = parseSingleByteRange(getHeader(request.headers, "range"), fileInfo.size);
    if (range?.invalid) {
      return createResponse(null, {
        status: 416,
        headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${fileInfo.size}` },
      });
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? fileInfo.size - 1;
    const headers = {
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
    };
    if (range) {
      headers["Content-Range"] = `bytes ${start}-${end}/${fileInfo.size}`;
    }
    const body = request.method === "HEAD" || fileInfo.size === 0
      ? null
      : toWebStream(createFileStream(authorization.filePath, { start, end }));
    return createResponse(body, { status: range ? 206 : 200, headers });
  };
}

module.exports = {
  MEDIA_PROTOCOL_SCHEME,
  createMediaProtocolHandler,
  parseSingleByteRange,
  parseMediaProtocolToken,
};
