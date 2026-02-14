import { useEffect, useMemo, useState } from 'react';
import { IoCallOutline, IoPersonAddOutline } from 'react-icons/io5';
import { getCallHistory } from '../services/callHistory';
import { useCallStore } from '../store/callStore';
import { getStoredKeys, getStoredNumber } from '../services/crypto';
import { getKeys as fetchKeys } from '../services/api';
import { sendCallSignal } from '../services/nostr';
import { getContactDisplayName, getContacts, upsertContact } from '../services/contactsManager';

export default function CallHistory({ compact = false, onViewContact }) {
  const [history, setHistory] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [savingId, setSavingId] = useState(null);
  const [modalItem, setModalItem] = useState(null);
  const [modalDraft, setModalDraft] = useState({ name: '', number: '' });
  const historyUpdatedAt = useCallStore(state => state.historyUpdatedAt);
  const contactsUpdatedAt = useCallStore(state => state.contactsUpdatedAt);
  const setContactsUpdatedAt = useCallStore(state => state.setContactsUpdatedAt);
  const startCalling = useCallStore(state => state.startCalling);

  useEffect(() => {
    let active = true;
    getCallHistory()
      .then((items) => {
        if (active) setHistory(items);
      })
      .catch(() => {
        if (active) setHistory([]);
      });
    return () => {
      active = false;
    };
  }, [historyUpdatedAt]);

  useEffect(() => {
    let active = true;
    getContacts()
      .then((items) => {
        if (active) setContacts(items);
      })
      .catch(() => {
        if (active) setContacts([]);
      });
    return () => {
      active = false;
    };
  }, [contactsUpdatedAt]);

  const dateFormatter = useMemo(() => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }, []);

  const timeFormatter = useMemo(() => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  }, []);

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs.toString().padStart(2, '0')}s`;
    }
    return `${secs}s`;
  };

  const groupedHistory = useMemo(() => {
    const groups = [];
    const byDay = new Map();
    history.forEach((item) => {
      const stamp = item.endedAt || item.startedAt || Date.now();
      const date = new Date(stamp);
      const key = date.toDateString();
      if (!byDay.has(key)) {
        byDay.set(key, { date, items: [] });
      }
      byDay.get(key).items.push(item);
    });
    Array.from(byDay.values()).forEach((group) => groups.push(group));
    return groups;
  }, [history]);

  const contactsByNumber = useMemo(() => {
    return contacts.reduce((acc, contact) => {
      acc[contact.number] = contact;
      return acc;
    }, {});
  }, [contacts]);

  const formatDayLabel = (date) => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return dateFormatter.format(date);
  };

  const handleCallBack = async (item) => {
    setLoadingId(item.id);
    try {
      const targetKeys = await fetchKeys(item.number);
      if (!targetKeys) throw new Error("Number not found");

      const callRoom = crypto.randomUUID();
      const callPassword = crypto.randomUUID();

      const myNumber = await getStoredNumber();
      const myKeys = await getStoredKeys();

      await sendCallSignal(item.number, targetKeys, myNumber, myKeys, callRoom, callPassword);

      startCalling(item.number, callRoom, callPassword);
    } catch (e) {
      console.error(e);
      alert(e.message || "Call failed");
    } finally {
      setLoadingId(null);
    }
  };

  const handleSaveContact = async (item) => {
    if (!modalDraft.name.trim()) return;
    if (!modalDraft.number.trim()) return;
    setSavingId(item.id);
    try {
      const contact = {
        id: crypto.randomUUID(),
        name: modalDraft.name.trim(),
        number: modalDraft.number.trim(),
        updatedAt: Date.now()
      };
      const next = await upsertContact(contact);
      setContacts(next);
      setContactsUpdatedAt(Date.now());
      setModalItem(null);
      setModalDraft({ name: '', number: '' });
    } catch (e) {
      console.error(e);
    } finally {
      setSavingId(null);
    }
  };

  const contentWidth = compact ? 'w-full' : 'w-full max-w-xl mx-auto';

  return (
    <div className={`flex flex-col h-full w-full ${compact ? 'p-4' : 'px-6 py-8'} gap-6 min-h-0`}>
      {!compact && (
        <div className="text-center space-y-2 shrink-0">
          <h2 className="text-3xl font-semibold">Call History</h2>
          <p className="text-sm text-base-content/60">Track your recent calls and reconnect quickly.</p>
        </div>
      )}
      <div className={`flex-1 overflow-y-auto min-h-0 ${contentWidth} ${compact ? 'pb-2' : 'pb-24'}`}>
        {history.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-base-content/60">
            <div className="text-xl font-semibold">No calls yet</div>
            <div className="text-sm mt-2">Your call activity will appear here.</div>
          </div>
        ) : (
          <div className="space-y-6">
            {groupedHistory.map((group) => (
              <div key={group.date.toDateString()} className="space-y-3">
                <div className="text-xs font-semibold tracking-widest text-base-content/50 uppercase px-1">
                  {formatDayLabel(group.date)}
                </div>
                <div className="space-y-2">
                  {group.items.map((item) => {
                    const isExpanded = expandedId === item.id;
                    const timeLabel = item.endedAt ? timeFormatter.format(new Date(item.endedAt)) : '';
                    const detailLine = `${item.direction === 'incoming' ? 'Incoming' : 'Outgoing'} • ${item.status.charAt(0).toUpperCase()}${item.status.slice(1)}`;
                    const duration = item.status === 'answered' ? ` • ${formatDuration(item.durationSec || 0)}` : '';
                    const contact = contactsByNumber[item.number];
                    const displayName = contact ? getContactDisplayName(contact) : item.number;
                    return (
                      <div key={item.id} className="card bg-base-100 border border-base-200 shadow-sm">
                        <button
                          type="button"
                          className="card-body p-4 flex-row items-center justify-between"
                          onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-12 w-12 rounded-full bg-base-200 flex items-center justify-center text-base-content/70">
                              <IoCallOutline className="h-5 w-5" />
                            </div>
                            <div className="text-left">
                              <div className="text-base font-semibold">{displayName}</div>
                              {contact && <div className="text-xs text-base-content/50 font-mono">{item.number}</div>}
                            </div>
                          </div>
                          <div className="text-xs text-base-content/60">{timeLabel}</div>
                        </button>
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-2 border-t border-base-200">
                            <div className="text-xs text-base-content/60">{detailLine}{duration}</div>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                className="btn btn-sm btn-primary w-full"
                                onClick={() => handleCallBack(item)}
                                disabled={loadingId === item.id}
                              >
                                {loadingId === item.id ? <span className="loading loading-spinner loading-sm"></span> : 'Call'}
                              </button>
                              {!contact ? (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline w-full"
                                  onClick={() => {
                                    setModalItem(item);
                                    setModalDraft({
                                      name: '',
                                      number: item.number
                                    });
                                  }}
                                >
                                  <div className="flex items-center gap-2">
                                    <IoPersonAddOutline className="h-4 w-4" />
                                    <span>Save</span>
                                  </div>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline w-full"
                                  onClick={() => onViewContact && onViewContact(item.number)}
                                >
                                  View
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {modalItem && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-3xl bg-base-100 shadow-xl border border-base-200">
            <div className="p-6 space-y-4">
              <div>
                <div className="text-lg font-semibold">Save Contact</div>
                <div className="text-xs text-base-content/60">Add a name for {modalItem.number}</div>
              </div>
              <div className="space-y-3">
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={modalDraft.name}
                  onChange={(e) => setModalDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Name"
                />
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={modalDraft.number}
                  readOnly
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn btn-ghost w-full" onClick={() => setModalItem(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary w-full"
                  onClick={() => handleSaveContact(modalItem)}
                  disabled={savingId === modalItem.id}
                >
                  {savingId === modalItem.id ? <span className="loading loading-spinner loading-sm"></span> : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
