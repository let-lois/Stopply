'use client';

// The chat widget, pinned bottom right on every tab. Two panes: help
// search over published articles, and the Claude assistant with role
// scoped tools. Every mutating tool call shows a before and after diff,
// requires explicit confirmation, and offers one click revert. Code mode
// renders only for agency_admin sessions and is re verified server side.

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { TenantSettings } from '@/lib/types';

interface Proposal {
  id: string;
  name: string;
  input: Record<string, unknown>;
  before: unknown;
  status: 'pending' | 'applied' | 'declined' | 'reverted';
  logId?: string;
  after?: unknown;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  proposals?: Proposal[];
}

interface Article {
  slug: string;
  title: string;
  tags: string | null;
}

export function ChatWidget({ settings, currentTab }: { settings: TenantSettings; currentTab: string }) {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<'help' | 'assistant'>('help');
  const [codeMode, setCodeMode] = useState(false);
  const isAgencyAdmin = settings.role === 'agency_admin';

  return (
    <>
      <button className="chat-fab" onClick={() => setOpen((o) => !o)} aria-label="Help and assistant">
        {open ? '×' : '?'}
      </button>
      {open && (
        <div className="chat-panel">
          <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--hairline)', gap: 6 }}>
            <button className={`small ${pane === 'help' ? 'primary' : ''}`} onClick={() => setPane('help')}>
              Help
            </button>
            <button className={`small ${pane === 'assistant' ? 'primary' : ''}`} onClick={() => setPane('assistant')}>
              Assistant
            </button>
            <span style={{ flex: 1 }} />
            {isAgencyAdmin && pane === 'assistant' && (
              <button
                className={`small ${codeMode ? 'primary' : ''}`}
                title="Code mode: layout and CSS tools"
                onClick={() => setCodeMode((m) => !m)}
              >
                {'</>'}
              </button>
            )}
          </div>
          {pane === 'help' ? <HelpPane /> : <AssistantPane currentTab={currentTab} codeMode={codeMode} role={settings.role} />}
        </div>
      )}
    </>
  );
}

