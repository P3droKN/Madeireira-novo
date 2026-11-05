// Todas as rotas da API num arquivo só. Quem atende é api/[recurso].js (uma única função na Vercel),
// então novas rotas não contam no limite de 12 funções do plano Hobby. Os endereços continuam os mesmos:
// /api/getFinance, /api/lancamento, /api/orcamentos...
import { kv, chaves, autorizar, lerCustos, responderErro, statusBanco, gravacaoBloqueada } from "./_lib.js";
import {
  listarFuncionarios, salvarFuncionario, entrar, sair, custosSemValores, lancamentosDoFuncionario, configParaFuncionario,
  orcamentoParaFuncionario, lancamentoParaFuncionario, prepararLancamentoDoFuncionario, prepararOrcamentoDoFuncionario,
} from "./_funcionarios.js";
import {
  lerTudo, salvarLancamentos, excluirLancamento, reclassificar, atualizarCheque,
  montarBackup, salvarCopia, listarCopias, lerCopia, lerPrecosEConfig, salvarPrecos,
  salvarConfig, salvarConfigFinanceiro, salvarAbertura, registrarConferencia,
  restaurar, marcarImpresso, proximosNumeros, clienteDaVenda, whatsappAberto,
  listarOrcamentos, salvarOrcamento, atualizarOrcamento, salvarCliente, listarClientes, zerarMovimento,
  situacaoCliente, impactoExcluirCliente, excluirCliente,
} from "./_dados.js";
import { CEPILHADO_PADRAO, montarCatalogo, chavePrecoValida, precosComIdsAtuais, precosComPadrao } from "../lib/catalogo.js";
import { resumirLancamentos } from "../lib/resumo.js";
import { hojeSP } from "../lib/datas.js";

const naoPermitido = (response) => response.status(405).json({ error: "Method not allowed" });
const soDono = (response) => response.status(403).json({ error: "Só o dono pode fazer isso." });
const ehFunc = (quem) => quem?.papel === "funcionario";

// Envolve a rota: senha (ou sessão do funcionário, onde permitido), método aceito e erro padronizado.
// fn recebe quem: { papel: "dono" } ou { papel: "funcionario", id, nome }.
function rota(metodos, fn, { funcionario = false } = {}) {
  return async (request, response) => {
    const quem = await autorizar(request, response, { permiteFuncionario: funcionario });
    if (!quem) return;
    if (metodos && !metodos.includes(request.method)) return naoPermitido(response);
    try {
      await fn(request, response, quem);
    } catch (error) {
      responderErro(response, error);
    }
  };
}

