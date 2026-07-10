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
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
  const redirectUri = process.env.SALESFORCE_REDIRECT_URI;
  const loginUrl = process.env.SALESFORCE_LOGIN_URL ?? "https://login.salesforce.com";

  if (!code || !clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      {
        error: "Missing OAuth callback code or Salesforce OAuth environment variables.",
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

  const cookieStore = await cookies();
  cookieStore.set("sf_access_token", tokenPayload.access_token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 2,
  });
  cookieStore.set("sf_instance_url", tokenPayload.instance_url, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 2,
  });
  if (tokenPayload.refresh_token) {
    cookieStore.set("sf_refresh_token", tokenPayload.refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return NextResponse.redirect(new URL("/", request.url));
}
