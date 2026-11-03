import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import publicApi from "../../api/publicApi";
import logoNatal from "../../assets/natal-2026/logo-natal-branco.png";
import logoNatalVerde from "../../assets/natal-2026/logo-natal-verde.png";
import mascote from "../../assets/natal-2026/mascote-azul.png";
import {
  formatRegistrationDocument,
  formatRegistrationPhone,
  isValidRegistrationPhone,
  validateRegistrationDocument,
} from "../../utils/registrationValidation";
import {
  COMPROVANTE_TIPOS,
  comprimirImagem,
  formatDateBR,
  NATAL_PUBLIC_BASE,
} from "../../utils/natalPremiado";
import styles from "./NatalParticipar.module.css";

// Página pública do Natal Premiado 2026 — única tela com a identidade natalina.
// Fontes da campanha (manual): Montserrat e MonteCarlo, carregadas só aqui.
const FONTES_URL = "https://fonts.googleapis.com/css2?family=MonteCarlo&family=Montserrat:wght@400;500;600;700;800&display=swap";
const MAX_BYTES = 10 * 1024 * 1024;

const CAMPOS_INICIAIS = {
  vendedorNome: "",
  nomeFantasia: "",
  razaoSocial: "",
  documento: "",
  responsavel: "",
  whatsapp: "",
  instagram: "",
  dataCompra: "",
  valorCompra: "",
  aceiteTermos: false,
};

const ORDEM_CAMPOS = ["vendedorNome", "nomeFantasia", "razaoSocial", "documento", "responsavel", "whatsapp", "instagram", "dataCompra", "valorCompra", "comprovante", "aceiteTermos"];

const hojeBrasilia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const dataIsoBrasilia = (iso) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso)) : "");

