import type { SetState, GetState } from './types';
import { CRMDatabaseService } from '@/lib/db-service';

export function createUiSlice(set: SetState, _get: GetState) {
  return {
    activeTab: 'dashboard' as string,
    sidebarExpanded: true,
    density: 'comfortable' as 'comfortable' | 'compact',
    dataLoading: false,
    typingState: {} as Record<string, boolean>,
    globalSearchQuery: '',
    tenantBranding: { agencyName: 'Rihla', primaryColor: '#FF6B35' },
    tenantFeatures: {},
    tenantId: null as string | null,
    dbMode: (CRMDatabaseService.isSupabaseEnabled() ? 'supabase' : 'local') as 'local' | 'supabase',
    settings: {
      agencyName: 'STATE AI',
      logoText: 'STATE.AI',
      accentColor: '#FFFFFF',
      systemPrompt: `You are the lead intelligence agent for STATE AI. Your objective is to follow up with leads, answer their technical queries about custom AI integrations (RAG workflows, custom LLM fine-tuning, voice setters, API agents), qualify their budget and timeline, and seamlessly guide them towards scheduling a demo.\n\nBe professional, highly technical yet accessible, concise, and focused on business value (ROI, cost reductions, operational scaling).`,
      makeWebhookUrl: 'https://hook.us1.com/ag3p9x21s...',
      emailAutomation: true,
      emailStatusAutomation: false,
      emailFromName: '',
      emailReplyTo: '',
      emailFollowUpTemplate: '',
      whatsappAutomation: true,
      smsAutomation: false,
      dailyTargetScore: 50,
    },

    setActiveTab: (tab: string) => set({ activeTab: tab }),
    toggleSidebar: () => set((state) => ({ sidebarExpanded: !state.sidebarExpanded })),
    setDensity: (density: 'comfortable' | 'compact') => {
      set({ density });
      if (typeof window !== 'undefined') {
        localStorage.setItem('crm-density', density);
      }
    },
    setGlobalSearchQuery: (query: string) => set({ globalSearchQuery: query }),
    setTyping: (conversationId: string, isTyping: boolean) =>
      set((state) => {
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
