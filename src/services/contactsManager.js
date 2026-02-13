import { db } from './db';
import { encryptData, decryptData } from './crypto';

const CONTACTS_KEY = 'contacts';

async function loadContacts() {
  const encrypted = await db.contacts.get(CONTACTS_KEY);
  if (!encrypted) return [];
  try {
    const contacts = await decryptData(encrypted);
    return Array.isArray(contacts) ? contacts : [];
  } catch (e) {
    console.error("Failed to decrypt contacts", e);
    return [];
  }
}

async function saveContacts(contacts) {
  const encrypted = await encryptData(contacts);
  await db.contacts.put(CONTACTS_KEY, encrypted);
}

export async function getContacts() {
  return await loadContacts();
}

export async function upsertContact(contact) {
  const contacts = await loadContacts();
  const normalized = {
    id: contact.id || crypto.randomUUID(),
    firstName: contact.firstName || '',
    lastName: contact.lastName || '',
    name: contact.name || '',
    number: contact.number || '',
    notes: contact.notes || '',
    updatedAt: contact.updatedAt || Date.now()
  };
  const existingIndex = contacts.findIndex((item) => item.number === normalized.number);
  if (existingIndex >= 0) {
    contacts[existingIndex] = { ...contacts[existingIndex], ...normalized };
  } else {
    contacts.unshift(normalized);
  }
  await saveContacts(contacts);
  return contacts;
}

export async function deleteContact(id) {
  const contacts = await loadContacts();
  const index = contacts.findIndex((c) => c.id === id);
  if (index >= 0) {
    contacts.splice(index, 1);
    await saveContacts(contacts);
  }
  return contacts;
}

export async function getContactByNumber(number) {
  const contacts = await loadContacts();
  return contacts.find((contact) => contact.number === number) || null;
}

export function getContactDisplayName(contact) {
  if (!contact) return '';
  const fullName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
  if (fullName) return fullName;
  if (contact.name) return contact.name;
  return contact.number || '';
}
