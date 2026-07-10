export interface FAQItem {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string[];
  quickReplies?: string[];
}

export interface ChatContext {
  lastIntent?: string;
  askedQuestions: string[];
  userProfile?: {
    destination?: string;
    budget?: string;
    travelers?: number;
    tripType?: string;
  };
}

const FAQ_DATABASE: FAQItem[] = [
  // Booking Process
  {
    id: 'booking-1',
    category: 'Booking Process',
    question: 'How do I book a trip?',
    answer: 'Booking is easy! Just share your destination, travel dates, number of travelers, and budget. We\'ll create a custom itinerary for you within 24 hours.',
    keywords: ['book', 'booking', 'reserve', 'make booking', 'start booking'],
    quickReplies: ['Get started', 'Talk to specialist']
  },
  {
    id: 'booking-2',
    category: 'Booking Process',
    question: 'What information do you need?',
    answer: 'We need: 1) Destination(s), 2) Travel dates, 3) Number of travelers, 4) Budget range, 5) Trip type (honeymoon, family, etc.), and 6) Any special requests.',
    keywords: ['information', 'details', 'need', 'require', 'what do you need'],
    quickReplies: ['Start booking now']
  },
  {
    id: 'booking-3',
    category: 'Booking Process',
    question: 'How far in advance should I book?',
    answer: 'For best availability and pricing, book 2-3 months ahead. For peak seasons (Dec-Mar, Jun-Aug), we recommend 4-6 months. Last-minute bookings (under 2 weeks) may have limited options.',
    keywords: ['advance', 'early', 'how early', 'when to book', 'timeline'],
    quickReplies: ['Check availability', 'View packages']
  },

  // Pricing & Payment
  {
    id: 'pricing-1',
    category: 'Pricing & Payment',
    question: 'What payment methods do you accept?',
    answer: 'We accept credit/debit cards (Visa, MasterCard, Amex), bank transfers, and PayPal. For bookings over $5,000, we offer installment plans.',
    keywords: ['payment', 'pay', 'credit card', 'paypal', 'how to pay'],
    quickReplies: ['View payment plans']
  },
  {
    id: 'pricing-2',
    category: 'Pricing & Payment',
    question: 'Do you offer payment plans?',
    answer: 'Yes! For bookings over $3,000, we offer 3 installments: 30% deposit, 40% at 30 days, 30% final payment. No hidden fees or interest.',
    keywords: ['payment plan', 'installments', 'emi', 'pay later', 'financing'],
    quickReplies: ['Start booking', 'Learn more']
  },
  {
    id: 'pricing-3',
    category: 'Pricing & Payment',
    question: 'What is your cancellation policy?',
    answer: 'Cancellation varies by package: 60+ days: Full refund minus $100 fee. 30-59 days: 50% refund. Under 30 days: Non-refundable. Travel insurance is highly recommended.',
    keywords: ['cancel', 'cancellation', 'refund', 'policy', 'money back'],
    quickReplies: ['Get travel insurance', 'View full policy']
  },

  // Trip Planning
  {
    id: 'planning-1',
    category: 'Trip Planning',
    question: 'What is the best time to visit Maldives?',
    answer: 'Peak season: Nov-Apr (dry, sunny, perfect beaches). Shoulder season: May-Jun & Sep-Oct (lower prices, occasional rain). Avoid Aug-Sep (highest rainfall).',
    keywords: ['maldives', 'best time', 'when to go', 'season', 'weather'],
    quickReplies: ['View Maldives packages', 'Check dates']
  },
  {
    id: 'planning-2',
    category: 'Trip Planning',
    question: 'Do I need a visa?',
    answer: 'Most nationalities get 30-day free visa on arrival in Maldives. Requirements: Passport valid 6+ months, return ticket, hotel booking. We provide visa assistance.',
    keywords: ['visa', 'passport', 'documents', 'requirements', 'immigration'],
    quickReplies: ['Check visa requirements', 'Start booking']
  },
  {
    id: 'planning-3',
    category: 'Trip Planning',
    question: 'What is included in your packages?',
    answer: 'Our packages include: Accommodation, daily breakfast, airport transfers, sightseeing tours, and 24/7 concierge support. Flights can be added separately.',
    keywords: ['included', 'package', 'what\'s included', 'inclusions', 'features'],
    quickReplies: ['View sample itinerary', 'Customize package']
  },
  {
    id: 'planning-4',
    category: 'Trip Planning',
    question: 'Do you specialize in honeymoons?',
    answer: 'Absolutely! Honeymoons are our specialty. We offer: private pool villas, candlelit dinners, spa packages, sunset cruises, and personalized touches for your special trip.',
    keywords: ['honeymoon', 'romantic', 'couple', 'wedding', 'anniversary'],
    quickReplies: ['View honeymoon packages', 'Get custom quote']
  },

  // Services
  {
    id: 'services-1',
    category: 'Services',
    question: 'Do you offer travel insurance?',
    answer: 'Yes, we partner with top insurers to offer comprehensive coverage: medical emergencies, trip cancellation, lost baggage. Recommended for international travel.',
    keywords: ['insurance', 'travel insurance', 'medical', 'coverage'],
    quickReplies: ['Get insurance quote', 'Add to booking']
  },
  {
    id: 'services-2',
    category: 'Services',
    question: 'Can you arrange airport transfers?',
    answer: 'Yes! We arrange private transfers: sedan, SUV, or van based on your group size. Options: meet-and-greet at arrivals or driver with signage.',
    keywords: ['airport', 'transfer', 'pickup', 'transportation', 'taxi'],
    quickReplies: ['Add transfers', 'View options']
  },
  {
    id: 'services-3',
    category: 'Services',
    question: 'What activities do you recommend?',
    answer: 'Popular activities: snorkeling/diving, sunset cruises, island hopping, spa treatments, water sports, cultural tours, fine dining. We customize based on your interests.',
    keywords: ['activities', 'things to do', 'excursions', 'tours', 'adventure'],
    quickReplies: ['Build custom itinerary', 'View top experiences']
  },

  // Support
  {
    id: 'support-1',
    category: 'Support',
    question: 'How do I contact support?',
    answer: 'We\'re here 24/7: WhatsApp: +1-555-0100, Email: help@rihla.ai, Phone: 1-800-WANDER. Urgent issues? Use WhatsApp for fastest response.',
    keywords: ['contact', 'support', 'help', 'reach', 'call', 'phone number'],
    quickReplies: ['WhatsApp now', 'Send email']
  },
  {
    id: 'support-2',
    category: 'Support',
    question: 'What is your response time?',
    answer: 'We aim for: WhatsApp: 15 minutes during business hours, Email: 2 hours, Phone: Immediate during 9am-8pm EST. After-hours: Next business day.',
    keywords: ['response time', 'how long', 'reply', 'when', 'fast'],
    quickReplies: ['WhatsApp for fast help']
  }
];

