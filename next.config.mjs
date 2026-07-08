/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained build (.next/standalone) for deployment to the Azure VM.
  output: "standalone",
};

export default nextConfig;
