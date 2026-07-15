'use client';

// Demo-only campaign editor: lets whoever is driving the demo add, edit,
// and remove campaigns/creatives for the current channel on the fly,
// without asking an engineer to change code. Edits save to this
// browser's localStorage only (see getEditableCampaignRows/
// saveEditableCampaignRows in lib/demoData) - never touches the
// codebase, never affects any other session, and "Reset to demo
// defaults" always gets back to a known-good state. Real (non-demo)
// tenants never see this; gated by isDemoMode() at the call site in
// Performance.tsx.
//
// Locked to a single channel (passed in, not switchable here): this
// editor is mounted once per Meta/Google Ads tab, and each of those
// tabs already scopes everything else on the page to its own channel.
// Letting the editor flip between Meta and Google on its own let you
// edit the other channel's campaigns from inside the wrong tab.

import { useState } from 'react';
import {
  getEditableCampaignRows,
  saveEditableCampaignRows,
  resetEditableCampaignRows,
  hasCampaignOverride,
  type CampaignRow,
} from '@/lib/demoData';

const CREATIVE_TYPE_OPTIONS = ['Video', 'Carousel', 'Static', 'UGC', 'Other'];
const CAMPAIGN_TYPE_OPTIONS: Record<'meta' | 'google', string[]> = {
  meta: ['Lead Generation', 'Conversions / Sales', 'Traffic', 'Awareness', 'Engagement', 'Retargeting', 'Other'],
  google: ['Search', 'Performance Max', 'Display', 'Video / YouTube', 'Shopping', 'Demand Gen', 'Other'],
};

interface NewCreativeDraft {
  ad: string;
  creativeType: string;
  spend: string;
  leads: string;
  shows: string;
  bookings: string;
}

function blankDraft(): NewCreativeDraft {
  return { ad: '', creativeType: '', spend: '', leads: '', shows: '', bookings: '' };
}