const formatarValorDigitado = (texto) => {
  const digitos = String(texto).replace(/\D/g, "").replace(/^0+/, "").slice(0, 10);
  if (!digitos) return "";
  return (Number(digitos) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const valorNumerico = (texto) => Number(String(texto).replace(/\./g, "").replace(",", ".")) || 0;

const formatarTamanho = (bytes) => (bytes >= 1024 * 1024
  ? `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const normalizarInstagram = (texto) => String(texto || "").trim().toLowerCase()
  .replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/[/?#].*$/, "").replace(/^@+/, "");

const validar = (campos, arquivo, limites) => {
  const erros = {};
  const texto = (campo, rotulo, min = 2) => {
    const valor = campos[campo].trim();
    if (valor.length < min) erros[campo] = `Informe ${rotulo}.`;
  };
  texto("vendedorNome", "o seu nome");
  texto("nomeFantasia", "o nome fantasia do pet shop");
  texto("razaoSocial", "a razão social");
  texto("responsavel", "o nome do responsável");
  // CPF (11 dígitos) ou CNPJ (14), com validação dos dígitos verificadores.
  if (!campos.documento.trim()) erros.documento = "Informe o CPF ou o CNPJ do pet shop.";
  else {
    const erroDocumento = validateRegistrationDocument(campos.documento);
    if (erroDocumento) erros.documento = erroDocumento;
  }
  if (!isValidRegistrationPhone(campos.whatsapp)) erros.whatsapp = "Informe um WhatsApp ou telefone com DDD.";
  const instagram = normalizarInstagram(campos.instagram);
  if (!/^[a-z0-9._]{1,30}$/.test(instagram)) erros.instagram = "Informe o Instagram do estabelecimento (ex.: @petshop).";
  if (!campos.dataCompra) erros.dataCompra = "Informe a data da compra.";
  else if ((limites.min && campos.dataCompra < limites.min) || campos.dataCompra > limites.max) {
    erros.dataCompra = "A data precisa estar no período da campanha e não pode ser futura.";
  }
  if (valorNumerico(campos.valorCompra) <= 0) erros.valorCompra = "Informe o valor da compra.";
  if (!arquivo) erros.comprovante = "Anexe a foto ou o PDF do comprovante.";
  if (!campos.aceiteTermos) erros.aceiteTermos = "Confirme a declaração para enviar.";
  return erros;
};

function useFontesCampanha() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTES_URL;
    link.dataset.natal2026 = "true";
    document.head.appendChild(link);
    const tituloAnterior = document.title;
    document.title = "Natal Premiado Atual Pet 2026 — Cadastro de participação";
    const meta = document.querySelector('meta[name="theme-color"]');
    const corAnterior = meta?.getAttribute("content");
    meta?.setAttribute("content", "#A70000");
    return () => {
      link.remove();
      document.title = tituloAnterior;
      if (meta && corAnterior) meta.setAttribute("content", corAnterior);
    };
  }, []);
}

function Pegadas() {
  return (
    <svg className={styles.pegadasSvg} aria-hidden="true" focusable="false">
      <defs>
        <symbol id="natal-pegada" viewBox="0 0 119.3 119.7">
          <path d="M55.0 2.1C48.6 0.0 42.8 4.5 39.7 10.0C34.6 19.5 34.6 37.1 46.8 40.9C52.9 42.8 58.5 38.3 61.5 33.2C67.0 24.0 67.2 5.9 55.0 2.1M93.3 15.0C81.2 11.0 71.6 24.3 69.4 34.7C68.1 41.1 70.0 48.7 76.7 51.0C88.7 55.0 99.7 40.5 100.7 29.8C101.3 23.8 99.6 17.0 93.3 15.0M15.9 21.7C9.4 20.8 5.0 26.3 3.2 31.9C0.0 41.3 3.3 56.4 14.9 58.0C21.7 58.9 27.0 53.2 28.6 46.9C31.2 37.2 27.2 23.2 15.9 21.7M107.5 52.6C98.2 51.5 89.3 59.5 86.6 68.1C84.3 75.5 87.1 83.9 95.4 85.1C105.4 86.6 113.8 78.2 116.8 69.3C119.3 61.8 115.9 53.6 107.5 52.6M58.1 46.5C48.7 45.2 42.1 52.7 35.1 57.7C23.6 65.8 6.5 70.2 6.7 87.5C6.7 89.9 7.2 92.3 8.3 94.5C14.6 108.2 31.3 101.9 42.3 106.5C50.4 109.8 56.5 117.5 65.6 118.5C76.2 119.7 83.7 110.1 84.5 100.3C85.2 91.2 80.4 84.4 77.1 76.3C72.8 65.4 72.7 48.5 58.1 46.5Z" />
        </symbol>
        <pattern id="natal-padrao-pegadas" width="96" height="96" patternUnits="userSpaceOnUse">
          <use href="#natal-pegada" x="10" y="10" width="26" height="26" transform="rotate(-14 23 23)" />
          <use href="#natal-pegada" x="58" y="58" width="26" height="26" transform="rotate(12 71 71)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#natal-padrao-pegadas)" />
    </svg>
  );
}

function Campo({ id, rotulo, erro, dica, children }) {
  return (
    <div className={styles.campo} data-invalido={erro ? "true" : undefined}>
      <label htmlFor={id}>{rotulo}</label>
      {children}
      {dica && !erro && <small id={`${id}-dica`} className={styles.dica}>{dica}</small>}
      {erro && <small id={`${id}-erro`} className={styles.erroCampo} role="alert">{erro}</small>}
    </div>
  );
}

function NatalParticipar() {
  useFontesCampanha();
  const { codigo } = useParams();
  const [lote, setLote] = useState(null);
  const [config, setConfig] = useState(null);
  const [estado, setEstado] = useState("carregando");
  const [mensagemEstado, setMensagemEstado] = useState("");
  const [campos, setCampos] = useState(CAMPOS_INICIAIS);
  const [arquivo, setArquivo] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [preparandoArquivo, setPreparandoArquivo] = useState(false);
  const [erros, setErros] = useState({});
  const [erroGeral, setErroGeral] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [protocolo, setProtocolo] = useState("");
  const [mensagemSucesso, setMensagemSucesso] = useState("");
  const iniciadoEm = useRef(0);
  const formRef = useRef(null);
  const sucessoRef = useRef(null);
  const cameraRef = useRef(null);
  const arquivoRef = useRef(null);

  useEffect(() => {
    let ativo = true;
    Promise.all([
      publicApi.get(`${NATAL_PUBLIC_BASE}/lotes/${encodeURIComponent(codigo || "")}`),
      publicApi.get(`${NATAL_PUBLIC_BASE}/config`).catch(() => ({ data: null })),
    ])
      .then(([loteResposta, configResposta]) => {
        if (!ativo) return;
        setLote(loteResposta.data);
        setConfig(configResposta.data);
        if (loteResposta.data.aceitandoCadastros) setEstado("aberto");
        else {
          setEstado("fechado");
          setMensagemEstado(loteResposta.data.mensagem);
        }
      })
      .catch((error) => {
        if (!ativo) return;
        setEstado("erro");
        setMensagemEstado(error.response?.status === 404
          ? "Link de cadastro não encontrado. Confira o endereço enviado pelo distribuidor."
          : error.response?.data?.message || "Não foi possível carregar o cadastro. Verifique sua conexão e tente novamente.");
      });
    return () => { ativo = false; };
  }, [codigo]);

  // Marca o início do preenchimento (verificação antirrobô no servidor).
  useEffect(() => { iniciadoEm.current = Date.now(); }, []);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    if (estado === "sucesso") sucessoRef.current?.focus();
  }, [estado]);

  const limitesData = useMemo(() => {
    const hoje = hojeBrasilia();
    const fim = dataIsoBrasilia(config?.fimCadastros || lote?.campanha?.fimCadastros);
    return { min: dataIsoBrasilia(config?.inicio), max: fim && fim < hoje ? fim : hoje };
  }, [config, lote]);

  const alterar = (campo, valor) => {
    setCampos((atual) => ({ ...atual, [campo]: valor }));
    if (erros[campo]) setErros((atual) => ({ ...atual, [campo]: undefined }));
  };

  const selecionarArquivo = async (event) => {
    const selecionado = event.target.files?.[0];
    event.target.value = "";
    if (!selecionado) return;
    if (!COMPROVANTE_TIPOS.includes(selecionado.type)) {
      setErros((atual) => ({ ...atual, comprovante: "Envie uma foto (JPG, PNG ou WEBP) ou um PDF." }));
      return;
    }
    setPreparandoArquivo(true);
    const pronto = await comprimirImagem(selecionado);
    setPreparandoArquivo(false);
    if (pronto.size > MAX_BYTES) {
      setErros((atual) => ({ ...atual, comprovante: "O comprovante deve ter no máximo 10 MB." }));
      return;
    }
    setArquivo(pronto);
    setPreviewUrl(pronto.type.startsWith("image/") ? URL.createObjectURL(pronto) : "");
    setErros((atual) => ({ ...atual, comprovante: undefined }));
  };

  const removerArquivo = () => {
    setArquivo(null);
    setPreviewUrl("");
  };

  const focarPrimeiroErro = (lista) => {
    const primeiro = ORDEM_CAMPOS.find((campo) => lista[campo]);
    if (!primeiro) return;
    const alvo = primeiro === "comprovante"
      ? formRef.current?.querySelector("[data-foco-comprovante]")
      : formRef.current?.querySelector(`#natal-${primeiro}`);
    alvo?.focus();
    alvo?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const enviar = async (event) => {
    event.preventDefault();
    if (enviando) return;
    setErroGeral("");
    const encontrados = validar(campos, arquivo, limitesData);
    setErros(encontrados);
    if (Object.keys(encontrados).length > 0) {
      setErroGeral("Revise os campos destacados antes de enviar.");
      focarPrimeiroErro(encontrados);
      return;
    }

    const dados = new FormData();
    for (const [campo, valor] of Object.entries(campos)) dados.append(campo, String(valor));
    dados.set("documento", campos.documento.replace(/\D/g, ""));
    dados.set("whatsapp", campos.whatsapp.replace(/\D/g, ""));
    dados.append("iniciadoEm", String(iniciadoEm.current));
    dados.append("website", formRef.current?.elements?.website?.value || "");
    dados.append("comprovante", arquivo, arquivo.name);

    setEnviando(true);
    setProgresso(0);
    try {
      const { data } = await publicApi.post(
        `${NATAL_PUBLIC_BASE}/lotes/${encodeURIComponent(codigo)}/participacoes`,
        dados,
        {
          timeout: 180000,
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) setProgresso(Math.round((progressEvent.loaded / progressEvent.total) * 100));
          },
        }
      );
      setProtocolo(data.protocolo);
      setMensagemSucesso(data.message);
      setEstado("sucesso");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      const resposta = error.response?.data;
      if (resposta?.errors) {
        setErros(resposta.errors);
        focarPrimeiroErro(resposta.errors);
      }
      if (error.response?.status === 409 && !resposta?.errors) {
        setEstado("fechado");
        setMensagemEstado(resposta?.message);
        return;
      }
      setErroGeral(resposta?.message || (error.code === "ECONNABORTED"
        ? "O envio demorou demais. Verifique a conexão e tente novamente."
        : "Não foi possível enviar o cadastro. Verifique sua conexão e tente novamente."));
    } finally {
      setEnviando(false);
    }
  };

  const novoCadastro = () => {
    setCampos({ ...CAMPOS_INICIAIS, vendedorNome: campos.vendedorNome });
    removerArquivo();
    setErros({});
    setErroGeral("");
    setProtocolo("");
    iniciadoEm.current = Date.now();
    setEstado("aberto");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const inputProps = (campo, extra = {}) => ({
    id: `natal-${campo}`,
    name: campo,
    value: campos[campo],
    disabled: enviando,
    "aria-invalid": erros[campo] ? "true" : undefined,
    "aria-describedby": erros[campo] ? `natal-${campo}-erro` : undefined,
    onChange: (event) => alterar(campo, event.target.value),
    ...extra,
  });

  const sorteio = formatDateBR(lote?.campanha?.sorteio || config?.sorteio);
  const fimCadastros = formatDateBR(lote?.campanha?.fimCadastros || config?.fimCadastros);

  return (
    <div className={styles.pagina}>
      <header className={styles.hero}>
        <Pegadas />
        <div className={styles.heroConteudo}>
          <img className={styles.logo} src={logoNatal} alt="Atual Pet — Beleza Animal" width="180" height="150" />
          <p className={styles.sobretitulo}>Campanha Atual Pet</p>
          <h1 className={styles.titulo}>
            <span>Natal</span> <span>Premiado</span>
            <em className={styles.script}>Atual Pet 2026</em>
          </h1>
          <p className={styles.premio}>
            Concorra a <strong>1 Kit Groomer Profissional</strong>: soprador e secador.
          </p>
          {lote?.distribuidorNome && (
            <p className={styles.distribuidor}>
              <span>Distribuidor</span>
              <strong>{lote.distribuidorNome}</strong>
            </p>
          )}
          <p className={styles.datas}>
            Cadastros até <strong>{fimCadastros}</strong> · Sorteio em <strong>{sorteio}</strong>
          </p>
        </div>
        <img className={styles.mascote} src={mascote} alt="" aria-hidden="true" width="328" height="559" />
      </header>

      <main className={styles.conteudo}>
        {estado === "carregando" && (
          <section className={styles.cartao} aria-busy="true">
            <p className={styles.carregando} role="status">Carregando o cadastro…</p>
          </section>
        )}

        {(estado === "erro" || estado === "fechado") && (
          <section className={styles.cartao} role="status">
            <div className={styles.aviso}>
              <h2>{estado === "erro" ? "Link indisponível" : "Cadastros indisponíveis neste link"}</h2>
              <p>{mensagemEstado}</p>
            </div>
          </section>
        )}

        {estado === "sucesso" && (
          <section className={`${styles.cartao} ${styles.sucesso}`} tabIndex="-1" ref={sucessoRef} aria-labelledby="natal-sucesso-titulo">
            <div className={styles.sucessoIcone} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="36" height="36"><path d="M9.2 16.6 4.9 12.3l-1.4 1.4 5.7 5.7L20.5 8.1l-1.4-1.4z" fill="currentColor" /></svg>
            </div>
            <h2 id="natal-sucesso-titulo">Cadastro enviado</h2>
            <p className={styles.sucessoTexto}>{mensagemSucesso}</p>
            <p className={styles.protocolo}>
              Protocolo <strong>{protocolo}</strong>
            </p>
            <p className={styles.sucessoObs}>Cadastro enviado não significa cupom aprovado. Guarde o protocolo para consulta com o distribuidor.</p>
            <button type="button" className={styles.botaoPrimario} onClick={novoCadastro}>Cadastrar outro pet shop</button>
          </section>
        )}

        {estado === "aberto" && (
          <form ref={formRef} className={styles.cartao} onSubmit={enviar} noValidate>
            <div className={styles.introForm}>
              <h2>Cadastro de participação</h2>
              <p>Preencha os dados do pet shop que comprou produtos Atual Pet e anexe o comprovante. Todos os campos são obrigatórios.</p>
            </div>

            {erroGeral && <div className={styles.erroGeral} role="alert">{erroGeral}</div>}

            <fieldset className={styles.grupo} disabled={enviando}>
              <legend><span>1</span> Vendedor</legend>
              <Campo id="natal-vendedorNome" rotulo="Seu nome (vendedor)" erro={erros.vendedorNome}>
                <input {...inputProps("vendedorNome", { autoComplete: "name", maxLength: 120 })} />
              </Campo>
            </fieldset>

            <fieldset className={styles.grupo} disabled={enviando}>
              <legend><span>2</span> Pet shop</legend>
              <Campo id="natal-nomeFantasia" rotulo="Nome fantasia" erro={erros.nomeFantasia}>
                <input {...inputProps("nomeFantasia", { autoComplete: "organization", maxLength: 160 })} />
              </Campo>
              <Campo id="natal-razaoSocial" rotulo="Razão social" erro={erros.razaoSocial}>
                <input {...inputProps("razaoSocial", { autoComplete: "off", maxLength: 200 })} />
              </Campo>
              <Campo id="natal-documento" rotulo="CPF ou CNPJ" erro={erros.documento} dica="Use o CPF quando o estabelecimento não tiver CNPJ.">
                <input {...inputProps("documento", {
                  inputMode: "numeric",
                  autoComplete: "off",
                  placeholder: "CPF ou CNPJ, só números",
                  "aria-describedby": erros.documento ? "natal-documento-erro" : "natal-documento-dica",
                  onChange: (event) => alterar("documento", formatRegistrationDocument(event.target.value)),
                })} />
              </Campo>
              <Campo id="natal-responsavel" rotulo="Nome do responsável" erro={erros.responsavel}>
                <input {...inputProps("responsavel", { autoComplete: "off", maxLength: 120 })} />
              </Campo>
              <Campo id="natal-whatsapp" rotulo="WhatsApp / telefone" erro={erros.whatsapp}>
                <input {...inputProps("whatsapp", {
                  type: "tel",
                  inputMode: "tel",
                  autoComplete: "off",
                  placeholder: "(00) 00000-0000",
                  onChange: (event) => alterar("whatsapp", formatRegistrationPhone(event.target.value)),
                })} />
              </Campo>
              <Campo id="natal-instagram" rotulo="Instagram do estabelecimento" erro={erros.instagram} dica="Ex.: @petshopdobairro">
                <div className={styles.prefixo}>
                  <span aria-hidden="true">@</span>
                  <input {...inputProps("instagram", {
                    autoCapitalize: "none",
                    autoCorrect: "off",
                    spellCheck: false,
                    maxLength: 60,
                    "aria-describedby": erros.instagram ? "natal-instagram-erro" : "natal-instagram-dica",
                    onChange: (event) => alterar("instagram", event.target.value.replace(/^@+/, "")),
                  })} />
                </div>
              </Campo>
            </fieldset>

            <fieldset className={styles.grupo} disabled={enviando}>
              <legend><span>3</span> Compra</legend>
              <div className={styles.linhaDupla}>
                <Campo id="natal-dataCompra" rotulo="Data da compra" erro={erros.dataCompra}>
                  <input {...inputProps("dataCompra", { type: "date", min: limitesData.min || undefined, max: limitesData.max })} />
                </Campo>
                <Campo id="natal-valorCompra" rotulo="Valor da compra" erro={erros.valorCompra}>
                  <div className={styles.prefixo}>
                    <span aria-hidden="true">R$</span>
                    <input {...inputProps("valorCompra", {
                      inputMode: "decimal",
                      autoComplete: "off",
                      placeholder: "0,00",
                      onChange: (event) => alterar("valorCompra", formatarValorDigitado(event.target.value)),
                    })} />
                  </div>
                </Campo>
              </div>

              <div className={styles.campo} data-invalido={erros.comprovante ? "true" : undefined}>
                <span className={styles.rotulo} id="natal-comprovante-rotulo">Comprovante da compra</span>
                <small className={styles.dica}>Nota fiscal, recibo ou outro documento da compra. Foto ou PDF de até 10 MB.</small>
                {arquivo ? (
                  <div className={styles.arquivo}>
                    {previewUrl ? (
                      <img src={previewUrl} alt="Pré-visualização do comprovante" />
                    ) : (
                      <span className={styles.arquivoPdf} aria-hidden="true">PDF</span>
                    )}
                    <div>
                      <strong>{arquivo.name}</strong>
                      <small>{formatarTamanho(arquivo.size)}</small>
                    </div>
                    <button type="button" className={styles.botaoTexto} onClick={removerArquivo} disabled={enviando}>Trocar</button>
                  </div>
                ) : (
                  <div className={styles.upload} aria-labelledby="natal-comprovante-rotulo">
                    <button type="button" data-foco-comprovante className={styles.botaoUpload} onClick={() => cameraRef.current?.click()} disabled={enviando || preparandoArquivo}>
                      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" /></svg>
                      Tirar foto
                    </button>
                    <button type="button" className={styles.botaoUpload} onClick={() => arquivoRef.current?.click()} disabled={enviando || preparandoArquivo}>
                      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5L13 3.5zM8 13v2h8v-2H8zm0 4v2h5v-2H8z" /></svg>
                      Escolher arquivo
                    </button>
                    {preparandoArquivo && <small className={styles.dica} role="status">Preparando arquivo…</small>}
                  </div>
                )}
                <input ref={cameraRef} className={styles.oculto} type="file" accept="image/*" capture="environment" onChange={selecionarArquivo} tabIndex={-1} aria-hidden="true" />
                <input ref={arquivoRef} className={styles.oculto} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={selecionarArquivo} tabIndex={-1} aria-hidden="true" />
                {erros.comprovante && <small id="natal-comprovante-erro" className={styles.erroCampo} role="alert">{erros.comprovante}</small>}
              </div>
            </fieldset>

            <div className={styles.honeypot} aria-hidden="true">
              <label htmlFor="natal-website">Não preencha este campo</label>
              <input id="natal-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
            </div>

            <div className={styles.aceite} data-invalido={erros.aceiteTermos ? "true" : undefined}>
              <input
                id="natal-aceiteTermos"
                type="checkbox"
                checked={campos.aceiteTermos}
                disabled={enviando}
                aria-invalid={erros.aceiteTermos ? "true" : undefined}
                aria-describedby={erros.aceiteTermos ? "natal-aceiteTermos-erro" : undefined}
                onChange={(event) => alterar("aceiteTermos", event.target.checked)}
              />
              <label htmlFor="natal-aceiteTermos">
                Declaro que as informações são verdadeiras e autorizo o uso destes dados pela Atual Pet exclusivamente para a validação e o sorteio do Natal Premiado 2026.
              </label>
              {erros.aceiteTermos && <small id="natal-aceiteTermos-erro" className={styles.erroCampo} role="alert">{erros.aceiteTermos}</small>}
            </div>

            <button type="submit" className={styles.botaoPrimario} disabled={enviando || preparandoArquivo}>
              {enviando ? `Enviando… ${progresso > 0 && progresso < 100 ? `${progresso}%` : ""}` : "Enviar cadastro"}
            </button>
            {enviando && (
              <div className={styles.progresso} role="progressbar" aria-label="Envio do cadastro" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progresso}>
                <span style={{ width: `${Math.max(progresso, 8)}%` }} />
              </div>
            )}
            <p className={styles.notaAnalise}>O cadastro será analisado pela equipe Atual Pet antes da emissão do cupom.</p>
          </form>
        )}
      </main>

      <footer className={styles.rodape}>
        <img src={logoNatalVerde} alt="Atual Pet" width="88" height="73" loading="lazy" />
        <p>Natal Premiado Atual Pet 2026 · Sorteio nacional único. Participação sujeita à validação e às regras da campanha.</p>
      </footer>
    </div>
  );
}

export default NatalParticipar;
