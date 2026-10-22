import type { APIRoute } from "astro";

const robotsTxt = `User-agent: *
Disallow: /
`;

export const GET: APIRoute = () => new Response(robotsTxt);
