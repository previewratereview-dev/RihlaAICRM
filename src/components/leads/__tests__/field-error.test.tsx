/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-red-500 text-[10px] font-mono mt-0.5">{message}</p>;
}

describe('FieldError', () => {
  it('renders nothing when no message', () => {
    const { container } = render(<FieldError />);
    expect(container.firstChild).toBeNull();
  });

  it('renders error message', () => {
    render(<FieldError message="Name is required" />);
    expect(screen.getByText('Name is required')).toBeInTheDocument();
  });

  it('applies correct styles', () => {
    render(<FieldError message="Invalid" />);
    const el = screen.getByText('Invalid');
    expect(el).toHaveClass('text-red-500');
    expect(el).toHaveClass('text-[10px]');
  });
});
