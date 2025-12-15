// modules/storage.js
let state = {
  chats: [],
  currentChat: null
};

export function getState() {
  return state;
}

export function saveState() {
  localStorage.setItem("mathbot_state", JSON.stringify(state));
}

export function loadState() {
  const data = localStorage.getItem("mathbot_state");
  if (data) {
    const parsed = JSON.parse(data);
    state.chats = parsed.chats || [];
    state.currentChat = parsed.currentChat || null;
  }
}

export function getChats() {
  return state.chats;
}

export function setChats(chats) {
  state.chats = chats;
  saveState();
}

export function setCurrentChat(id) {
  state.currentChat = state.chats.find(c => c.id === id) || null;
  saveState();
}