// Tiny Server-Sent-Events broker. Each connected client carries `meta`
// ({ role: 'hub' | 'table', tableNo }) so send() can target subscribers.

export function createBroker() {
  let clients = [];
  let nextId = 1;

  function addClient(res, meta = {}) {
    const id = nextId++;
    clients.push({ id, res, meta });
    return id;
  }

  function removeClient(id) {
    clients = clients.filter((c) => c.id !== id);
  }

  /** send(event, data[, predicate]) — predicate(meta) decides who receives it. */
  function send(event, data, predicate) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) {
      if (predicate && !predicate(c.meta)) continue;
      try {
        c.res.write(frame);
      } catch {
        // dead connection; it will be reaped on 'close'
      }
    }
  }

  return {
    addClient,
    removeClient,
    send,
    count: () => clients.length,
  };
}
