import { NextRequest, NextResponse } from "next/server";

const FAL_KEY = process.env.FAL_KEY;

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

  const res = await fetch(`https://fal.run/${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
