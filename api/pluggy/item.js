/*
  GET    /api/pluggy/item?id=…  → nome e status da conexão
  DELETE /api/pluggy/item?id=…  → desconecta o banco e apaga os dados na Pluggy
*/
const { pluggy, requireUser, ownedItem, itemSummary, handler } = require('../_lib/pluggy');

module.exports = handler(['GET', 'DELETE'], async (req) => {
  const uid = await requireUser(req);
  const item = await ownedItem(req.query.id, uid);
  if (req.method === 'DELETE') {
    await pluggy(`/items/${item.id}`, { method: 'DELETE' });
    return { ok: true };
  }
  return itemSummary(item);
});
