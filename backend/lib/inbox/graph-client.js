/**
 * Microsoft Graph API helper with 429 retry.
 */

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function graphGet(pathWithQuery, accessToken, attempt = 0) {
  const url = pathWithQuery.startsWith("http")
    ? pathWithQuery
    : `https://graph.microsoft.com/v1.0${pathWithQuery.startsWith("/") ? "" : "/"}${pathWithQuery}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.body-content-type="html"',
    },
  });
  if (res.status === 429 && attempt < 4) {
    const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
    await sleep(Math.min(retryAfter * 1000, 30_000));
    return graphGet(pathWithQuery, accessToken, attempt + 1);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Graph ${res.status}: ${json.error?.message || json.error || res.statusText}`);
    err.status = res.status;
    err.graphCode = json.error?.code;
    throw err;
  }
  return json;
}

export async function graphPost(path, accessToken, body, attempt = 0) {
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429 && attempt < 4) {
    const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
    await sleep(Math.min(retryAfter * 1000, 30_000));
    return graphPost(path, accessToken, body, attempt + 1);
  }
  if (res.status === 202 || res.status === 204) {
    return {};
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Graph ${res.status}: ${json.error?.message || json.error || res.statusText}`);
    err.status = res.status;
    err.graphCode = json.error?.code;
    throw err;
  }
  return json;
}

export async function graphPatch(path, accessToken, body, attempt = 0) {
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 429 && attempt < 4) {
    const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
    await sleep(Math.min(retryAfter * 1000, 30_000));
    return graphPatch(path, accessToken, body, attempt + 1);
  }
  if (res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Graph ${res.status}: ${json.error?.message || json.error || res.statusText}`);
    err.status = res.status;
    err.graphCode = json.error?.code;
    throw err;
  }
  return json;
}
