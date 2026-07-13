/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // BUILD_STANDALONE=1 produces a self-contained server bundle for running on a
  // plain GICT Linux box (node server.js) — unset for Vercel builds.
  ...(process.env.BUILD_STANDALONE ? { output: "standalone" } : {}),
};

export default nextConfig;
