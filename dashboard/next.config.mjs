/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dashboard is a pure client of the Guardian API; it never proxies or
  // re-hosts media, so no remote image domains are needed.
  images: { remotePatterns: [] },
};

export default nextConfig;
