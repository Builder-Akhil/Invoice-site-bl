/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  experimental: { serverComponentsExternalPackages: ['@react-pdf/renderer'] },
};
export default nextConfig;
