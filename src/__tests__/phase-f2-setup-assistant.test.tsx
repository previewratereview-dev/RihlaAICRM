// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { CopilotRegistrationInner } from '@/app/register/client-page';
import * as fs from 'fs';
import * as path from 'path';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => ({
    get: vi.fn().mockReturnValue(null),
  }),
}));

const mockSubmitUserMessage = vi.fn().mockResolvedValue({
  id: 'msg-response-1',
  display: <div>AI Response</div>,
});

vi.mock('@ai-sdk/rsc', () => ({
  useUIState: () => [
    [
      {
        id: 'msg-init-1',
        role: 'assistant',
        display: <div>Welcome to Rihla. I will help you set up your CRM in about 2 minutes.</div>,
      },
    ],
    vi.fn(),
  ],
  useActions: () => ({
    submitUserMessage: mockSubmitUserMessage,
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
  },
}));

describe('Phase F2: Try Rihla Setup Assistant UX & Decoupling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCRMStore.getState().resetSessionState();
    useCRMStore.setState({
      currentUser: null,
      sessionLoading: false,
      tenantId: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('A & J & K. Static code scan: eliminates hardcoded purple/indigo theme and verifies Rihla tokens', () => {
    const clientPageSrc = fs.readFileSync(
      path.resolve(__dirname, '../app/register/client-page.tsx'),
      'utf8'
    );

    // No hardcoded decorative purple/indigo blur blobs
    expect(clientPageSrc).not.toContain('bg-indigo-500/10 blur-[120px]');
    expect(clientPageSrc).not.toContain('bg-purple-500/10 blur-[120px]');
    expect(clientPageSrc).not.toContain('bg-purple-600');
    expect(clientPageSrc).not.toContain('bg-purple-500');
    expect(clientPageSrc).not.toContain('text-purple-500');
    expect(clientPageSrc).not.toContain('text-purple-600');

    // Rihla tokens are present
    expect(clientPageSrc).toContain('text-primary');
    expect(clientPageSrc).toContain('bg-primary');
  });

  it('A. Create Workspace click immediately reveals direct registration UI without invoking submitUserMessage/LLM', async () => {
    render(<CopilotRegistrationInner />);

    const createBtn = screen.getByRole('button', { name: /create workspace/i });
    expect(createBtn).toBeInTheDocument();

    fireEvent.click(createBtn);

    // Zero LLM calls
    expect(mockSubmitUserMessage).not.toHaveBeenCalled();

    // Direct registration form is revealed
    expect(screen.getByText(/Create Your Agency Workspace/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Apex Travel/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Layla Al-Mansoor/i)).toBeInTheDocument();
  });

  it('B. Sign In click navigates directly to /login without invoking submitUserMessage/LLM', async () => {
    render(<CopilotRegistrationInner />);

    const signInBtn = screen.getByRole('button', { name: /sign in/i });
    expect(signInBtn).toBeInTheDocument();

    fireEvent.click(signInBtn);

    // Zero LLM calls
    expect(mockSubmitUserMessage).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('C & D & E. Explore Demo click invokes startDemoSession directly without LLM, and iframe mounts only after success', async () => {
    let resolveDemo: (val: { success: boolean; error?: string }) => void;
    const demoPromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
      resolveDemo = resolve;
    });

    const startDemoSpy = vi.fn().mockImplementation(() => demoPromise);
    useCRMStore.setState({ startDemoSession: startDemoSpy });

    render(<CopilotRegistrationInner />);

    const demoBtn = screen.getByRole('button', { name: /explore demo/i });
    fireEvent.click(demoBtn);

    // LLM must NOT be called
    expect(mockSubmitUserMessage).not.toHaveBeenCalled();

    // startDemoSession must be invoked directly
    expect(startDemoSpy).toHaveBeenCalledTimes(1);

    // Before bootstrap resolves, iframe is NOT mounted
    expect(screen.queryByTitle(/Rihla CRM Preview/i)).not.toBeInTheDocument();

    // Resolve demo success
    resolveDemo!({ success: true });

    await waitFor(() => {
      expect(screen.getByTitle(/Rihla CRM Preview/i)).toBeInTheDocument();
      expect(screen.getByText(/Live Demo Sandbox/i)).toBeInTheDocument();
    });
  });

  it('F & M. Demo bootstrap failure renders inline error with direct Retry without calling LLM', async () => {
    const startDemoSpy = vi.fn().mockResolvedValue({
      success: false,
      error: 'Demo server is currently busy.',
    });
    useCRMStore.setState({ startDemoSession: startDemoSpy });

    render(<CopilotRegistrationInner />);

    const demoBtn = screen.getByRole('button', { name: /explore demo/i });
    fireEvent.click(demoBtn);

    await waitFor(() => {
      expect(screen.getByText(/Demo Connection Unavailable/i)).toBeInTheDocument();
      expect(screen.getByText(/Demo server is currently busy./i)).toBeInTheDocument();
    });

    // Zero LLM calls
    expect(mockSubmitUserMessage).not.toHaveBeenCalled();

    // Click Retry
    const retryBtn = screen.getByRole('button', { name: /retry demo connection/i });
    fireEvent.click(retryBtn);

    // startDemoSession called a second time directly
    expect(startDemoSpy).toHaveBeenCalledTimes(2);
    expect(mockSubmitUserMessage).not.toHaveBeenCalled();
  });

  it('G. Exit Preview invokes local-scoped logout and unmounts preview', async () => {
    const logoutSpy = vi.fn().mockResolvedValue(undefined);
    useCRMStore.setState({
      logout: logoutSpy,
      startDemoSession: vi.fn().mockResolvedValue({ success: true }),
    });

    render(<CopilotRegistrationInner />);

    // Start demo to enter preview
    const demoBtn = screen.getByRole('button', { name: /explore demo/i });
    fireEvent.click(demoBtn);

    await waitFor(() => {
      expect(screen.getByText(/Live Demo Sandbox/i)).toBeInTheDocument();
    });

    // Click Exit Preview
    const exitBtn = screen.getByRole('button', { name: /exit preview/i });
    fireEvent.click(exitBtn);

    await waitFor(() => {
      expect(logoutSpy).toHaveBeenCalledWith({ scope: 'local', redirect: false });
      expect(screen.queryByTitle(/Rihla CRM Preview/i)).not.toBeInTheDocument();
    });

    // Zero LLM calls for exit
    expect(mockSubmitUserMessage).not.toHaveBeenCalled();
  });

  it('H. Free-text conversational queries in textarea still invoke submitUserMessage', async () => {
    render(<CopilotRegistrationInner />);

    const textarea = screen.getByPlaceholderText(/Ask a question about setup or features/i);
    fireEvent.change(textarea, { target: { value: 'How does travel inquiry quoting work?' } });

    const containerDiv = textarea.closest('div');
    const sendBtn = containerDiv ? containerDiv.querySelector('button') : null;
    expect(sendBtn).not.toBeNull();
    if (sendBtn) {
      fireEvent.click(sendBtn);
    }

    expect(mockSubmitUserMessage).toHaveBeenCalledWith(
      'How does travel inquiry quoting work?',
      expect.objectContaining({
        isLoggedIn: false,
      })
    );
  });

  it('L. Starting demo displays compact loading spinner and disables trigger button', async () => {
    let resolveDemo: (val: { success: boolean }) => void;
    const pendingPromise = new Promise<{ success: boolean }>((res) => {
      resolveDemo = res;
    });

    const startDemoSpy = vi.fn().mockImplementation(() => pendingPromise);
    useCRMStore.setState({ startDemoSession: startDemoSpy });

    render(<CopilotRegistrationInner />);

    const demoBtn = screen.getByRole('button', { name: /explore demo/i });
    fireEvent.click(demoBtn);

    // Button shows loading and is disabled
    expect(screen.getByText(/^Starting\.\.\.$/i)).toBeInTheDocument();
    expect(demoBtn).toBeDisabled();

    resolveDemo!({ success: true });
    await waitFor(() => {
      expect(screen.getByTitle(/Rihla CRM Preview/i)).toBeInTheDocument();
      expect(demoBtn).not.toBeDisabled();
    });
  });
});
