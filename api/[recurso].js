// Roteador único da API: /api/<recurso> -> ROTAS[recurso] (ver api/_rotas.js).
// Uma função só na Vercel, para não esbarrar no limite de 12 funções do plano Hobby.
import { ROTAS } from "./_rotas.js";

export default async function handler(request, response) {
  const recurso = String(request.query?.recurso || "");
  const rota = Object.hasOwn(ROTAS, recurso) ? ROTAS[recurso] : null;
  if (!rota) return response.status(404).json({ error: `Rota /api/${recurso} não existe.` });
  // A Vercel junta o parâmetro do caminho em request.query; as rotas não precisam dele
  if (request.query) delete request.query.recurso;
  return rota(request, response);
}
