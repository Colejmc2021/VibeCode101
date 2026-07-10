import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
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
  const url = new URL("/services/oauth2/authorize", loginUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "api refresh_token");
  url.searchParams.set("state", state);

  return NextResponse.redirect(url);
}
