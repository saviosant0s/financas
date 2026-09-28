/*
  POST /api/pluggy/transactions  { itemId, from: 'AAAA-MM-DD' }
  Lista as transações de todas as contas (corrente e cartão) da conexão,
  já no formato usado pela importação do app.
*/
const { HttpError, pluggy, requireUser, ownedItem, itemSummary, handler } = require('../_lib/pluggy');

const MAX_PAGES = 10;   // 500 por página — limite de segurança por conta

async function accountTransactions(accountId, from) {
  const out = [];
  let qs = `?accountId=${encodeURIComponent(accountId)}&dateFrom=${from}`;
  for (let i = 0; qs && i < MAX_PAGES; i++) {
    const d = await pluggy(`/v2/transactions${qs}`);
    out.push(...(d.results || []));
    qs = d.next ? (d.next.startsWith('?') ? d.next : d.next.slice(d.next.indexOf('?'))) : null;
  }
  return out;
}

/** Pelo MeuPluggy todas as conexões se chamam "MeuPluggy"; o nome das contas diz qual banco é. */
function connectionName(item, accounts) {
  const base = (item.connector && item.connector.name) || 'Banco';
  if (!/meu ?pluggy/i.test(base)) return base;
  const names = [...new Set(accounts.map((a) => a.marketingName || a.name).filter(Boolean))].slice(0, 2);
  return names.length ? `MeuPluggy · ${names.join(', ')}` : base;
}

module.exports = handler(['POST'], async (req) => {
  const uid = await requireUser(req);
  const { itemId, from } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || ''))) throw new HttpError(400, 'Data inicial inválida.');
  const item = await ownedItem(itemId, uid);
  const accounts = (await pluggy(`/accounts?itemId=${item.id}`)).results || [];

  const perAccount = await Promise.all(accounts.map(async (acc) => {
    const isCard = acc.type === 'CREDIT';
    const accName = acc.marketingName || acc.name || (isCard ? 'Cartão' : 'Conta');
    const list = [];
    for (const t of await accountTransactions(acc.id, from)) {
      if (t.status === 'PENDING') continue;
      const amount = Number(t.amount);
      if (!isFinite(amount) || amount === 0) continue;
      // Na Pluggy o sinal pode variar por conta; "type" (DEBIT/CREDIT) é a direção confiável.
      const out = t.type ? t.type === 'DEBIT' : amount < 0;
      list.push({
        id: t.id,
        date: String(t.date || '').slice(0, 10),
        desc: t.description || t.descriptionRaw || 'Lançamento',
        val: Math.abs(amount),
        kind: out ? 'out' : 'in',
        account: accName,
        card: isCard,
        category: t.category || ''
      });
    }
    return list;
  }));

  return {
    item: { ...itemSummary(item), name: connectionName(item, accounts) },
    // Logo após conectar a Pluggy ainda está copiando os dados do banco
    updating: item.status === 'UPDATING' || (!accounts.length && !item.lastUpdatedAt),
    transactions: perAccount.flat()
  };
});
