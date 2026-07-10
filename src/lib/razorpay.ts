// eslint-disable-next-line @typescript-eslint/no-require-imports
const Razorpay = require('razorpay');
import crypto from 'crypto';

let razorpayInstance: ReturnType<typeof Razorpay> | null = null;

export function getRazorpay() {
  if (razorpayInstance) return razorpayInstance;

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials are not configured');
  }

  razorpayInstance = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return razorpayInstance;
}

export const PLAN_PRICES = {
  starter_monthly: { amount: 99900, label: 'Starter Monthly', tier: 'starter', period: 'monthly' },
  starter_yearly: { amount: 999000, label: 'Starter Yearly', tier: 'starter', period: 'yearly' },
  pro_monthly: { amount: 249900, label: 'Pro Monthly', tier: 'pro', period: 'monthly' },
  pro_yearly: { amount: 2499000, label: 'Pro Yearly', tier: 'pro', period: 'yearly' },
  premium_monthly: { amount: 499900, label: 'Premium Monthly', tier: 'premium', period: 'monthly' },
  premium_yearly: { amount: 4999000, label: 'Premium Yearly', tier: 'premium', period: 'yearly' },
} as const;

export type PlanType = keyof typeof PLAN_PRICES;

export function verifyRazorpaySignature(params: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): boolean {
  const body = params.razorpay_order_id + '|' + params.razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(body)
    .digest('hex');
  return expectedSignature === params.razorpay_signature;
}
