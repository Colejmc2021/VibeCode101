import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type SalesforceContactRecord = {
  Name?: string;
  Email?: string;
  Account?: {
    Name?: string;
  };
};

type SalesforceQueryResponse = {
  records?: SalesforceContactRecord[];
};

type SalesforceTokenRefreshResponse = {
  access_token?: string;
  instance_url?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

function escapeSoqlLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function GET(request: NextRequest): Promise<Response> {
  const cookieStore = await cookies();
  let accessToken = cookieStore.get("sf_access_token")?.value ?? process.env.SALESFORCE_ACCESS_TOKEN;
  let rawInstanceUrl = cookieStore.get("sf_instance_url")?.value ?? process.env.SALESFORCE_INSTANCE_URL;
  let instanceUrl = rawInstanceUrl?.replace(".lightning.force.com", ".my.salesforce.com");
  const refreshToken = cookieStore.get("sf_refresh_token")?.value ?? process.env.SALESFORCE_REFRESH_TOKEN;
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
  const loginUrl = process.env.SALESFORCE_LOGIN_URL ?? "https://login.salesforce.com";
  const apiVersion = process.env.SALESFORCE_API_VERSION ?? "v64.0";
  const contactId = process.env.SALESFORCE_CONTACT_ID;
  const requestedName = request.nextUrl.searchParams.get("name")?.trim();
  const isSecure = request.nextUrl.protocol === "https:";

  async function fetchClientCredentialsToken(): Promise<boolean> {
    if (!clientId || !clientSecret) {
      return false;
    }
    const tokenUrl = new URL("/services/oauth2/token", loginUrl);
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: "no-store",
    });
    const tokenPayload = (await tokenResponse.json()) as SalesforceTokenRefreshResponse;
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      return false;
    }
    accessToken = tokenPayload.access_token;
    rawInstanceUrl = tokenPayload.instance_url ?? rawInstanceUrl;
    instanceUrl = rawInstanceUrl?.replace(".lightning.force.com", ".my.salesforce.com");
    cookieStore.set("sf_access_token", accessToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60,
    });
    if (rawInstanceUrl) {
      cookieStore.set("sf_instance_url", rawInstanceUrl, {
        httpOnly: true,
        secure: isSecure,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60,
      });
    }
    return true;
  }

  async function refreshAccessTokenIfPossible(): Promise<boolean> {
    if (!refreshToken || !clientId || !clientSecret) {
      return false;
    }

    const tokenUrl = new URL("/services/oauth2/token", loginUrl);
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: "no-store",
    });

    const tokenPayload = (await tokenResponse.json()) as SalesforceTokenRefreshResponse;
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      return false;
    }

    accessToken = tokenPayload.access_token;
    rawInstanceUrl = tokenPayload.instance_url ?? rawInstanceUrl;
    instanceUrl = rawInstanceUrl?.replace(".lightning.force.com", ".my.salesforce.com");

    cookieStore.set("sf_access_token", accessToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 2,
    });
    if (rawInstanceUrl) {
      cookieStore.set("sf_instance_url", rawInstanceUrl, {
        httpOnly: true,
        secure: isSecure,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 2,
      });
    }

    return true;
  }

  if (!accessToken || !instanceUrl) {
    const refreshed = await refreshAccessTokenIfPossible();
    const clientCredsToken = refreshed ? true : await fetchClientCredentialsToken();
    if ((!refreshed && !clientCredsToken) || !accessToken || !instanceUrl) {
      return NextResponse.json(
        {
          connected: false,
          error: "No Salesforce session found. Sign in with Salesforce first.",
        },
        { status: 401 },
      );
    }
  }

  const soql = requestedName
    ? `SELECT Name, Email, Account.Name FROM Contact WHERE Name = '${escapeSoqlLiteral(requestedName)}' LIMIT 1`
    : contactId
      ? `SELECT Name, Email, Account.Name FROM Contact WHERE Id = '${contactId}' LIMIT 1`
      : "SELECT Name, Email, Account.Name FROM Contact WHERE Name != null ORDER BY LastModifiedDate DESC LIMIT 1";
  const queryUrl = new URL(`/services/data/${apiVersion}/query`, instanceUrl);
  queryUrl.searchParams.set("q", soql);

  async function runQuery(): Promise<Response> {
    return fetch(queryUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
  }

  let response = await runQuery();
  if (response.status === 401 && (await refreshAccessTokenIfPossible())) {
    response = await runQuery();
  } else if (response.status === 401 && (await fetchClientCredentialsToken())) {
    response = await runQuery();
  }

  if (!response.ok) {
    return NextResponse.json(
      {
        connected: false,
        error: "Salesforce query failed. Re-authenticate to refresh session.",
      },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as SalesforceQueryResponse;
  const record = payload.records?.[0];

  return NextResponse.json({
    connected: true,
    profile: {
      name: record?.Name ?? requestedName ?? "Unknown Contact",
      company: record?.Account?.Name ?? "No Account",
      tier: "Live",
    },
  });
}