export const ROTAS = {
  // GET -> lançamentos, acumulado, config financeira, saldos e status do banco
  getFinance: rota(["GET"], async (request, response, quem) => {
    const { migrado, migradoV2, financeItems, estornados, acumulado, configFinanceiro, saldos } = await lerTudo(kv(), chaves());
    // Funcionário: vendas de hoje e o que forma o fiado, sem custo; nada de saldos, despesas nem histórico
    if (ehFunc(quem)) {
      return response.status(200).json({
        papel: "funcionario", funcionario: { id: quem.id, nome: quem.nome },
        migrado, migradoV2, configFinanceiro: configParaFuncionario(configFinanceiro), saldos: null,
        ambiente: chaves().ambiente, status: { gravacaoBloqueada: statusBanco().gravacaoBloqueada },
        proximos: await proximosNumeros(kv(), chaves()),
        financeItems: lancamentosDoFuncionario(financeItems), estornados: [], acumulado: null,
      });
    }
    response.status(200).json({
      papel: "dono",
      migrado,
      migradoV2,
      configFinanceiro,
      saldos,
      ambiente: chaves().ambiente,
      status: statusBanco(),
      proximos: await proximosNumeros(kv(), chaves()),
      financeItems,
      estornados,
      acumulado: acumulado || { venda: 0, pix: 0, credito: 0, debito: 0, custo: 0, despesa: 0, func: 0, dinheiroCaixa: 0 },
    });
  }, { funcionario: true }),

  // POST { itens: [...] } cria/edita lançamentos. DELETE ?id= marca como excluído.
  // PATCH { ids, conta?, forma?, aceitarSugestao? } reclassifica em lote; PATCH { acao: "cheque", ... } atualiza um cheque.
  lancamento: rota(null, async (request, response, quem) => {
    if (request.method === "POST") {
      if (ehFunc(quem)) {
        const lista = Array.isArray(request.body?.itens) ? request.body.itens.slice(0, 10) : [];
        const itens = [], extras = {};
        for (const i of lista) {
          const v = await prepararLancamentoDoFuncionario(kv(), chaves(), i, quem);
          itens.push(v);
          extras[v.id] = { precoDigitado: v.precoDigitado, alertaFiado: v.alertaFiado };
        }
        return response.status(200).json(await salvarLancamentos(kv(), chaves(), itens, quem, extras));
      }
      return response.status(200).json(await salvarLancamentos(kv(), chaves(), request.body?.itens, quem));
    }
    if (request.method === "PATCH") {
      if (ehFunc(quem)) {
        const acao = request.body?.acao;
        if (acao === "impresso") return response.status(200).json(await marcarImpresso(kv(), chaves(), request.body.id));
        if (acao === "whatsapp") return response.status(200).json(await whatsappAberto(kv(), chaves(), request.body.id));
        if (acao === "cliente") {
          const venda = (await lerTudo(kv(), chaves())).financeItems.find((l) => l.id === String(request.body.id || ""));
          if (!venda || venda.competencia !== hojeSP()) return soDono(response);
          return response.status(200).json({ lancamento: lancamentoParaFuncionario(await clienteDaVenda(kv(), chaves(), request.body, quem)) });
        }
        return soDono(response);
      }
      if (request.body?.acao === "cheque") return response.status(200).json({ lancamento: await atualizarCheque(kv(), chaves(), request.body) });
      if (request.body?.acao === "impresso") return response.status(200).json(await marcarImpresso(kv(), chaves(), request.body.id));
      if (request.body?.acao === "whatsapp") return response.status(200).json(await whatsappAberto(kv(), chaves(), request.body.id));
      if (request.body?.acao === "cliente") return response.status(200).json({ lancamento: await clienteDaVenda(kv(), chaves(), request.body, quem) });
      return response.status(200).json(await reclassificar(kv(), chaves(), request.body));
    }
    if (request.method === "DELETE") {
      if (ehFunc(quem)) return soDono(response);
      return response.status(200).json(await excluirLancamento(kv(), chaves(), request.query.id));
    }
    naoPermitido(response);
  }, { funcionario: true }),

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
    const dia = hojeSP(); // nome do arquivo no dia de Brasília (export às 22h50 de 17/10 sai com 17/10)
    response.setHeader("Content-Disposition", `attachment; filename="madeireira_backup_${k.ambiente}_${dia}.json"`);
    response.status(200).json(backup);
  }),

  // Custos (data/custos.json) + preços de venda e config (KV).
  // Sem banco, devolve só os custos: a calculadora funciona e o vendedor digita os preços.
  catalogo: rota(["GET"], async (request, response, quem) => {
    const custos = ehFunc(quem) ? custosSemValores(lerCustos()) : lerCustos();
    let precos = {}, config = {}, kvDisponivel = true;
    try {
      ({ precos, config } = await lerPrecosEConfig(kv(), chaves()));
    } catch (e) {
      console.warn("KV indisponível para preços:", e.message);
      kvDisponivel = false;
    }
    response.status(200).json({ custos, precos: precosComPadrao(precosComIdsAtuais(precos), montarCatalogo(custos)), config, kvDisponivel });
  }, { funcionario: true }),

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

  // GET                       -> { orcamentos, clientes }
  // POST { orcamento }        -> cria (número novo) ou edita (com id)
  // POST { cliente }          -> cria/atualiza cliente (chave: telefone)
  // PATCH { id, acao, ... }   -> contato, perdido, reabrir, fechar, precos, excluir, restaurar
  orcamentos: rota(null, async (request, response, quem) => {
    const k = chaves();
    const func = ehFunc(quem);
    const saida = (o) => (func && o ? orcamentoParaFuncionario(o) : o);
    if (request.method === "GET") {
      const r = await listarOrcamentos(kv(), k);
      return response.status(200).json(func ? { ...r, orcamentos: r.orcamentos.map(orcamentoParaFuncionario) } : r);
    }
    if (request.method === "POST") {
      if (request.body?.cliente && !request.body?.orcamento) return response.status(200).json({ cliente: await salvarCliente(kv(), k, request.body.cliente, quem) });
      const cfg = (await kv().get(k.configFinanceiro)) || {};
      const orc = func ? await prepararOrcamentoDoFuncionario(kv(), k, request.body?.orcamento) : request.body?.orcamento;
      return response.status(200).json({ orcamento: saida(await salvarOrcamento(kv(), k, orc, cfg, quem)) });
    }
    if (request.method === "PATCH") {
      let p = request.body || {};
      if (func && (p.acao === "excluir_sempre" || p.acao === "esvaziar_lixeira")) return soDono(response);
      if (func && p.acao === "precos") p = await prepararOrcamentoDoFuncionario(kv(), k, p);
      const r = await atualizarOrcamento(kv(), k, p, quem);
      return response.status(200).json(r?.apagados ? r : { orcamento: saida(r) });
    }
    naoPermitido(response);
  }, { funcionario: true }),

  // Cadastro de clientes (orçamentos e fiado)
  // GET                 -> { clientes }
  // GET ?impacto=<id>   -> o que acontece ao excluir (dívida, cheques, vendas, orçamentos)
  // POST { cliente }    -> cria (pelo WhatsApp, ou C1, C2… sem WhatsApp) ou edita (com id)
  // PATCH { id, acao }  -> inativar, reativar, excluir (com confirmacao: "EXCLUIR")
  clientes: rota(["GET", "POST", "PATCH"], async (request, response, quem) => {
    const k = chaves();
    if (ehFunc(quem) && (request.query.impacto || request.body?.acao === "excluir")) return soDono(response);
    if (request.method === "GET") {
      if (request.query.impacto) {
        const { cliente, ...imp } = await impactoExcluirCliente(kv(), k, String(request.query.impacto));
        return response.status(200).json({ ...imp, nome: cliente.nome });
      }
      return response.status(200).json(await listarClientes(kv(), k));
    }
    if (request.method === "PATCH") {
      const b = request.body || {};
      if (b.acao === "inativar" || b.acao === "reativar") return response.status(200).json({ cliente: await situacaoCliente(kv(), k, b.id, b.acao === "inativar", quem) });
      if (b.acao === "excluir") return response.status(200).json(await excluirCliente(kv(), k, b));
      return response.status(400).json({ error: "Ação inválida." });
    }
    response.status(200).json({ cliente: await salvarCliente(kv(), k, request.body?.cliente, quem) });
  }, { funcionario: true }),

  // Entrada do funcionário (/funcionarios). Sem senha: a tela de entrada lista os nomes e confere o PIN.
  // GET -> { funcionarios: [{id, nome}] } (só ativos)   POST { id, pin } -> { token, nome, expira }   DELETE -> sai
  sessao: async (request, response) => {
    try {
      const k = chaves();
      if (request.method === "GET") return response.status(200).json({ funcionarios: await listarFuncionarios(kv(), k, { soAtivos: true }), ambiente: k.ambiente });
      if (request.method === "POST") return response.status(200).json(await entrar(kv(), k, request, request.body || {}));
      if (request.method === "DELETE") return response.status(200).json(await sair(kv(), k, request.headers["x-sessao"]));
      naoPermitido(response);
    } catch (error) {
      responderErro(response, error);
    }
  },

  // Cadastro dos funcionários (só o dono). GET -> lista; POST { funcionario: { id?, nome, pin?, ativo? } }
  funcionarios: rota(["GET", "POST"], async (request, response) => {
    if (request.method === "GET") return response.status(200).json({ funcionarios: await listarFuncionarios(kv(), chaves()) });
    response.status(200).json({ funcionario: await salvarFuncionario(kv(), chaves(), request.body?.funcionario) });
  }),

  // POST { alteracoes: { "<item>|<acabamento>": preço ou null } }
  precos: rota(["POST"], async (request, response) => {
    const catalogo = montarCatalogo(lerCustos());
    const r = await salvarPrecos(kv(), chaves(), request.body?.alteracoes, (c) => chavePrecoValida(catalogo, c));
    response.status(200).json(r);
  }),

  // POST { confirmacao: "RESTAURAR", arquivo: <conteúdo do backup> }
  restaurar: async (request, response) => {
    if (!(await autorizar(request, response))) return;
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
  resumo: rota(["GET"], async (request, response) => {
    const { migrado, financeItems, acumulado } = await lerTudo(kv(), chaves());
    response.status(200).json({ status: { ...statusBanco(), migrado }, resumo: resumirLancamentos(financeItems, acumulado) });
  }),
};
