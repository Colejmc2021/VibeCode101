import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function base64UrlEncode(value: Buffer): string {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function GET(request: NextRequest): Promise<Response> {
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const redirectUri = process.env.SALESFORCE_REDIRECT_URI;
  const loginUrl = process.env.SALESFORCE_LOGIN_URL ?? "https://login.salesforce.com";

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        error: "Missing SALESFORCE_CLIENT_ID or SALESFORCE_REDIRECT_URI in environment.",
      },
      { status: 500 },
    );
  }

  const state = crypto.randomUUID();
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
  const isSecure = request.nextUrl.protocol === "https:";

  const cookieStore = await cookies();
  cookieStore.set("sf_oauth_state", state, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  cookieStore.set("sf_pkce_verifier", codeVerifier, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });

  const url = new URL("/services/oauth2/authorize", loginUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "api refresh_token");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return NextResponse.redirect(url);
}
