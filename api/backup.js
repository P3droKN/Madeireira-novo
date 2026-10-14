import { kv, chaves, autorizar, responderErro, gravacaoBloqueada } from "./_lib.js";
import { montarBackup, salvarCopia, listarCopias, lerCopia } from "./_dados.js";

// GET              -> baixa o backup completo (e guarda uma cópia no KV)
// GET ?lista=1     -> nomes das cópias automáticas guardadas no KV
// GET ?copia=<nome> -> baixa uma dessas cópias
export default async function handler(request, response) {
  if (!autorizar(request, response)) return;
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  try {
    const k = chaves();
    if (request.query.lista) return response.status(200).json({ copias: await listarCopias(kv(), k) });

    let backup;
    if (request.query.copia) {
      backup = await lerCopia(kv(), k, String(request.query.copia));
    } else {
      if (!gravacaoBloqueada()) await salvarCopia(kv(), k, "download");
      backup = await montarBackup(kv(), k);
    }
    const dia = new Date().toISOString().slice(0, 10);
    response.setHeader("Content-Disposition", `attachment; filename="madeireira_backup_${k.ambiente}_${dia}.json"`);
    response.status(200).json(backup);
  } catch (error) {
    responderErro(response, error);
  }
}
