import { useEffect, useMemo, useState } from 'react';
import { IoArrowBackOutline, IoPersonOutline, IoPersonAddOutline, IoTrashOutline, IoCreateOutline } from 'react-icons/io5';
import { getContactDisplayName, getContacts, upsertContact, deleteContact } from '../services/contactsManager';
import { useCallStore } from '../store/callStore';
import { getCallHistory } from '../services/callHistory';

export default function Contacts({ compact = false, focusNumber = null }) {
  const [contacts, setContacts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [detailDraft, setDetailDraft] = useState({ firstName: '', lastName: '', number: '', notes: '' });
  const [showAddModal, setShowAddModal] = useState(false);
  const [addDraft, setAddDraft] = useState({ name: '', number: '' });
  const [contactHistory, setContactHistory] = useState([]);
  const contactsUpdatedAt = useCallStore(state => state.contactsUpdatedAt);
  const historyUpdatedAt = useCallStore(state => state.historyUpdatedAt);
  const setContactsUpdatedAt = useCallStore(state => state.setContactsUpdatedAt);

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

  useEffect(() => {
    if (focusNumber) {
      const match = contacts.find((contact) => contact.number === focusNumber);
      if (match) {
        setSelectedId(match.id);
      }
    }
  }, [focusNumber, contacts]);

  const selectedContact = useMemo(() => {
    return contacts.find((contact) => contact.id === selectedId) || null;
  }, [contacts, selectedId]);

  useEffect(() => {
    if (!selectedContact) {
      setIsEditing(false);
      return;
    }
    setDetailDraft({
      firstName: selectedContact.firstName || '',
      lastName: selectedContact.lastName || '',
      number: selectedContact.number || '',
      notes: selectedContact.notes || ''
    });
    setIsEditing(false);
  }, [selectedContact]);

  useEffect(() => {
    if (!selectedContact) {
      setContactHistory([]);
      return;
    }
    let active = true;
    getCallHistory()
      .then((items) => {
        if (!active) return;
        const filtered = items.filter((item) => item.number === selectedContact.number);
        setContactHistory(filtered);
      })
      .catch(() => {
        if (active) setContactHistory([]);
      });
    return () => {
      active = false;
    };
  }, [selectedContact, historyUpdatedAt]);

  const handleSaveAdd = async () => {
    if (!addDraft.name.trim()) return;
    if (!addDraft.number.trim()) return;

    const nameParts = addDraft.name.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ');

    const contact = {
      id: crypto.randomUUID(),
      firstName: firstName,
      lastName: lastName,
      name: addDraft.name.trim(),
      number: addDraft.number.trim(),
      updatedAt: Date.now()
    };
    const next = await upsertContact(contact);
    setContacts(next);
    setContactsUpdatedAt(Date.now());
    setShowAddModal(false);
    setAddDraft({ name: '', number: '' });
  };

  const handleSaveDetail = async () => {
    if (!selectedContact) return;
    if (!detailDraft.number.trim()) return;
    
    const contact = {
      id: selectedContact.id,
      firstName: detailDraft.firstName.trim(),
      lastName: detailDraft.lastName.trim(),
      name: `${detailDraft.firstName.trim()} ${detailDraft.lastName.trim()}`.trim(),
      number: detailDraft.number.trim(),
      notes: detailDraft.notes.trim(),
      updatedAt: Date.now()
    };
    const next = await upsertContact(contact);
    setContacts(next);
    setContactsUpdatedAt(Date.now());
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (!selectedContact) return;
    if (window.confirm('Are you sure you want to delete this contact? History will be preserved.')) {
      const next = await deleteContact(selectedContact.id);
      setContacts(next);
      setContactsUpdatedAt(Date.now());
      setSelectedId(null);
    }
  };

  const contentWidth = compact ? 'w-full' : 'w-full max-w-xl mx-auto';
  const sortedContacts = useMemo(() => {
    return [...contacts].sort((a, b) => getContactDisplayName(a).localeCompare(getContactDisplayName(b)));
  }, [contacts]);

  const timeFormatter = useMemo(() => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }, []);

  return (
    <div className={`flex flex-col h-full w-full ${compact ? 'p-4' : 'px-6 py-8'} gap-6`}>
      {!compact && (
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-semibold">Contacts</h2>
          <p className="text-sm text-base-content/60">Keep your most important people one tap away.</p>
        </div>
      )}
      <div className={`space-y-4 ${contentWidth}`}>
        {selectedContact ? (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button className="btn btn-sm btn-ghost" onClick={() => setSelectedId(null)}>
                  <IoArrowBackOutline className="h-4 w-4" />
                </button>
                <div>
                  <div className="text-xl font-semibold">{getContactDisplayName(selectedContact)}</div>
                  <div className="text-xs text-base-content/60 font-mono">{selectedContact.number}</div>
                </div>
              </div>
              {!isEditing && (
                <div className="flex gap-2">
                  <button className="btn btn-sm btn-ghost text-error" onClick={handleDelete} title="Delete Contact">
                    <IoTrashOutline className="h-4 w-4" />
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={() => setIsEditing(true)}>
                    <IoCreateOutline className="h-4 w-4" />
                    Edit
                  </button>
                </div>
              )}
            </div>

            <div className="card bg-base-100 border border-base-200 shadow-sm">
              <div className="card-body gap-3">
                <div className="text-xs font-semibold tracking-widest text-base-content/50 uppercase">
                  {isEditing ? 'Edit Contact' : 'Contact Details'}
                </div>
                
                {isEditing ? (
                  <div className="grid grid-cols-1 gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="form-control">
                        <label className="label">
                          <span className="label-text">First Name</span>
                        </label>
                        <input
                          type="text"
                          className="input input-bordered w-full"
                          value={detailDraft.firstName}
                          onChange={(e) => setDetailDraft((prev) => ({ ...prev, firstName: e.target.value }))}
                          placeholder="First Name"
                        />
                      </div>
                      <div className="form-control">
                        <label className="label">
                          <span className="label-text">Last Name</span>
                        </label>
                        <input
                          type="text"
                          className="input input-bordered w-full"
                          value={detailDraft.lastName}
                          onChange={(e) => setDetailDraft((prev) => ({ ...prev, lastName: e.target.value }))}
                          placeholder="Last Name"
                        />
                      </div>
                    </div>
                    
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text">Phone Number</span>
                      </label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        value={detailDraft.number}
                        onChange={(e) => setDetailDraft((prev) => ({ ...prev, number: e.target.value }))}
                        placeholder="Number"
                      />
                    </div>
                    
                    <div className="form-control flex flex-col">
                      <label className="label">
                        <span className="label-text">Notes</span>
                      </label>
                      <textarea
                        className="textarea textarea-bordered h-24 w-full"
                        value={detailDraft.notes}
                        onChange={(e) => setDetailDraft((prev) => ({ ...prev, notes: e.target.value }))}
                        placeholder="Add notes about this contact..."
                      ></textarea>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <button className="btn btn-ghost" onClick={() => setIsEditing(false)}>
                        Cancel
                      </button>
                      <button className="btn btn-primary" onClick={handleSaveDetail}>
                        Save Changes
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {selectedContact.firstName && (
                        <div>
                          <div className="text-xs text-base-content/50 mb-1">First Name</div>
                          <div className="text-base font-medium">{selectedContact.firstName}</div>
                        </div>
                      )}
                      {selectedContact.lastName && (
                        <div>
                          <div className="text-xs text-base-content/50 mb-1">Last Name</div>
                          <div className="text-base font-medium">{selectedContact.lastName}</div>
                        </div>
                      )}
                      {selectedContact.number && (
                        <div>
                          <div className="text-xs text-base-content/50 mb-1">Phone Number</div>
                          <div className="text-base font-medium font-mono">{selectedContact.number}</div>
                        </div>
                      )}
                    </div>
                    {selectedContact.notes && (
                      <div>
                        <div className="text-xs text-base-content/50 mb-1">Notes</div>
                        <div className="text-base whitespace-pre-wrap p-3 bg-base-200/50 rounded-lg">
                          {selectedContact.notes}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {!isEditing && (
              <div className="card bg-base-100 border border-base-200 shadow-sm">
                <div className="card-body gap-4">
                  <div className="text-xs font-semibold tracking-widest text-base-content/50 uppercase">Recent Calls</div>
                  {contactHistory.length === 0 ? (
                    <div className="text-sm text-base-content/60">No calls with this contact yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {contactHistory.map((item) => (
                        <div key={item.id} className="flex items-center justify-between rounded-2xl border border-base-200 bg-base-100 px-3 py-2">
                          <div>
                            <div className="text-sm font-medium">{item.direction === 'incoming' ? 'Incoming' : 'Outgoing'}</div>
                            <div className="text-xs text-base-content/50 capitalize">{item.status}</div>
                          </div>
                          <div className="text-xs text-base-content/60">{timeFormatter.format(new Date(item.endedAt || item.startedAt))}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold tracking-widest text-base-content/50 uppercase">
                Phone Book
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => setShowAddModal(true)}>
                <div className="flex items-center gap-2">
                  <IoPersonAddOutline className="h-4 w-4" />
                  <span>Add Contact</span>
                </div>
              </button>
            </div>
            {sortedContacts.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-base-content/60 py-10">
                <div className="text-xl font-semibold">No contacts yet</div>
                <div className="text-sm mt-2">Create a contact to make calling faster.</div>
              </div>
            ) : (
              <div className="grid gap-3">
                {sortedContacts.map((contact) => (
                  <div key={contact.id} className="card bg-base-100 border border-base-200 shadow-sm">
                    <button
                      type="button"
                      className="card-body p-4 flex-row items-center justify-between"
                      onClick={() => setSelectedId(contact.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-full bg-base-200 flex items-center justify-center text-base-content/70">
                          <IoPersonOutline className="h-5 w-5" />
                        </div>
                        <div className="text-left">
                          <div className="text-base font-semibold">{getContactDisplayName(contact)}</div>
                          <div className="text-xs text-base-content/50 font-mono">{contact.number}</div>
                        </div>
                      </div>
                      <div className="text-xs text-base-content/40">View</div>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-3xl bg-base-100 shadow-xl border border-base-200">
            <div className="p-6 space-y-4">
              <div>
                <div className="text-lg font-semibold">New Contact</div>
                <div className="text-xs text-base-content/60">Add a name and number to your phone book.</div>
              </div>
              <div className="space-y-3">
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={addDraft.name}
                  onChange={(e) => setAddDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Name"
                />
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={addDraft.number}
                  onChange={(e) => setAddDraft((prev) => ({ ...prev, number: e.target.value }))}
                  placeholder="Number"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn btn-ghost w-full" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary w-full" onClick={handleSaveAdd}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
