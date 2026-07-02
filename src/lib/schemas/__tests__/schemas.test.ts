import { describe, it, expect } from 'vitest';
import { leadSchema, taskSchema, loginSchema, noteSchema } from '../index';
import { LEAD_DEFAULTS, TASK_DEFAULTS } from '../index';

const validLead = {
  ...LEAD_DEFAULTS,
  fullName: 'John Doe',
  businessName: 'Acme Corp',
  email: 'john@acme.com',
  assignedTo: 'user-1',
};

const validTask = {
  ...TASK_DEFAULTS,
  title: 'Follow up call',
  dueDate: '2025-06-01T10:00',
  assignedTo: 'user-1',
};

describe('leadSchema', () => {
  it('rejects empty fullName', () => {
    const result = leadSchema.safeParse({ ...validLead, fullName: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Name is required');
    }
  });

  it('rejects invalid email', () => {
    const result = leadSchema.safeParse({ ...validLead, email: 'not-an-email' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Invalid email address');
    }
  });

  it('rejects empty assignedTo', () => {
    const result = leadSchema.safeParse({ ...validLead, assignedTo: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Assignee is required');
    }
  });

  it('accepts valid lead data', () => {
    const result = leadSchema.safeParse(validLead);
    expect(result.success).toBe(true);
  });
});

describe('taskSchema', () => {
  it('rejects empty title', () => {
    const result = taskSchema.safeParse({ ...validTask, title: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Title is required');
    }
  });

  it('rejects empty dueDate', () => {
    const result = taskSchema.safeParse({ ...validTask, dueDate: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Due date is required');
    }
  });

  it('accepts valid task data', () => {
    const result = taskSchema.safeParse(validTask);
    expect(result.success).toBe(true);
  });
});

describe('loginSchema', () => {
  it('rejects invalid email', () => {
    const result = loginSchema.safeParse({ email: 'bad', password: 'pass' });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Password is required');
    }
  });

  it('accepts valid credentials', () => {
    const result = loginSchema.safeParse({ email: 'user@test.com', password: 'secret' });
    expect(result.success).toBe(true);
  });
});

describe('noteSchema', () => {
  it('rejects empty content', () => {
    const result = noteSchema.safeParse({ content: '' });
    expect(result.success).toBe(false);
  });

  it('rejects content over 5000 chars', () => {
    const result = noteSchema.safeParse({ content: 'x'.repeat(5001) });
    expect(result.success).toBe(false);
  });

  it('accepts valid note', () => {
    const result = noteSchema.safeParse({ content: 'Client confirmed budget' });
    expect(result.success).toBe(true);
  });
});
