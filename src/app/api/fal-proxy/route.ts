import { NextRequest, NextResponse } from "next/server";

const FAL_KEY = process.env.FAL_KEY;

// Cap the body we log/return so a huge response (e.g. base64 image data)
// doesn't blow the server log or the client error UI.
const MAX_LOG_LEN = 2000;
function truncate(s: string, max = MAX_LOG_LEN) {
  return s.length > max ? s.slice(0, max) + `… (+${s.length - max} chars)` : s;
}

type ImageLike = { url?: string; content?: string };

export async function POST(req: NextRequest) {
  const { endpoint, body } = await req.json();

  // Whitelist only fal endpoints we use
  const allowed = [
    "fal-ai/flux/dev/image-to-image",
    "fal-ai/flux-pro/kontext",
  ];
  if (!allowed.includes(endpoint)) {
    return NextResponse.json({ error: "Endpoint not allowed" }, { status: 403 });
  }

  if (!FAL_KEY) {
    console.error("[/api/fal-proxy] FAL_KEY env var is not set");
    return NextResponse.json(
      { error: "FAL_KEY not configured on server" },
      { status: 500 },
    );
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`https://fal.run/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[/api/fal-proxy] fetch threw for ${endpoint}:`, msg);
    return NextResponse.json(
      { error: `fal.ai request failed: ${msg}`, endpoint },
      { status: 502 },
    );
  }

  // Read the raw body so we can log even when the JSON parser throws.
  const rawText = await res.text();
  const elapsedMs = Date.now() - started;

  let parsed: unknown = null;
  let parseError: string | null = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  // ── Non-2xx from fal.ai — log everything and bubble the detail up.
  if (!res.ok) {
    console.error(
      `[/api/fal-proxy] fal.ai ${res.status} ${res.statusText} for ${endpoint} after ${elapsedMs}ms`,
    );
    console.error(
      `[/api/fal-proxy] raw response body:\n${truncate(rawText) || "(empty)"}`,
    );
    return NextResponse.json(
      {
        error: `fal.ai returned ${res.status} ${res.statusText}`,
        status: res.status,
        endpoint,
        elapsed_ms: elapsedMs,
        fal_response: parsed ?? rawText.slice(0, MAX_LOG_LEN),
      },
      { status: 502 },
    );
  }

  // ── 2xx but JSON didn't parse.
  if (parseError) {
    console.error(
      `[/api/fal-proxy] fal.ai returned non-JSON 2xx for ${endpoint}. Parse error: ${parseError}`,
    );
    console.error(
      `[/api/fal-proxy] raw response body:\n${truncate(rawText) || "(empty)"}`,
    );
    return NextResponse.json(
      {
        error: `fal.ai returned non-JSON response (${parseError})`,
        endpoint,
        elapsed_ms: elapsedMs,
        raw: rawText.slice(0, MAX_LOG_LEN),
      },
      { status: 502 },
    );
  }

  // ── 2xx, parsed, but no image URL — still useful to know *why*.
  const data = (parsed ?? {}) as {
    images?: ImageLike[];
    image?: ImageLike;
    output?: { images?: ImageLike[] };
    error?: unknown;
    detail?: unknown;
  };
  const firstUrl =
    data.images?.[0]?.url ??
    data.image?.url ??
    data.output?.images?.[0]?.url ??
    null;

  if (!firstUrl) {
    console.error(
      `[/api/fal-proxy] fal.ai OK but no image URL in response for ${endpoint} after ${elapsedMs}ms`,
    );
    console.error(
      `[/api/fal-proxy] raw response body:\n${truncate(rawText) || "(empty)"}`,
    );
    return NextResponse.json(
      {
        ...data,
        error:
          typeof data.error === "string"
            ? data.error
            : typeof data.detail === "string"
              ? data.detail
              : "fal.ai returned 2xx but no image URL",
        endpoint,
        elapsed_ms: elapsedMs,
        fal_response: data,
      },
      { status: 502 },
    );
  }

  return NextResponse.json(data, { status: res.status });
}
