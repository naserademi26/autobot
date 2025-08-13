/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: ["*"],
    },
  },
  output: 'standalone',
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      }
    }
    return config
  },
  env: {
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
    BLOXROUTE_API_KEY: process.env.BLOXROUTE_API_KEY,
    NEXT_PUBLIC_BLOXROUTE_API_KEY: process.env.NEXT_PUBLIC_BLOXROUTE_API_KEY,
    PUMPFUN_API_KEY: process.env.PUMPFUN_API_KEY,
    NEXT_PUBLIC_JUPITER_API_KEY: process.env.NEXT_PUBLIC_JUPITER_API_KEY,
    BITQUERY_API_KEY: process.env.BITQUERY_API_KEY,
    BIRDEYE_KEY: process.env.BIRDEYE_KEY,
  }
}

export default nextConfig
