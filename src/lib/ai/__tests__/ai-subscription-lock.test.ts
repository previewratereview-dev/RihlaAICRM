import { describe, it, expect } from 'vitest';
import { getSubscriptionBlockedMessage } from '../runtime';

describe('AI Subscription Lock & Polite Responses', () => {
  it('returns polite message asking to upgrade when on free tier with active or no subscription', () => {
    const msgNone = getSubscriptionBlockedMessage({ tier: 'free', subscriptionStatus: 'none' });
    expect(msgNone).toContain('Our AI features are exclusive to subscribed agencies.');
    expect(msgNone).toContain('Please upgrade your agency to a Starter, Pro, or Premium subscription');

    const msgActive = getSubscriptionBlockedMessage({ tier: 'free', subscriptionStatus: 'active' });
    expect(msgActive).toContain('Please upgrade your agency to a Starter, Pro, or Premium subscription');
  });

  it('returns polite message asking to renew when subscription ended or is past due', () => {
    const msgExpired = getSubscriptionBlockedMessage({ tier: 'free', subscriptionStatus: 'expired' });
    expect(msgExpired).toContain("Your agency's subscription has ended or is past due.");
    expect(msgExpired).toContain('please renew or update your subscription. Thank you!');

    const msgPastDue = getSubscriptionBlockedMessage({ tier: 'free', subscriptionStatus: 'past_due' });
    expect(msgPastDue).toContain("Your agency's subscription has ended or is past due.");
  });
});