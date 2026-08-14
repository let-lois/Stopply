import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Switch } from '@/components/ui/Switch';

describe('Switch', () => {
  it('exposes switch semantics and its state', () => {
    render(<Switch checked label="Live mode" onChange={() => {}} />);
    expect(screen.getByRole('switch', { name: /Live mode/ })).toBeChecked();
  });

  it('is operable by keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} label="Live mode" onChange={onChange} />);
    await user.tab();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not fire while disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} label="Live mode" disabled onChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps an accessible name when the visible label is hidden', () => {
    render(<Switch checked={false} hideLabel label="Enable advertising" onChange={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Enable advertising' })).toBeInTheDocument();
  });
});
