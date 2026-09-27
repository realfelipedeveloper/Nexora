import { type NextRequest, NextResponse } from "next/server";
import { publicRuntimeConfiguration } from "../../../../lib/public-site";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type AssetRouteProperties = {
  params: Promise<{ assetId: string }>;
};

export async function GET(request: NextRequest, { params }: AssetRouteProperties) {
  const { assetId } = await params;
  const version = request.nextUrl.searchParams.get("v");
  if (!uuidPattern.test(assetId) || !version || !/^[1-9][0-9]*$/u.test(version)) {
    return new NextResponse(null, { status: 404 });
  }

  const { apiUrl, siteKey } = publicRuntimeConfiguration();
  const upstream = await fetch(
    `${apiUrl}/public/sites/${encodeURIComponent(siteKey)}/assets/${encodeURIComponent(assetId)}/content?v=${version}`,
    { headers: { Accept: "*/*" }, next: { revalidate: 31_536_000 } },
  );
  if (!upstream.ok || !upstream.body) return new NextResponse(null, { status: upstream.status });

  const headers = new Headers();
  for (const name of ["cache-control", "content-length", "content-type", "etag"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("X-Content-Type-Options", "nosniff");
  return new NextResponse(upstream.body, { headers, status: 200 });
}
