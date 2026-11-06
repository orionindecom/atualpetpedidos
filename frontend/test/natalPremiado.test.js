import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildParticipacaoLink,
  buildWhatsappShareUrl,
  descreverPendenciaSincronizacao,
  faixaParaValor,
  formatCnpjBR,
  formatDocumentoBR,
  proximaFaixaParaValor,
  separarLinks,
} from "../src/utils/natalPremiado.js";

const faixas = [
  { nivel: 1, valorMinimo: 12000, cupons: 100, marketingPercentual: 3, produtosPercentual: 5 },
  { nivel: 2, valorMinimo: 20000, cupons: 200, marketingPercentual: 3, produtosPercentual: 7 },
  { nivel: 3, valorMinimo: 30000, cupons: 300, marketingPercentual: 3, produtosPercentual: 10 },
  { nivel: 4, valorMinimo: 40000, cupons: 400, marketingPercentual: 3, produtosPercentual: 10 },
];

test("prévia usa as faixas recebidas da API", () => {
  assert.equal(faixaParaValor(faixas, 11999.99), null);
  assert.equal(faixaParaValor(faixas, 12000).cupons, 100);
  assert.equal(faixaParaValor(faixas, 25000).produtosPercentual, 7);
  assert.equal(faixaParaValor(faixas, 90000).cupons, 400);
  assert.equal(proximaFaixaParaValor(faixas, 12000).cupons, 200);
  assert.equal(proximaFaixaParaValor(faixas, 40000), null);
});

test("link exclusivo usa rota única parametrizada e compartilhamento pelo WhatsApp", () => {
  const link = buildParticipacaoLink("ab_CD-12", "https://centralatualpet.com.br");
  assert.equal(link, "https://centralatualpet.com.br/natal-2026/participar/ab_CD-12");
  assert.match(buildWhatsappShareUrl({ link, distribuidorNome: "Pet Sul" }), /^https:\/\/wa\.me\/\?text=.*natal-2026%2Fparticipar%2Fab_CD-12/);
  assert.equal(formatCnpjBR("11222333000181"), "11.222.333/0001-81");
});

test("identidade natalina fica restrita à página pública", () => {
  const css = readFileSync(new URL("../src/pages/NatalParticipar/NatalParticipar.module.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /:root|(^|\n)\s*body\b|(^|\n)\s*html\b/, "sem regras globais");
  const brand = readFileSync(new URL("../src/styles/brand.css", import.meta.url), "utf8");
  assert.doesNotMatch(brand, /A70000|Montserrat|MonteCarlo/i, "tokens globais da Central inalterados");
  const interno = readFileSync(new URL("../src/components/NatalBeneficios/NatalInterno.module.css", import.meta.url), "utf8");
  assert.doesNotMatch(interno, /A70000|Montserrat|MonteCarlo/i, "telas internas usam a identidade da Central");
});

test("prêmio sem máquina de tosa e documento CPF ou CNPJ no formulário público", () => {
  const pagina = readFileSync(new URL("../src/pages/NatalParticipar/NatalParticipar.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(pagina, /tosa/i);
  assert.match(pagina, /soprador e secador/);
  assert.match(pagina, /rotulo="CPF ou CNPJ"/);
  assert.match(pagina, /validateRegistrationDocument/);
  assert.equal(formatDocumentoBR("52998224725"), "529.982.247-25");
  assert.equal(formatDocumentoBR("11222333000181"), "11.222.333/0001-81");
});

test("revisão de benefícios: decisão e justificativa obrigatórias; cancelar não salva", () => {
  const modal = readFileSync(new URL("../src/components/NatalBeneficios/RevisaoBeneficiosModal.jsx", import.meta.url), "utf8");
  assert.match(modal, /Revisão dos benefícios da campanha/);
  assert.match(modal, /O valor deste pedido foi reduzido\. Deseja manter os benefícios anteriormente conquistados ou adequá-los ao novo valor\?/);
  assert.match(modal, /disabled=\{salvando \|\| !decisao \|\| !justificativaValida\}/);
  const pedidos = readFileSync(new URL("../src/pages/AdminPedidos/AdminPedidos.jsx", import.meta.url), "utf8");
  assert.match(pedidos, /revisao_beneficios_obrigatoria/);
  assert.match(pedidos, /onCancelar=\{\(\) => setRevisaoNatal\(null\)\}/);
});

test("alerta de sincronização usa os dados do painel e o botão existente", () => {
  assert.equal(
    descreverPendenciaSincronizacao({ distribuidorNome: "Pet Sul", motivos: ["cupons_pendentes", "bonificacao_pendente"] }),
    "Pet Sul (cupons a liberar, bonificação a registrar)"
  );
  const pagina = readFileSync(new URL("../src/pages/NatalGestao/NatalGestao.jsx", import.meta.url), "utf8");
  assert.match(pagina, /if \(!pendencias\?\.length\) return null;/, "sem pendência a interface fica normal");
  assert.match(pagina, /pendencias=\{painel\.pendenciasSincronizacao\}/);
  assert.match(pagina, /api\.post\("\/natal-2026\/gestao\/reconciliar"\)/);
  assert.match(pagina, /reconciliacao_parcial/);
  assert.match(pagina, /finally \{[\s\S]*carregarPainel\(\);/, "o alerta é recalculado com ou sem sucesso");
});

test("distribuidor divulga um único link e os anteriores ficam separados", () => {
  const antigo = { codigoPublico: "antigo", status: "ativo", principal: true };
  const outro = { codigoPublico: "outro", status: "ativo", principal: false };
  assert.deepEqual(separarLinks([antigo, outro]), { principal: antigo, anteriores: [outro] });
  assert.deepEqual(separarLinks([]), { principal: null, anteriores: [] });
  const pagina = readFileSync(new URL("../src/pages/NatalDistribuidor/NatalDistribuidor.jsx", import.meta.url), "utf8");
  for (const rotulo of ["Cupons concedidos", "Cupons disponíveis", "Cupons utilizados", "Faixa atual", "Falta para a próxima faixa"]) {
    assert.match(pagina, new RegExp(rotulo));
  }
  const cartao = readFileSync(new URL("../src/components/NatalBeneficios/NatalBeneficios.jsx", import.meta.url), "utf8");
  assert.match(cartao, /Copiar link/);
  assert.match(cartao, /Compartilhar pelo WhatsApp/);
});