function toNumber(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function DemoCampaignEditor({
  clientId,
  month,
  channel,
  onChange,
  onClose,
}: {
  clientId: string;
  month: string;
  channel: 'meta' | 'google';
  onChange: () => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<CampaignRow[]>(() => getEditableCampaignRows(clientId, month, channel));
  // Only one campaign is ever open for editing at a time - opening
  // another closes the previous one, so edits stay in one clearly
  // focused spot instead of every campaign showing raw inputs at once.
  const [editingCampaign, setEditingCampaign] = useState<string | null>(null);
  const [newCreativeDrafts, setNewCreativeDrafts] = useState<Record<string, NewCreativeDraft>>({});
  const [addingCampaign, setAddingCampaign] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [newCampaignType, setNewCampaignType] = useState('');
  const [newCampaignDraft, setNewCampaignDraft] = useState<NewCreativeDraft>(blankDraft());

  const persist = (next: CampaignRow[]) => {
    setRows(next);
    saveEditableCampaignRows(clientId, month, channel, next);
    onChange();
  };

  const campaignNames = [...new Set(rows.map((r) => r.campaign))];
  const typeOptions = CAMPAIGN_TYPE_OPTIONS[channel];
  const isEdited = hasCampaignOverride(clientId, month, channel);

  const updateRow = (index: number, patch: Partial<CampaignRow>) => {
    persist(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeCreative = (index: number) => {
    persist(rows.filter((_, i) => i !== index));
  };

  const removeCampaign = (campaign: string) => {
    if (!confirm(`Remove "${campaign}" and all of its creatives? You can always bring it back with "Reset to demo defaults".`)) {
      return;
    }
    if (editingCampaign === campaign) setEditingCampaign(null);
    persist(rows.filter((r) => r.campaign !== campaign));
  };

  const addCreative = (campaign: string, campaignType: string) => {
    const draft = newCreativeDrafts[campaign] ?? blankDraft();
    if (!draft.ad.trim()) return;
    const row: CampaignRow = {
      campaign,
      campaignType,
      ad: draft.ad.trim(),
      creativeType: draft.creativeType || null,
      spend: toNumber(draft.spend),
      leads: toNumber(draft.leads),
      shows: toNumber(draft.shows),
      bookings: toNumber(draft.bookings),
    };
    persist([...rows, row]);
    setNewCreativeDrafts((prev) => ({ ...prev, [campaign]: blankDraft() }));
  };

  const addCampaign = () => {
    if (!newCampaignName.trim() || !newCampaignDraft.ad.trim()) return;
    const row: CampaignRow = {
      campaign: newCampaignName.trim(),
      campaignType: newCampaignType || typeOptions[0]!,
      ad: newCampaignDraft.ad.trim(),
      creativeType: newCampaignDraft.creativeType || null,
      spend: toNumber(newCampaignDraft.spend),
      leads: toNumber(newCampaignDraft.leads),
      shows: toNumber(newCampaignDraft.shows),
      bookings: toNumber(newCampaignDraft.bookings),
    };
    persist([...rows, row]);
    setNewCampaignName('');
    setNewCampaignType('');
    setNewCampaignDraft(blankDraft());
    setAddingCampaign(false);
  };

  const doReset = () => {
    if (!confirm('Reset this channel back to the original demo numbers? Any campaigns or edits you made here will be lost.')) {
      return;
    }
    resetEditableCampaignRows(clientId, month, channel);
    setRows(getEditableCampaignRows(clientId, month, channel));
    setEditingCampaign(null);
    onChange();
  };

  return (
    <div className="card stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="stack" style={{ gap: 2 }}>
          <h3 style={{ margin: 0 }}>Manage campaigns</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Saved to this browser only - never touches real client data or other sessions.
          </span>
        </div>
        <div className="row" style={{ width: 'auto', gap: 8 }}>
          {isEdited && (
            <button className="small" onClick={doReset}>
              Reset to demo defaults
            </button>
          )}
          <button className="small" onClick={onClose}>
            Done
          </button>
        </div>
      </div>

      <button
        className="small primary"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => {
          setAddingCampaign((v) => !v);
          setEditingCampaign(null);
        }}
      >
        {addingCampaign ? 'Cancel' : '+ Add campaign'}
      </button>

      {addingCampaign && (
        <div className="campaign-block stack" style={{ gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>New {channel} campaign</span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <input
              placeholder="Campaign name"
              value={newCampaignName}
              onChange={(e) => setNewCampaignName(e.target.value)}
              style={{ width: 'auto', flex: '1 1 180px' }}
            />
            <select value={newCampaignType} onChange={(e) => setNewCampaignType(e.target.value)} style={{ width: 'auto' }}>
              <option value="">{typeOptions[0]}</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <input
              placeholder="First creative name"
              value={newCampaignDraft.ad}
              onChange={(e) => setNewCampaignDraft((d) => ({ ...d, ad: e.target.value }))}
              style={{ width: 'auto', flex: '1 1 160px' }}
            />
            <select
              value={newCampaignDraft.creativeType}
              onChange={(e) => setNewCampaignDraft((d) => ({ ...d, creativeType: e.target.value }))}
              style={{ width: 'auto' }}
            >
              <option value="">Untagged</option>
              {CREATIVE_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              placeholder="Spend"
              value={newCampaignDraft.spend}
              onChange={(e) => setNewCampaignDraft((d) => ({ ...d, spend: e.target.value }))}
              style={{ width: 90 }}
            />
            <input
              type="number"
              min={0}
              placeholder="Leads"
              value={newCampaignDraft.leads}
              onChange={(e) => setNewCampaignDraft((d) => ({ ...d, leads: e.target.value }))}
              style={{ width: 70 }}
            />
            <input
              type="number"
              min={0}
              placeholder="Shows"
              value={newCampaignDraft.shows}
              onChange={(e) => setNewCampaignDraft((d) => ({ ...d, shows: e.target.value }))}
              style={{ width: 70 }}
            />
            <input
              type="number"
              min={0}
              placeholder="Bookings"
              value={newCampaignDraft.bookings}
              onChange={(e) => setNewCampaignDraft((d) => ({ ...d, bookings: e.target.value }))}
              style={{ width: 70 }}
            />
          </div>
          <button className="primary small" style={{ alignSelf: 'flex-start' }} onClick={addCampaign}>
            Add campaign
          </button>
        </div>
      )}

      {campaignNames.length === 0 && !addingCampaign && (
        <p className="muted" style={{ fontSize: 13 }}>
          No {channel} campaigns yet. Add one above.
        </p>
      )}

      <div className="stack" style={{ gap: 8 }}>
        {campaignNames.map((campaignName) => {
          const campaignRows = rows
            .map((r, i) => ({ r, i }))
            .filter(({ r }) => r.campaign === campaignName);
          const campaignType = campaignRows[0]!.r.campaignType;
          const totalSpend = campaignRows.reduce((a, { r }) => a + r.spend, 0);
          const isOpen = editingCampaign === campaignName;
          const draft = newCreativeDrafts[campaignName] ?? blankDraft();

          return (
            <div key={campaignName} className="campaign-block stack" style={{ gap: isOpen ? 12 : 0 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <span className="row" style={{ width: 'auto', gap: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{campaignName}</span>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {campaignType} &middot; {campaignRows.length} creative{campaignRows.length === 1 ? '' : 's'} &middot;{' '}
                    ${totalSpend.toLocaleString()} spend
                  </span>
                </span>
                <button
                  className="small"
                  onClick={() => {
                    setEditingCampaign(isOpen ? null : campaignName);
                    setAddingCampaign(false);
                  }}
                >
                  {isOpen ? 'Close' : 'Edit'}
                </button>
              </div>

              {isOpen && (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Creative</th>
                          <th>Type</th>
                          <th>Spend</th>
                          <th>Leads</th>
                          <th>Shows</th>
                          <th>Bookings</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {campaignRows.map(({ r, i }) => (
                          <tr key={i}>
                            <td>
                              <input
                                value={r.ad}
                                onChange={(e) => updateRow(i, { ad: e.target.value })}
                                style={{ minWidth: 160 }}
                              />
                            </td>
                            <td>
                              <select
                                value={r.creativeType ?? ''}
                                onChange={(e) => updateRow(i, { creativeType: e.target.value || null })}
                                style={{ width: 'auto' }}
                              >
                                <option value="">Untagged</option>
                                {CREATIVE_TYPE_OPTIONS.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                type="number"
                                min={0}
                                value={r.spend}
                                onChange={(e) => updateRow(i, { spend: toNumber(e.target.value) })}
                                style={{ width: 90 }}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min={0}
                                value={r.leads}
                                onChange={(e) => updateRow(i, { leads: toNumber(e.target.value) })}
                                style={{ width: 70 }}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min={0}
                                value={r.shows}
                                onChange={(e) => updateRow(i, { shows: toNumber(e.target.value) })}
                                style={{ width: 70 }}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min={0}
                                value={r.bookings}
                                onChange={(e) => updateRow(i, { bookings: toNumber(e.target.value) })}
                                style={{ width: 70 }}
                              />
                            </td>
                            <td>
                              <button className="small" onClick={() => removeCreative(i)}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <input
                      placeholder="New creative name"
                      value={draft.ad}
                      onChange={(e) => setNewCreativeDrafts((prev) => ({ ...prev, [campaignName]: { ...draft, ad: e.target.value } }))}
                      style={{ width: 'auto', flex: '1 1 160px' }}
                    />
                    <select
                      value={draft.creativeType}
                      onChange={(e) => setNewCreativeDrafts((prev) => ({ ...prev, [campaignName]: { ...draft, creativeType: e.target.value } }))}
                      style={{ width: 'auto' }}
                    >
                      <option value="">Untagged</option>
                      {CREATIVE_TYPE_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      placeholder="Spend"
                      value={draft.spend}
                      onChange={(e) => setNewCreativeDrafts((prev) => ({ ...prev, [campaignName]: { ...draft, spend: e.target.value } }))}
                      style={{ width: 90 }}
                    />
                    <input
                      type="number"
                      min={0}
                      placeholder="Leads"
                      value={draft.leads}
                      onChange={(e) => setNewCreativeDrafts((prev) => ({ ...prev, [campaignName]: { ...draft, leads: e.target.value } }))}
                      style={{ width: 70 }}
                    />
                    <input
                      type="number"
                      min={0}
                      placeholder="Shows"
                      value={draft.shows}
                      onChange={(e) => setNewCreativeDrafts((prev) => ({ ...prev, [campaignName]: { ...draft, shows: e.target.value } }))}
                      style={{ width: 70 }}
                    />
                    <input
                      type="number"
                      min={0}
                      placeholder="Bookings"
                      value={draft.bookings}
                      onChange={(e) => setNewCreativeDrafts((prev) => ({ ...prev, [campaignName]: { ...draft, bookings: e.target.value } }))}
                      style={{ width: 70 }}
                    />
                    <button className="small" onClick={() => addCreative(campaignName, campaignType)}>
                      Add creative
                    </button>
                  </div>

                  <button className="small" style={{ alignSelf: 'flex-start' }} onClick={() => removeCampaign(campaignName)}>
                    Remove campaign
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
