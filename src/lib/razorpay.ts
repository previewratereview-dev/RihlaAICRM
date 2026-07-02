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
  monthly: { amount: 49900, label: 'Monthly', period: 'monthly' },
  yearly: { amount: 519900, label: 'Yearly', period: 'yearly' },
  lifetime: { amount: 2499900, label: 'Lifetime', period: 'once' },
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
