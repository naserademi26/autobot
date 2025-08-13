export const API_CONFIG = {
  // Jupiter API Configuration
  JUPITER: {
    BASE_URL: "https://quote-api.jup.ag/v6",
    PRICE_URL: "https://price.jup.ag/v4/price",
    API_KEY: "e2f280df-aa16-4c78-979c-6468f660dbfb",
    ENDPOINTS: {
      QUOTE: "/quote",
      SWAP: "/swap",
      PRICE: "/price",
    },
  },

  // bloXroute Configuration
  BLOXROUTE: {
    REGION_URL: "https://ny.solana.dex.blxrbdn.com",
    SUBMIT_URL: "https://global.solana.dex.blxrbdn.com",
    AUTHORIZATION: "NTI4Y2JhNWYtM2UwMy00NmFlLTg3MjEtMDE0NzI0OTMwNmRkOmU1YThkYjkxMDFhYTI5ZjM4MWQ1YmY3ZTBhMjIyYjk0",
    ENDPOINTS: {
      JUPITER_SWAP: "/api/v2/jupiter/swap",
      SUBMIT: "/api/v2/submit",
    },
  },

  // Helius RPC Configuration
  HELIUS: {
    MAINNET_URL: "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
    RPC_URL: "https://rpc.helius.xyz/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
    API_KEY: "13b641b3-c9e5-4c63-98ae-5def3800fa0e",
  },

  // Fallback RPC Endpoints
  RPC_ENDPOINTS: [
    "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
    "https://rpc.helius.xyz/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
    "https://api.mainnet-beta.solana.com",
    "https://rpc.ankr.com/solana",
  ],

  // Request Configuration
  TIMEOUTS: {
    DEFAULT: 30000,
    SWAP: 45000,
    PRICE: 10000,
  },

  // Trading Configuration
  TRADING: {
    MAX_SLIPPAGE_BPS: 5000, // 50%
    DEFAULT_SLIPPAGE_BPS: 300, // 3%
    PRIORITY_FEE_MULTIPLIER: 1.5,
    MAX_RETRIES: 3,
  },
}

export default API_CONFIG
