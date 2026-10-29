// Todas as rotas da API num arquivo só. Quem atende é api/[recurso].js (uma única função na Vercel),
// então novas rotas não contam no limite de 12 funções do plano Hobby. Os endereços continuam os mesmos:
// /api/getFinance, /api/lancamento, /api/orcamentos...
import { kv, chaves, autorizar, lerCustos, responderErro, statusBanco, gravacaoBloqueada } from "./_lib.js";
import {
  lerTudo, salvarLancamentos, excluirLancamento, reclassificar, atualizarCheque, salvarAcumulado,
  montarBackup, salvarCopia, listarCopias, lerCopia, lerPrecosEConfig, salvarPrecos,
  salvarConfig, salvarConfigFinanceiro, salvarAbertura, registrarConferencia,
  importar, migrar, migrarV2, restaurar, marcarImpresso,
  listarOrcamentos, salvarOrcamento, atualizarOrcamento, salvarCliente, listarClientes, zerarMovimento,
} from "./_dados.js";
import { CEPILHADO_PADRAO, montarCatalogo, chavePrecoValida } from "../lib/catalogo.js";
import { resumirLancamentos } from "../lib/resumo.js";

const naoPermitido = (response) => response.status(405).json({ error: "Method not allowed" });

// Envolve a rota: senha, método aceito e erro padronizado
function rota(metodos, fn) {
  return async (request, response) => {
    if (!autorizar(request, response)) return;
    if (metodos && !metodos.includes(request.method)) return naoPermitido(response);
    try {
      await fn(request, response);
    } catch (error) {
      responderErro(response, error);
    }
  };
}

