/*
  POST /api/pluggy/connect-token  { itemId? }
  Gera o token de curta duração que abre o widget Pluggy Connect.
  Com itemId, abre o widget para reconectar/atualizar aquela conexão.
*/
const { pluggy, requireUser, ownedItem, handler } = require('../_lib/pluggy');

module.exports = handler(['POST'], async (req) => {
  const uid = await requireUser(req);
  const itemId = req.body && req.body.itemId;
  if (itemId) await ownedItem(itemId, uid);
  const d = await pluggy('/connect_token', {
    method: 'POST',
    body: JSON.stringify({ ...(itemId ? { itemId } : {}), options: { clientUserId: uid, avoidDuplicates: true } })
  });
  return { accessToken: d.accessToken, sandbox: process.env.PLUGGY_INCLUDE_SANDBOX === '1' };
});