function HelpPane() {
  const [query, setQuery] = useState('');
  const [articles, setArticles] = useState<Article[]>([]);
  const [openArticle, setOpenArticle] = useState<{ title: string; body_md: string } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      api<{ articles: Article[] }>(`/api/help/search?q=${encodeURIComponent(query)}`)
        .then((r) => setArticles(r.articles))
        .catch(() => setArticles([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  if (openArticle) {
    return (
      <div style={{ padding: 14, overflowY: 'auto' }} className="stack">
        <button className="small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpenArticle(null)}>
          Back
        </button>
        <Markdown text={`# ${openArticle.title}\n${openArticle.body_md.replace(/^#[^\n]*\n/, '')}`} />
      </div>
    );
  }

  return (
    <div style={{ padding: 14, overflowY: 'auto' }} className="stack">
      <input placeholder="Search help articles" value={query} onChange={(e) => setQuery(e.target.value)} />
      {articles.map((a) => (
        <button
          key={a.slug}
          className="small"
          style={{ textAlign: 'left' }}
          onClick={() =>
            api<{ article: { title: string; body_md: string } }>(`/api/help/articles/${a.slug}`)
              .then((r) => setOpenArticle(r.article))
              .catch(() => undefined)
          }
        >
          {a.title}
        </button>
      ))}
      {articles.length === 0 && <p className="muted">No articles match.</p>}
    </div>
  );
}

// A deliberately small markdown renderer: headings, bold, code, lists.
function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="stack" style={{ gap: 6, fontSize: 14 }}>
      {lines.map((line, i) => {
        if (line.startsWith('# ')) return <h3 key={i}>{line.slice(2)}</h3>;
        if (line.startsWith('## ')) return <strong key={i}>{line.slice(3)}</strong>;
        if (/^\d+\. /.test(line) || line.startsWith('- ')) {
          return (
            <div key={i} style={{ paddingLeft: 12 }}>
              {renderInline(line)}
            </div>
          );
        }
        if (!line.trim()) return null;
        return <p key={i} style={{ margin: 0 }}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

function renderInline(line: string): React.ReactNode {
  const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <b key={i}>{part.slice(2, -2)}</b>;
    return part;
  });
}

function AssistantPane({ currentTab, codeMode, role }: { currentTab: string; codeMode: boolean; role: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const content = input.trim();
    if (!content || busy) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await api<{ text: string; proposals: Array<Omit<Proposal, 'status'>> }>('/api/chat', {
        method: 'POST',
        json: {
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          currentTab,
          codeMode,
        },
      });
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.text || (res.proposals.length ? 'I have a change ready for you to review.' : ''),
          proposals: res.proposals.map((p) => ({ ...p, status: 'pending' as const })),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: err instanceof Error ? err.message : 'Something went wrong.' },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const updateProposal = (messageIndex: number, proposalId: string, patch: Partial<Proposal>) => {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === messageIndex
          ? { ...m, proposals: m.proposals?.map((p) => (p.id === proposalId ? { ...p, ...patch } : p)) }
          : m
      )
    );
  };

  const confirm = async (messageIndex: number, proposal: Proposal) => {
    try {
      const res = await api<{ logId: string; after: unknown }>('/api/chat/execute', {
        method: 'POST',
        json: { toolName: proposal.name, input: proposal.input, codeMode },
      });
      updateProposal(messageIndex, proposal.id, { status: 'applied', logId: res.logId, after: res.after });
    } catch (err) {
      updateProposal(messageIndex, proposal.id, { status: 'declined' });
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `That change failed: ${err instanceof Error ? err.message : 'unknown error'}` },
      ]);
    }
  };

  const revert = async (messageIndex: number, proposal: Proposal) => {
    if (!proposal.logId) return;
    try {
      await api('/api/chat/revert', { method: 'POST', json: { logId: proposal.logId } });
      updateProposal(messageIndex, proposal.id, { status: 'reverted' });
    } catch {
      // leave state as applied; the server refused the revert
    }
  };

  return (
    <>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 14 }} className="stack">
        {messages.length === 0 && (
          <p className="muted" style={{ fontSize: 13 }}>
            Ask about your numbers, sources, or settings.
            {role !== 'viewer' && ' I can also make changes for you, with a preview before anything applies.'}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className="stack" style={{ gap: 6 }}>
            <div
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                background: m.role === 'user' ? 'var(--accent-soft)' : 'var(--paper)',
                borderRadius: 10,
                padding: '8px 12px',
                maxWidth: '90%',
                fontSize: 14,
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content}
            </div>
            {m.proposals?.map((p) => (
              <ProposalCard key={p.id} proposal={p} onConfirm={() => confirm(i, p)} onRevert={() => revert(i, p)} onDecline={() => updateProposal(i, p.id, { status: 'declined' })} />
            ))}
          </div>
        ))}
        {busy && <div className="skeleton" style={{ minHeight: 24, maxWidth: 120 }} />}
      </div>
      <div className="row" style={{ padding: 10, borderTop: '1px solid var(--hairline)', gap: 6 }}>
        <input
          placeholder="Ask the assistant"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button className="primary" onClick={send} disabled={busy}>
          Send
        </button>
      </div>
    </>
  );
}

function ProposalCard({
  proposal,
  onConfirm,
  onDecline,
  onRevert,
}: {
  proposal: Proposal;
  onConfirm: () => void;
  onDecline: () => void;
  onRevert: () => void;
}) {
  const pretty = (v: unknown) => JSON.stringify(v, null, 1)?.slice(0, 600) ?? 'none';
  return (
    <div className="card stack" style={{ padding: 12, gap: 8, borderColor: 'var(--amber)' }}>
      <strong style={{ fontSize: 13 }}>Proposed change: {proposal.name.replace(/_/g, ' ')}</strong>
      <div style={{ fontSize: 12 }} className="stack">
        <span className="muted">Before</span>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', background: 'var(--paper)', padding: 6, borderRadius: 6 }}>
          {pretty(proposal.before)}
        </pre>
        <span className="muted">After</span>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', background: 'var(--paper)', padding: 6, borderRadius: 6 }}>
          {pretty(proposal.status === 'applied' || proposal.status === 'reverted' ? proposal.after : proposal.input)}
        </pre>
      </div>
      {proposal.status === 'pending' && (
        <div className="row">
          <button className="small primary" onClick={onConfirm}>
            Confirm and apply
          </button>
          <button className="small" onClick={onDecline}>
            Decline
          </button>
        </div>
      )}
      {proposal.status === 'applied' && (
        <div className="row">
          <span style={{ color: 'var(--verified-green)', fontSize: 13 }}>Applied and live</span>
          <button className="small" onClick={onRevert}>
            Revert
          </button>
        </div>
      )}
      {proposal.status === 'reverted' && <span className="muted" style={{ fontSize: 13 }}>Reverted</span>}
      {proposal.status === 'declined' && <span className="muted" style={{ fontSize: 13 }}>Declined</span>}
    </div>
  );
}
