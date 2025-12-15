// modules/chat.js
import { saveState, getState, setCurrentChat } from "./storage.js";

export function addChat(name) {
  const { chats } = getState();
  const id = crypto.randomUUID();
  const newChat = { id, name, messages: [] };
  chats.push(newChat);
  setCurrentChat(id);
  saveState();
  return id;
}

export function selectChat(id) {
  setCurrentChat(id);
  saveState();
}

export function sendMessage(chatId, message) {
  const { chats } = getState();
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return;
  chat.messages.push(message);
  saveState();
}

export function deleteChat(chatId) {
  let { chats } = getState();
  chats = chats.filter(c => c.id !== chatId);
  if (chats.length > 0) setCurrentChat(chats[0].id);
  else setCurrentChat(null);
  saveState();
  return chats;
}

export function renameChat(chatId, newName) {
  const { chats } = getState();
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return;
  chat.name = newName;
  saveState();
}

export function clearMessages(chatId) {
  const { chats } = getState();
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return;
  chat.messages = [];
  saveState();
}
