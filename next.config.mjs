import { withSecurityHeaders } from "./security-headers.mjs";
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default withSecurityHeaders(nextConfig);
