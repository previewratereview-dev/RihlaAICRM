import type { SetState, GetState } from './types';
import { CRMDatabaseService } from '@/lib/db-service';

export function createUiSlice(set: SetState, get: GetState) {
  return {
    activeTab: 'dashboard' as string,
    sidebarExpanded: true,
    dataLoading: false,
    typingState: {} as Record<string, boolean>,
    globalSearchQuery: '',
    tenantBranding: { agencyName: 'WanderBot AI', primaryColor: '#FF6B35' },
    tenantFeatures: {},
    impersonateTenantId: null as string | null,
    impersonateTenantName: null as string | null,
    tenantId: null as string | null,
    dbMode: (CRMDatabaseService.isSupabaseEnabled() ? 'supabase' : 'local') as 'local' | 'supabase',
    settings: {
      agencyName: 'STATE AI',
      logoText: 'STATE.AI',
      accentColor: '#FFFFFF',
      systemPrompt: `You are the lead intelligence agent for STATE AI. Your objective is to follow up with leads, answer their technical queries about custom AI integrations (RAG workflows, custom LLM fine-tuning, voice setters, API agents), qualify their budget and timeline, and seamlessly guide them towards scheduling a demo.\n\nBe professional, highly technical yet accessible, concise, and focused on business value (ROI, cost reductions, operational scaling).`,
      makeWebhookUrl: 'https://hook.us1.com/ag3p9x21s...',
      emailAutomation: true,
      whatsappAutomation: true,
      smsAutomation: false,
      dailyTargetScore: 50,
    },

    setActiveTab: (tab: string) => set({ activeTab: tab }),
    toggleSidebar: () => set((state) => ({ sidebarExpanded: !state.sidebarExpanded })),
    setGlobalSearchQuery: (query: string) => set({ globalSearchQuery: query }),
    setImpersonateTenant: (tenantId: string | null, tenantName?: string) => {
      if (tenantId) {
        set({ impersonateTenantId: tenantId, impersonateTenantName: tenantName || null });
      } else {
        set({ impersonateTenantId: null, impersonateTenantName: null });
      }
      get().syncData();
    },
    setTyping: (conversationId: string, isTyping: boolean) => set((state) => {
      const updatedTyping = { ...state.typingState };
      if (isTyping) {
        updatedTyping[conversationId] = true;
      } else {
        delete updatedTyping[conversationId];
      }
      return { typingState: updatedTyping };
    }),
  };
}
