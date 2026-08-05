import type { NextConfig } from "next";

const scriptSrcDirective = [
  "script-src 'self'",
  "'unsafe-eval'",
  "'unsafe-inline'",
  "https://checkout.razorpay.com https://cdn.razorpay.com https://vercel.live",
].join(' ');

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-XSS-Protection', value: '0' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      scriptSrcDirective,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data: https:",
      "font-src 'self'",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.resend.com https://api.openai.com https://api.anthropic.com https://api.stripe.com https://lumberjack.razorpay.com https://api.razorpay.com https://vercel.live wss://vercel.live",
      "frame-src 'self' https://api.razorpay.com/ https://vercel.live",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
