// The dialog contract, asserted rather than assumed.
//
// Every case here is a behaviour the prototype's hand-rolled modal lacked.
// jsdom implements <dialog> including showModal, cancel, and focus movement,
// so these exercise the real element rather than a stand-in.

import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from '@/components/ui/Dialog';

function Harness({ description }: { description?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open the dialog
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create a client workspace"
        description={description}
      >
        <label>
          Client name
          <input name="name" />
        </label>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('is not in the accessibility tree until it is opened', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens, and is named by its title', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open the dialog' }));
    expect(screen.getByRole('dialog', { name: 'Create a client workspace' })).toBeVisible();
  });

  it('is described by its description when it has one', async () => {
    const user = userEvent.setup();
    render(<Harness description="This does not provision anything yet." />);
    await user.click(screen.getByRole('button', { name: 'Open the dialog' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'This does not provision anything yet.'
    );
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open the dialog' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open the dialog' }));
    // The backdrop is the dialog element's own box. The prototype guarded this
    // with stopPropagation on the panel while never handling the click.
    await user.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not close when the panel itself is clicked', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open the dialog' }));
    await user.click(screen.getByText('Create a client workspace'));
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('closes from the labelled close control', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open the dialog' }));
    // A bare glyph is not a name. This one is labelled.
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('locks background scroll while open and restores it after', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open the dialog' }));
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('does not retain field values across opens', async () => {
    // The prototype rendered its dialogs unconditionally and let them hide
    // themselves, so useState survived and the next client inherited the
    // previous one's selection.
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open the dialog' }));
    await user.type(screen.getByLabelText('Client name'), 'Northwind');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Open the dialog' }));
    expect(screen.getByLabelText('Client name')).toHaveValue('');
  });
});
