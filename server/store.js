// Kullanıcı verisinin kalıcı deposu.
//  - MONGODB_URI tanımlıysa: MongoDB (ör. Atlas ücretsiz planı). Render ücretsiz planında disk olmadığı için bu kullanılır.
//  - Değilse: JSON dosyası (yerel geliştirme ya da kalıcı diskli sunucu).
// Oyun kullanıcıları bellekte tutar; kaydederken sadece değişen kullanıcıları yazar.
import { readFile, writeFile } from 'node:fs/promises';

export async function createUserStore({ file, mongoUri, skip = () => false }) {
  const snapshot = new Map(); // id -> son kaydedilen JSON

  const diff = users => {
    const changed = [];
    for (const [id, u] of Object.entries(users)) {
      if (skip(id)) continue;
      const json = JSON.stringify(u);
      if (snapshot.get(id) !== json) changed.push([id, u, json]);
    }
    const removed = [...snapshot.keys()].filter(id => !users[id]);
    return { changed, removed };
  };

  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    const col = client.db(process.env.MONGODB_DB || 'matchballer').collection('users');
    console.log('Kullanıcı verisi: MongoDB');
    return {
      async load() {
        const users = {};
        for (const doc of await col.find({}).toArray()) {
          const { _id, ...u } = doc;
          users[_id] = u;
          snapshot.set(_id, JSON.stringify(u));
        }
        return users;
      },
      async save(users) {
        const { changed, removed } = diff(users);
        const ops = [
          ...changed.map(([id, u]) => ({ replaceOne: { filter: { _id: id }, replacement: u, upsert: true } })),
          ...removed.map(id => ({ deleteOne: { filter: { _id: id } } })),
        ];
        if (!ops.length) return;
        await col.bulkWrite(ops, { ordered: false });
        for (const [id, , json] of changed) snapshot.set(id, json);
        for (const id of removed) snapshot.delete(id);
      },
    };
  }

  console.log('Kullanıcı verisi: dosya');
  return {
    async load() {
      try {
        const users = JSON.parse(await readFile(file, 'utf8'));
        for (const [id, u] of Object.entries(users)) snapshot.set(id, JSON.stringify(u));
        return users;
      } catch { return {}; } // ilk çalıştırma
    },
    async save(users) {
      const { changed, removed } = diff(users);
      if (!changed.length && !removed.length) return;
      const real = Object.fromEntries(Object.entries(users).filter(([id]) => !skip(id)));
      await writeFile(file, JSON.stringify(real, null, 2));
      snapshot.clear();
      for (const [id, u] of Object.entries(real)) snapshot.set(id, JSON.stringify(u));
    },
  };
}
