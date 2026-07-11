import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type SalesforceTokenResponse = {
  access_token?: string;
  instance_url?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

export async function GET(request: NextRequest): Promise<Response> {
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
  const redirectUri = process.env.SALESFORCE_REDIRECT_URI;
  const loginUrl = process.env.SALESFORCE_LOGIN_URL ?? "https://login.salesforce.com";
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("sf_oauth_state")?.value;
  const codeVerifier = cookieStore.get("sf_pkce_verifier")?.value;

  if (!code || !clientId || !clientSecret || !redirectUri || !codeVerifier) {
    return NextResponse.json(
      {
        error: "Missing OAuth callback code, PKCE verifier, or Salesforce OAuth environment variables.",
      },
      { status: 400 },
    );
  }

  if (!returnedState || !expectedState || returnedState !== expectedState) {
    return NextResponse.json(
      {
        error: "OAuth state validation failed.",
      },
      { status: 400 },
    );
  }

  const tokenUrl = new URL("/services/oauth2/token", loginUrl);
  const tokenResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  const tokenPayload = (await tokenResponse.json()) as SalesforceTokenResponse;
  if (!tokenResponse.ok || !tokenPayload.access_token || !tokenPayload.instance_url) {
    return NextResponse.json(
      {
        error: tokenPayload.error_description ?? tokenPayload.error ?? "Failed to exchange Salesforce OAuth code.",
      },
      { status: 502 },
    );
  }

  const isSecure = request.nextUrl.protocol === "https:";
  cookieStore.set("sf_oauth_state", "", {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  cookieStore.set("sf_pkce_verifier", "", {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  cookieStore.set("sf_access_token", tokenPayload.access_token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 2,
  });
  cookieStore.set("sf_instance_url", tokenPayload.instance_url, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 2,
  });
  if (tokenPayload.refresh_token) {
    cookieStore.set("sf_refresh_token", tokenPayload.refresh_token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return NextResponse.redirect(new URL("/dashboard.html", request.url));
}