class FAQEngine {
  private context: ChatContext = {
    askedQuestions: [],
    lastIntent: undefined,
    userProfile: {}
  };
  private database: FAQItem[] = [];

  /** Merge tenant DB FAQs with built-in entries (DB takes precedence by id). */
  setDatabaseEntries(entries: FAQItem[]) {
    const byId = new Map<string, FAQItem>();
    for (const faq of FAQ_DATABASE) byId.set(faq.id, faq);
    for (const faq of entries) byId.set(faq.id, faq);
    this.database = Array.from(byId.values());
  }

  private getActiveDatabase(): FAQItem[] {
    return this.database.length > 0 ? this.database : FAQ_DATABASE;
  }

  findBestMatch(userMessage: string): FAQItem | null {
    const message = userMessage.toLowerCase();
    let bestMatch: FAQItem | null = null;
    let bestScore = 0;

    for (const faq of this.getActiveDatabase()) {
      // Skip if already asked
      if (this.context.askedQuestions.includes(faq.id)) continue;

      let score = 0;

      // Check keywords
      for (const keyword of faq.keywords) {
        if (message.includes(keyword.toLowerCase())) {
          score += 1;
        }
      }

      // Partial match on question
      const questionWords = faq.question.toLowerCase().split(' ');
      const matchingWords = questionWords.filter(word => message.includes(word) && word.length > 3);
      score += matchingWords.length * 0.5;

      // Category match bonus
      if (message.includes(faq.category.toLowerCase())) {
        score += 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = faq;
      }
    }

    // Threshold for good match
    return bestScore >= 0.5 ? bestMatch : null;
  }

  getResponse(userMessage: string): { answer: string; quickReplies?: string[]; escalate: boolean } {
    const match = this.findBestMatch(userMessage);

    if (match) {
      this.context.askedQuestions.push(match.id);
      this.context.lastIntent = match.category;

      // Extract user profile info from message (simple extraction)
      this.extractProfileInfo(userMessage);

      return {
        answer: match.answer,
        quickReplies: match.quickReplies,
        escalate: false
      };
    }

    // No match found - escalate to human
    return {
      answer: "I'm not sure about that, but I'd love to help! Let me connect you with one of our travel specialists who can provide detailed information.",
      quickReplies: ['Talk to specialist', 'Call us', 'Send email'],
      escalate: true
    };
  }

  private extractProfileInfo(message: string) {
    const lower = message.toLowerCase();

    // Extract destination
    if (lower.includes('maldives')) this.context.userProfile!.destination = 'Maldives';
    else if (lower.includes('bali')) this.context.userProfile!.destination = 'Bali';
    else if (lower.includes('europe')) this.context.userProfile!.destination = 'Europe';

    // Extract trip type
    if (lower.includes('honey')) this.context.userProfile!.tripType = 'Honeymoon';
    else if (lower.includes('family')) this.context.userProfile!.tripType = 'Family';
    else if (lower.includes('luxury')) this.context.userProfile!.tripType = 'Luxury';
  }

  resetContext() {
    this.context = {
      askedQuestions: [],
      lastIntent: undefined,
      userProfile: {}
    };
  }

  getContext() {
    return { ...this.context };
  }

  // Get suggested follow-up questions based on context
  getAllEntries(): FAQItem[] {
    return this.getActiveDatabase();
  }

  getSuggestedQuestions(): string[] {
    const suggestions: string[] = [];

    if (this.context.userProfile?.destination) {
      suggestions.push(`Tell me more about ${this.context.userProfile.destination}`);
    }

    if (!this.context.userProfile?.budget) {
      suggestions.push('What is your budget range?');
    }

    if (!this.context.userProfile?.travelers) {
      suggestions.push('How many travelers?');
    }

    return suggestions.slice(0, 2);
  }
}

export const faqEngine = new FAQEngine();