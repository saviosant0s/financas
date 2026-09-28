/*
  Utilitários compartilhados pelas funções da Pluggy (Open Finance).
  Pastas começando com "_" não viram rotas na Vercel.

  Variáveis de ambiente (Vercel → Settings → Environment Variables):
    PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET  — credenciais do painel da Pluggy (obrigatórias)
    PLUGGY_INCLUDE_SANDBOX=1                — mostra o banco de testes no widget (opcional)
    FIREBASE_API_KEY                        — opcional; usa a chave pública do app por padrão
*/
const PLUGGY = 'https://api.pluggy.ai';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyCHGFMDVlowr-ppnsnhVbDBCtsV29V4ry8';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let cachedKey = null;   // { key, exp } — a API key da Pluggy vale 2h; renovamos antes
async function pluggyApiKey() {
  if (cachedKey && cachedKey.exp > Date.now()) return cachedKey.key;
  const { PLUGGY_CLIENT_ID: clientId, PLUGGY_CLIENT_SECRET: clientSecret } = process.env;
  if (!clientId || !clientSecret) throw new HttpError(500, 'Open Finance não configurado no servidor (faltam PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET).');
  const res = await fetch(`${PLUGGY}/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret })
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.apiKey) throw new HttpError(502, 'Falha ao autenticar na Pluggy. Confira as credenciais.');
  cachedKey = { key: d.apiKey, exp: Date.now() + 100 * 60 * 1000 };
  return d.apiKey;
}

async function pluggy(path, opts = {}) {
  const key = await pluggyApiKey();
  const res = await fetch(PLUGGY + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': key, ...(opts.headers || {}) }
  });
  if (res.status === 204) return null;
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) cachedKey = null;
    throw new HttpError(res.status === 404 ? 404 : 502, d.message || `Erro da Pluggy (HTTP ${res.status})`);
  }
  return d;
}

/** Valida o ID token do Firebase enviado pelo app e devolve o uid do usuário. */
async function requireUser(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) throw new HttpError(401, 'Faça login para usar o Open Finance.');
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: m[1] })
  });
  const d = await res.json().catch(() => ({}));
  const uid = res.ok && d.users && d.users[0] && d.users[0].localId;
  if (!uid) throw new HttpError(401, 'Sessão inválida ou expirada.');
  return uid;
}

/** Busca a conexão (item) e garante que ela pertence ao usuário logado. */
async function ownedItem(itemId, uid) {
  if (!/^[0-9a-f-]{36}$/i.test(String(itemId || ''))) throw new HttpError(400, 'Conexão inválida.');
  const item = await pluggy(`/items/${itemId}`);
  if (!item || item.clientUserId !== uid) throw new HttpError(404, 'Conexão não encontrada.');
  return item;
}

function itemSummary(item) {
  return {
    id: item.id,
    name: (item.connector && item.connector.name) || 'Banco',
    status: item.status || '',
    error: (item.error && item.error.message) || '',
    lastUpdatedAt: item.lastUpdatedAt || item.updatedAt || ''
  };
}

/** Envolve um handler: só aceita os métodos informados e padroniza erros. */
function handler(methods, fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!methods.includes(req.method)) {
      res.setHeader('Allow', methods.join(', '));
      return res.status(405).json({ error: 'Método não permitido' });
    }
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.status(200).json(out);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) console.error(e);
      res.status(status).json({ error: e instanceof HttpError ? e.message : 'Erro interno' });
    }
  };
}

module.exports = { HttpError, pluggy, requireUser, ownedItem, itemSummary, handler };
