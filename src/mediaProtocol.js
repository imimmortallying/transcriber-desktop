const { pathToFileURL } = require("node:url");

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

function createMediaProtocolHandler({ resolveAuthorization, fetchFile, createResponse = (body, init) => new Response(body, init) }) {
  return async (request) => {
    const token = parseMediaProtocolToken(request.url);
    if (!token || !["GET", "HEAD"].includes(request.method)) {
      return createResponse("Not found", { status: 404 });
    }

    const authorization = await resolveAuthorization(token);
    if (!authorization) {
      return createResponse("Not found", { status: 404 });
    }

    return fetchFile(pathToFileURL(authorization.filePath).toString(), {
      method: request.method,
      headers: request.headers,
    });
  };
}

module.exports = {
  MEDIA_PROTOCOL_SCHEME,
  createMediaProtocolHandler,
  parseMediaProtocolToken,
};
