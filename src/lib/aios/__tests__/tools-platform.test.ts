import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ToolRegistry,
  ToolValidator,
  ToolValidationError,
  ToolPermissionGuard,
  ToolExecutor,
  ToolLoader,
  createLeadTool,
  updateLeadTool,
  deleteLeadTool,
  searchFlightsTool,
  bookHotelTool,
  cancelBookingTool,
} from '../tools';
import { defaultEventBus } from '../events';
import { defaultPolicyEngine } from '../policies';
import type { AIExecutionContext } from '../types';

describe('Milestone 2 — Tool Platform Architecture', () => {
  let registry: ToolRegistry;
  let validator: ToolValidator;
  let permissionGuard: ToolPermissionGuard;
  let executor: ToolExecutor;
  let loader: ToolLoader;
  let mockContext: AIExecutionContext;

  beforeEach(() => {
    registry = new ToolRegistry();
    validator = new ToolValidator();
    permissionGuard = new ToolPermissionGuard(defaultPolicyEngine);
    executor = new ToolExecutor(registry, validator, permissionGuard, defaultEventBus);
    loader = new ToolLoader(registry);

    loader.loadAllBuiltInTools();

    mockContext = {
      requestId: 'req_123',
      tenantId: 'global',
      userId: 'user_123',
      traceId: 'trace_test_platform',
      provider: 'openai',
      model: 'gpt-4o',
      cost: 0,
      startTime: new Date(),
      state: 'executing',
      stateHistory: [],
      features: { planner: true, memory: true, workflow: true, vision: true, automation: true },
      permissions: ['*'], // Admin override by default for test execution
      metadata: {},
    };
  });

  describe('1. Tool Registry & Intelligent Discovery Engine', () => {
    it('should register all built-in tools across CRM and Travel CRM verticals', () => {
      expect(registry.listTools()).toHaveLength(6);
      expect(registry.listTools('crm')).toHaveLength(3);
      expect(registry.listTools('travel')).toHaveLength(3);
    });

    it('should discover tools by capability, risk level, and industry', () => {
      const lowRiskTravel = registry.discoverTools({
        category: 'travel',
        maxRiskLevel: 'low',
      });
      expect(lowRiskTravel).toHaveLength(1);
      expect(lowRiskTravel[0].id).toBe('travel.search_flights');

      const undoSupportedCrm = registry.discoverTools({
        category: 'crm',
        supportsUndo: true,
      });
      expect(undoSupportedCrm).toHaveLength(3);

      const searchByName = registry.discoverTools({
        searchString: 'hotel',
      });
      expect(searchByName).toHaveLength(2);
      expect(searchByName.some(t => t.id === 'travel.book_hotel')).toBe(true);
    });
  });

  describe('2. Strict Zod Schema Validation', () => {
    it('should validate correct arguments without error', () => {
      const input = { name: 'Acme Corp', email: 'contact@acme.com', status: 'new' };
      const validated = validator.validateInput(createLeadTool, input);
      expect(validated.name).toBe('Acme Corp');
    });

    it('should throw ToolValidationError on malformed arguments', () => {
      const invalidInput = { name: 'A', email: 'not-an-email' }; // Name too short, email invalid
      expect(() => validator.validateInput(createLeadTool, invalidInput)).toThrow(ToolValidationError);
    });
  });

  describe('3. Tool Permission Guard & Risk Governance', () => {
    it('should deny execution when user lacks required permissions', async () => {
      const restrictedContext = { ...mockContext, permissions: ['travel:read'] }; // Lacks leads:write
      const decision = await permissionGuard.checkPermissions(createLeadTool, restrictedContext);
      
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Missing required permissions');
    });

    it('should trigger HITL requirement for high/critical risk or destructive tools', async () => {
      const normalUserContext = { ...mockContext, permissions: ['leads:delete'] };
      // deleteLeadTool is destructive CRM tool -> PolicyEngine evaluates
      const decision = await permissionGuard.checkPermissions(deleteLeadTool, normalUserContext);
      expect(decision.requiresHITL || !decision.allowed).toBe(true);
    });
  });

  describe('4. Dry-Run Execution Branching', () => {
    it('should execute dry-run and return simulation envelope without mutating state', async () => {
      const envelope = await executor.execute(
        'crm.update_lead',
        { leadId: 'lead_999', notes: 'Simulated note' },
        mockContext,
        { dryRun: true }
      );

      expect(envelope.success).toBe(true);
      expect(envelope.audit.dryRun).toBe(true);
      expect(envelope.summary).toContain('[DRY RUN]');
      expect(envelope.warnings[0]).toContain('1 records will be modified');
      expect(envelope.warnings[1]).toContain('lead_999');
    });
  });

  describe('5. Undo Execution Branching', () => {
    it('should execute undo and revert previous action', async () => {
      const previousResult = {
        success: true,
        data: { leadId: 'lead_to_revert', status: 'new' },
        summary: 'Created lead',
        warnings: [],
        errors: [],
        metrics: { latencyMs: 100 },
        audit: { toolId: 'crm.create_lead', version: '1.0.0', traceId: 'trace_1', timestamp: new Date() },
        nextSuggestions: [],
      };

      const undoEnvelope = await executor.execute(
        'crm.create_lead',
        { name: 'Test', email: 'test@test.com' },
        mockContext,
        { undo: true, previousResult }
      );

      expect(undoEnvelope.success).toBe(true);
      expect(undoEnvelope.audit.undone).toBe(true);
      expect(undoEnvelope.summary).toContain('Undone: Deleted previously created lead lead_to_revert');
    });
  });

  describe('6. Idempotency Caching', () => {
    it('should return cached envelope on duplicate retry with same idempotencyKey', async () => {
      const key = 'idemp_key_12345';
      const firstRun = await executor.execute(
        'crm.create_lead',
        { name: 'Unique Lead', email: 'unique@lead.com' },
        mockContext,
        { idempotencyKey: key }
      );

      expect(firstRun.success).toBe(true);
      expect(firstRun.warnings).toHaveLength(0);

      const secondRun = await executor.execute(
        'crm.create_lead',
        { name: 'Unique Lead', email: 'unique@lead.com' },
        mockContext,
        { idempotencyKey: key }
      );

      expect(secondRun.success).toBe(true);
      expect(secondRun.data).toEqual(firstRun.data); // Exactly same generated ID!
      expect(secondRun.warnings[0]).toContain('Idempotency hit: Returned cached result');
    });
  });

  describe('7. Tool Metrics & EventBus Emissions', () => {
    it('should track invocation counts, latency, and cost in registry', async () => {
      await executor.execute('travel.search_flights', { origin: 'JFK', destination: 'LHR', departureDate: '2026-08-01' }, mockContext);
      await executor.execute('travel.search_flights', { origin: 'SFO', destination: 'DXB', departureDate: '2026-08-05' }, mockContext);

      const metrics = registry.getMetrics('travel.search_flights');
      expect(metrics).toBeDefined();
      expect(metrics?.invocationCount).toBe(2);
      expect(metrics?.successCount).toBe(2);
      expect(metrics?.successRate).toBe(100);
      expect(metrics?.totalCostUsd).toBeGreaterThan(0);
    });

    it('should publish tool lifecycle events via EventBus', async () => {
      const startedMock = vi.fn();
      const completedMock = vi.fn();

      defaultEventBus.subscribe('tool.started', startedMock);
      defaultEventBus.subscribe('tool.completed', completedMock);

      await executor.execute('crm.update_lead', { leadId: 'lead_888', status: 'qualified' }, mockContext);

      expect(startedMock).toHaveBeenCalledTimes(1);
      expect(completedMock).toHaveBeenCalledTimes(1);
    });
  });
});
