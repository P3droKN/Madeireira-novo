// Servidor local: Redis falso no protocolo REST da Upstash + rotas /api reais + arquivos estáticos.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ = process.argv[2];
const PORTA = 4321;
const db = new Map();
const b64 = (v) => (typeof v === "string" ? Buffer.from(v).toString("base64") : Array.isArray(v) ? v.map(b64) : v);

function redis([cmd, ...a]) {
  cmd = cmd.toUpperCase();
  switch (cmd) {
    case "GET": return db.has(a[0]) ? db.get(a[0]) : null;
    case "SET": {
      const nx = a.map(String).map((s) => s.toUpperCase()).includes("NX");
      if (nx && db.has(a[0])) return null;
      db.set(a[0], String(a[1])); return "OK";
    }
    case "DEL": { let n = 0; for (const k of a) n += db.delete(k) ? 1 : 0; return n; }
    case "HGETALL": { const h = db.get(a[0]) || {}; return Object.entries(h).flat(); }
    case "HGET": return db.get(a[0])?.[a[1]] ?? null;
    case "HSET": { const h = db.get(a[0]) || {}; for (let i = 1; i < a.length; i += 2) h[a[i]] = String(a[i + 1]); db.set(a[0], h); return (a.length - 1) / 2; }
    case "HSETNX": { const h = db.get(a[0]) || {}; if (a[1] in h) return 0; h[a[1]] = String(a[2]); db.set(a[0], h); return 1; }
    case "HDEL": { const h = db.get(a[0]) || {}; let n = 0; for (const f of a.slice(1)) if (f in h) { delete h[f]; n++; } return n; }
    case "HMGET": { const h = db.get(a[0]) || {}; return a.slice(1).map((f) => (f in h ? h[f] : null)); }
    case "INCR": { const v = Number(db.get(a[0]) || 0) + 1; db.set(a[0], String(v)); return v; }
    case "HLEN": return Object.keys(db.get(a[0]) || {}).length;
    case "LPUSH": { const l = db.get(a[0]) || []; for (const v of a.slice(1)) l.unshift(String(v)); db.set(a[0], l); return l.length; }
    case "LRANGE": { const l = db.get(a[0]) || []; const b = Number(a[2]); return l.slice(Number(a[1]), b === -1 ? undefined : b + 1); }
    case "LTRIM": { const l = db.get(a[0]) || []; db.set(a[0], l.slice(Number(a[1]), Number(a[2]) + 1)); return "OK"; }
    default: throw new Error("comando não suportado: " + cmd);
  }
}

// Estado inicial = sistema antigo em produção (dados-iniciais.json)
const inicial = JSON.parse(fs.readFileSync(process.env.SEED || path.join(RAIZ, "dados-iniciais.json"), "utf8"));
if (!process.env.VAZIO) {
  db.set("madeireira_finance", JSON.stringify(inicial.financeItems));
  db.set("madeireira_acumulado", JSON.stringify(inicial.acumulado));
}

process.env.KV_REST_API_URL = `http://localhost:${PORTA}/__redis`;
process.env.KV_REST_API_TOKEN = "falso";
process.env.SENHA_APP = "pinho123";
process.env.VERCEL_ENV = "production";
delete process.env.UPSTASH_REDIS_REST_URL;

const tipos = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let corpo = "";
  for await (const c of req) corpo += c;

  if (url.pathname === "/__redis/pipeline" || url.pathname === "/__redis/multi-exec") {
    const enc = req.headers["upstash-encoding"] === "base64";
    const out = JSON.parse(corpo).map((c) => { try { const r = redis(c); return { result: enc ? b64(r) : r }; } catch (e) { return { error: e.message }; } });
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify(out));
  }
  if (url.pathname === "/__redis") {
    try {
      const out = redis(JSON.parse(corpo));
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ result: req.headers["upstash-encoding"] === "base64" ? b64(out) : out }));
    } catch (e) { res.statusCode = 400; return res.end(JSON.stringify({ error: e.message })); }
  }
  if (url.pathname === "/__db") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(Object.fromEntries(db))); }

  // Simula a Vercel derrubando pedidos de importação escolhidos (ex.: FALHAR_IMPORTAR=3,4,5)
  if (url.pathname === "/api/importar") {
    globalThis.nImport = (globalThis.nImport || 0) + 1;
    const falhar = (process.env.FALHAR_IMPORTAR || "").split(",").map(Number);
    if (falhar.includes(globalThis.nImport)) { res.statusCode = 504; res.setHeader("content-type", "text/html"); return res.end("<html>FUNCTION_INVOCATION_TIMEOUT</html>"); }
  }
  if (url.pathname.startsWith("/api/")) {
    // Igual à Vercel: arquivo com o mesmo nome, senão a rota dinâmica api/[recurso].js
    const nome = url.pathname.slice("/api/".length);
    let arquivo = path.join(RAIZ, "api", nome + ".js");
    const query = Object.fromEntries(url.searchParams);
    if (!fs.existsSync(arquivo) || nome.startsWith("_") || nome.includes("/")) {
      arquivo = path.join(RAIZ, "api", "[recurso].js");
      query.recurso = nome;
    }
    if (!fs.existsSync(arquivo)) { res.statusCode = 404; return res.end("{}"); }
    const { default: handler } = await import(pathToFileURL(arquivo).href);
    req.query = query;
    req.body = corpo ? JSON.parse(corpo) : undefined;
    res.status = (s) => { res.statusCode = s; return res; };
    res.json = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); return res; };
    try { return await handler(req, res); } catch (e) { res.statusCode = 500; return res.end(JSON.stringify({ error: e.message })); }
  }
  const f = path.join(RAIZ, url.pathname === "/" ? "index.html" : url.pathname);
  if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", tipos[path.extname(f)] || "application/octet-stream");
  fs.createReadStream(f).pipe(res);
}).listen(PORTA, () => console.log("ok " + PORTA));
