// Presence is intentionally process-local and ephemeral. It is only a hint for
// connected sockets, never a durable availability or delivery guarantee.
const connected = new Map();
const add = (userId) => connected.set(String(userId), (connected.get(String(userId)) || 0) + 1);
const remove = (userId) => {
  const key = String(userId); const count = (connected.get(key) || 0) - 1;
  if (count > 0) connected.set(key, count); else connected.delete(key);
};
const isOnline = (userId) => (connected.get(String(userId)) || 0) > 0;
module.exports = { add, remove, isOnline };