export const ROTAS = {
  // GET -> lançamentos, acumulado, config financeira, saldos e status do banco
  getFinance: rota(null, async (request, response) => {
    const { migrado, migradoV2, financeItems, estornados, acumulado, configFinanceiro, saldos } = await lerTudo(kv(), chaves());
    response.status(200).json({
      migrado,
      migradoV2,
      configFinanceiro,
      saldos,
      ambiente: chaves().ambiente,
      status: statusBanco(),
      financeItems,
      estornados,
      acumulado: acumulado || { venda: 0, pix: 0, credito: 0, debito: 0, custo: 0, despesa: 0, func: 0, dinheiroCaixa: 0 },
    });
  }),

  // POST { itens: [...] } cria/edita lançamentos. DELETE ?id= marca como excluído.
  // PATCH { ids, conta?, forma?, aceitarSugestao? } reclassifica em lote; PATCH { acao: "cheque", ... } atualiza um cheque.
  lancamento: rota(null, async (request, response) => {
    if (request.method === "POST") {
      return response.status(200).json(await salvarLancamentos(kv(), chaves(), request.body?.itens));
    }
    if (request.method === "PATCH") {
      if (request.body?.acao === "cheque") return response.status(200).json({ lancamento: await atualizarCheque(kv(), chaves(), request.body) });
      if (request.body?.acao === "impresso") return response.status(200).json(await marcarImpresso(kv(), chaves(), request.body.id));
      return response.status(200).json(await reclassificar(kv(), chaves(), request.body));
    }
    if (request.method === "DELETE") {
      return response.status(200).json(await excluirLancamento(kv(), chaves(), request.query.id));
    }
    naoPermitido(response);
  }),

  // POST { acumulado } -> "Saldos passados"
  acumulado: rota(["POST"], async (request, response) => {
    response.status(200).json({ acumulado: await salvarAcumulado(kv(), chaves(), request.body?.acumulado) });
  }),

  // GET              -> baixa o backup completo (e guarda uma cópia no KV)
  // GET ?lista=1     -> nomes das cópias automáticas guardadas no KV
  // GET ?copia=<nome> -> baixa uma dessas cópias
  backup: rota(["GET"], async (request, response) => {
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
  }),

  // Custos (data/custos.json) + preços de venda e config (KV).
  // Sem banco, devolve só os custos: a calculadora funciona e o vendedor digita os preços.
  catalogo: rota(null, async (request, response) => {
    const custos = lerCustos();
    let precos = {}, config = {}, kvDisponivel = true;
    try {
      ({ precos, config } = await lerPrecosEConfig(kv(), chaves()));
    } catch (e) {
      console.warn("KV indisponível para preços:", e.message);
      kvDisponivel = false;
    }
    response.status(200).json({ custos, precos, config, kvDisponivel });
  }),

  // POST { config: {...} }      -> ajustes da calculadora (modificadores, cepilhado)
  // POST { financeiro: {...} }  -> configuração financeira (formas, cartão, CMV, pessoal, impostos)
  // POST { abertura: {...} }    -> abertura de saldos (dia da troca)
  // POST { conferencia: {...} } -> conferência de saldo de uma conta
  config: rota(["POST"], async (request, response) => {
    if (request.body?.abertura) return response.status(200).json({ saldos: await salvarAbertura(kv(), chaves(), request.body.abertura) });
    if (request.body?.conferencia) return response.status(200).json({ conferencia: await registrarConferencia(kv(), chaves(), request.body.conferencia) });
    if (request.body?.financeiro) {
      return response.status(200).json({ financeiro: await salvarConfigFinanceiro(kv(), chaves(), request.body.financeiro) });
    }
    const config = await salvarConfig(kv(), chaves(), request.body?.config, Object.keys(CEPILHADO_PADRAO));
    response.status(200).json({ config });
  }),

  // Junta os lançamentos do arquivo aos existentes. Não apaga nem altera nada.
  importar: rota(["POST"], async (request, response) => {
    response.status(200).json(await importar(kv(), chaves(), request.body));
  }),

  // POST            -> ativa o salvamento seguro (lista antiga -> lançamento a lançamento)
  // POST ?versao=2  -> migra para o financeiro novo (plano de contas, formas, abertura de agosto)
  migrar: rota(["POST"], async (request, response) => {
    const r = request.query.versao === "2" ? await migrarV2(kv(), chaves()) : await migrar(kv(), chaves());
    response.status(200).json(r);
  }),

  // GET                       -> { orcamentos, clientes }
  // POST { orcamento }        -> cria (número novo) ou edita (com id)
  // POST { cliente }          -> cria/atualiza cliente (chave: telefone)
  // PATCH { id, acao, ... }   -> contato, perdido, reabrir, fechar, precos, excluir, restaurar
  orcamentos: rota(null, async (request, response) => {
    const k = chaves();
    if (request.method === "GET") return response.status(200).json(await listarOrcamentos(kv(), k));
    if (request.method === "POST") {
      if (request.body?.cliente && !request.body?.orcamento) return response.status(200).json({ cliente: await salvarCliente(kv(), k, request.body.cliente) });
      const cfg = (await kv().get(k.configFinanceiro)) || {};
      return response.status(200).json({ orcamento: await salvarOrcamento(kv(), k, request.body?.orcamento, cfg) });
    }
    if (request.method === "PATCH") return response.status(200).json({ orcamento: await atualizarOrcamento(kv(), k, request.body) });
    naoPermitido(response);
  }),

  // Cadastro de clientes (orçamentos e fiado)
  // GET               -> { clientes }
  // POST { cliente }  -> cria (pelo WhatsApp, ou C1, C2… sem WhatsApp) ou edita (com id)
  clientes: rota(["GET", "POST"], async (request, response) => {
    if (request.method === "GET") return response.status(200).json(await listarClientes(kv(), chaves()));
    response.status(200).json({ cliente: await salvarCliente(kv(), chaves(), request.body?.cliente) });
  }),

  // POST { alteracoes: { "<item>|<acabamento>": preço ou null } }
  precos: rota(["POST"], async (request, response) => {
    const catalogo = montarCatalogo(lerCustos());
    const r = await salvarPrecos(kv(), chaves(), request.body?.alteracoes, (c) => chavePrecoValida(catalogo, c));
    response.status(200).json(r);
  }),

  // POST { confirmacao: "RESTAURAR", arquivo: <conteúdo do backup> }
  restaurar: async (request, response) => {
    if (!autorizar(request, response)) return;
    if (request.method !== "POST") return naoPermitido(response);
    if (request.body?.confirmacao !== "RESTAURAR") {
      return response.status(400).json({ error: 'Envie confirmacao: "RESTAURAR".' });
    }
    try {
      response.status(200).json(await restaurar(kv(), chaves(), request.body.arquivo));
    } catch (error) {
      responderErro(response, error);
    }
  },

  // POST { confirmacao: "ZERAR" } -> apaga o movimento e mantém preços e ajustes (só no dia da virada)
  zerar: rota(["POST"], async (request, response) => {
    response.status(200).json(await zerarMovimento(kv(), chaves(), request.body, statusBanco().zerarPermitido));
  }),

  // Resumo do banco (quantidade e totais por mês, acumulado) para conferir com um arquivo de backup.
  resumo: rota(null, async (request, response) => {
    const { migrado, financeItems, acumulado } = await lerTudo(kv(), chaves());
    response.status(200).json({ status: { ...statusBanco(), migrado }, resumo: resumirLancamentos(financeItems, acumulado) });
  }),
};
