import { useEffect, useState } from "react";
import api from "../../api/axios";
import ImageUploadField from "../../components/ImageUploadField/ImageUploadField";
import {
  FilterToolbar,
  PaginationControls,
} from "../../components/ListControls/ListControls";
import Navbar from "../../components/Navbar/Navbar";
import {
  normalizeMaterialResponse,
  openMaterialLink,
} from "../../utils/materialMarketing";
import { buildImageFormData } from "../../utils/imageUpload";
import styles from "./AdminMateriaisMarketing.module.css";

const categoriasSugeridas = [
  "Fotos de Produtos",
  "Vídeos",
  "Catálogos",
  "Banners",
  "Posts para Instagram",
  "Stories",
  "Logotipos",
  "Campanhas",
  "Lançamentos",
  "Outros",
];

const tiposSugeridos = [
  "Imagem",
  "Vídeo",
  "PDF",
  "Pasta",
  "Documento",
  "Link",
  "Outro",
];

const filtrosIniciais = {
  busca: "",
  categoria: "",
  tipo: "",
  marca: "",
  linha: "",
  ativo: "",
  destaque: "",
};

const formularioVazio = {
  titulo: "",
  descricao: "",
  categoriaOpcao: categoriasSugeridas[0],
  categoriaOutro: "",
  tipoOpcao: tiposSugeridos[0],
  tipoOutro: "",
  marca: "",
  linha: "",
  linkExterno: "",
  destaque: false,
  ordem: "0",
  ativo: true,
};

const formatarData = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : date.toLocaleDateString("pt-BR");
};

const criarFormulario = (material) => {
  if (!material) return { ...formularioVazio };

  const categoriaSugerida = categoriasSugeridas.includes(material.categoria);
  const tipoSugerido = tiposSugeridos.includes(material.tipo);

  return {
    titulo: material.titulo || "",
    descricao: material.descricao || "",
    categoriaOpcao: categoriaSugerida ? material.categoria : "__outro",
    categoriaOutro: categoriaSugerida ? "" : material.categoria || "",
    tipoOpcao: tipoSugerido ? material.tipo : "__outro",
    tipoOutro: tipoSugerido ? "" : material.tipo || "",
    marca: material.marca || "",
    linha: material.linha || "",
    linkExterno: material.linkExterno || "",
    destaque: Boolean(material.destaque),
    ordem: String(material.ordem ?? 0),
    ativo: material.ativo !== false,
  };
};

const prepararPayload = (form) => ({
  titulo: form.titulo,
  descricao: form.descricao,
  categoria:
    form.categoriaOpcao === "__outro"
      ? form.categoriaOutro
      : form.categoriaOpcao,
  tipo: form.tipoOpcao === "__outro" ? form.tipoOutro : form.tipoOpcao,
  marca: form.marca,
  linha: form.linha,
  linkExterno: form.linkExterno,
  destaque: form.destaque,
  ordem: Number(form.ordem),
  ativo: form.ativo,
});

const validarFormulario = (payload) => {
  const errors = {};
  if (!payload.titulo.trim()) errors.titulo = "Informe o título";
  if (!payload.categoria.trim()) errors.categoria = "Informe a categoria";
  if (!payload.tipo.trim()) errors.tipo = "Informe o tipo";
  if (!payload.linkExterno.trim()) errors.linkExterno = "Informe o link externo";
  if (!Number.isInteger(payload.ordem)) errors.ordem = "Informe um número inteiro";
  return errors;
};

function MaterialFormModal({ material, onClose, onSaved }) {
  const [form, setForm] = useState(() => criarFormulario(material));
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [coverFile, setCoverFile] = useState(null);
  const [removeCover, setRemoveCover] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, submitting]);

  const updateField = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const payload = prepararPayload(form);
    const localErrors = validarFormulario(payload);
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      return;
    }

    setSubmitting(true);
    setErrors({});
    try {
      const requestBody = buildImageFormData(payload, {
        file: coverFile,
        fileField: "imagemCapa",
        remove: removeCover,
        removeField: "removerImagemCapa",
      });

      if (material) {
        await api.put(`/admin/materiais-marketing/${material._id}`, requestBody);
      } else {
        await api.post("/admin/materiais-marketing", requestBody);
      }
      onSaved(material ? "Material atualizado com sucesso" : "Material criado com sucesso");
    } catch (error) {
      setErrors(error.response?.data?.errors || {
        formulario: error.response?.data?.message || "Não foi possível salvar o material",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onMouseDown={submitting ? undefined : onClose}>
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="material-form-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <div>
            <span>Biblioteca comercial</span>
            <h2 id="material-form-title">
              {material ? "Editar material" : "Novo material"}
            </h2>
          </div>
          <button type="button" onClick={onClose} disabled={submitting}>
            Fechar
          </button>
        </header>

        <form className={styles.form} onSubmit={submit} noValidate>
          {errors.formulario && (
            <div className={styles.formError} role="alert">{errors.formulario}</div>
          )}

          <div className={styles.fullField}>
            <label htmlFor="titulo">Título *</label>
            <input
              id="titulo"
              name="titulo"
              value={form.titulo}
              onChange={updateField}
              maxLength={150}
              autoFocus
              required
            />
            {errors.titulo && <small>{errors.titulo}</small>}
          </div>

          <div className={styles.fullField}>
            <label htmlFor="descricao">Descrição</label>
            <textarea
              id="descricao"
              name="descricao"
              value={form.descricao}
              onChange={updateField}
              maxLength={1000}
              rows={4}
            />
            <div className={styles.fieldMeta}>
              {errors.descricao ? <small>{errors.descricao}</small> : <span />}
              <span>{form.descricao.length} / 1000</span>
            </div>
          </div>

          <div>
            <label htmlFor="categoriaOpcao">Categoria *</label>
            <select
              id="categoriaOpcao"
              name="categoriaOpcao"
              value={form.categoriaOpcao}
              onChange={updateField}
            >
              {categoriasSugeridas.map((categoria) => (
                <option key={categoria} value={categoria}>{categoria}</option>
              ))}
              <option value="__outro">Outra categoria</option>
            </select>
            {form.categoriaOpcao === "__outro" && (
              <input
                className={styles.conditionalInput}
                name="categoriaOutro"
                value={form.categoriaOutro}
                onChange={updateField}
                maxLength={100}
                placeholder="Informe a categoria"
              />
            )}
            {errors.categoria && <small>{errors.categoria}</small>}
          </div>

          <div>
            <label htmlFor="tipoOpcao">Tipo *</label>
            <select
              id="tipoOpcao"
              name="tipoOpcao"
              value={form.tipoOpcao}
              onChange={updateField}
            >
              {tiposSugeridos.map((tipo) => (
                <option key={tipo} value={tipo}>{tipo}</option>
              ))}
              <option value="__outro">Outro tipo</option>
            </select>
            {form.tipoOpcao === "__outro" && (
              <input
                className={styles.conditionalInput}
                name="tipoOutro"
                value={form.tipoOutro}
                onChange={updateField}
                maxLength={100}
                placeholder="Informe o tipo"
              />
            )}
            {errors.tipo && <small>{errors.tipo}</small>}
          </div>

          <div>
            <label htmlFor="marca">Marca</label>
            <input id="marca" name="marca" value={form.marca} onChange={updateField} maxLength={120} />
            {errors.marca && <small>{errors.marca}</small>}
          </div>

          <div>
            <label htmlFor="linha">Linha</label>
            <input id="linha" name="linha" value={form.linha} onChange={updateField} maxLength={120} />
            {errors.linha && <small>{errors.linha}</small>}
          </div>

          <div className={styles.fullField}>
            <label htmlFor="linkExterno">Link externo *</label>
            <input
              id="linkExterno"
              name="linkExterno"
              type="url"
              inputMode="url"
              value={form.linkExterno}
              onChange={updateField}
              maxLength={2048}
              placeholder="https://drive.google.com/..."
              required
            />
            {errors.linkExterno && <small>{errors.linkExterno}</small>}
            <p className={styles.helpText}>
              Configure o arquivo ou pasta no Google Drive para que os distribuidores autorizados consigam visualizar o conteúdo.
            </p>
          </div>

          <ImageUploadField
            name="imagemCapa"
            label="Imagem de capa do material"
            file={coverFile}
            currentUrl={material?.imagemCapaUrl || ""}
            removed={removeCover}
            onFileChange={setCoverFile}
            onRemoveChange={setRemoveCover}
            error={errors.imagemCapa}
          />

          <div>
            <label htmlFor="ordem">Ordem</label>
            <input
              id="ordem"
              name="ordem"
              type="number"
              min="-100000"
              max="100000"
              step="1"
              value={form.ordem}
              onChange={updateField}
            />
            {errors.ordem && <small>{errors.ordem}</small>}
          </div>

          <div className={styles.checks}>
            <label>
              <input type="checkbox" name="destaque" checked={form.destaque} onChange={updateField} />
              Material em destaque
            </label>
            <label>
              <input type="checkbox" name="ativo" checked={form.ativo} onChange={updateField} />
              Material ativo
            </label>
          </div>

          <footer className={styles.formActions}>
            <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={submitting}>
              Cancelar
            </button>
            <button type="submit" className={styles.primaryButton} disabled={submitting}>
              {submitting ? "Salvando..." : "Salvar material"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function AdminMateriaisMarketing() {
  const [materiais, setMateriais] = useState([]);
  const [paginacao, setPaginacao] = useState({ paginaAtual: 1, totalPaginas: 0, totalItens: 0 });
  const [opcoes, setOpcoes] = useState({ categorias: [], tipos: [], marcas: [], linhas: [] });
  const [filtros, setFiltros] = useState(filtrosIniciais);
  const [filtrosAplicados, setFiltrosAplicados] = useState(filtrosIniciais);
  const [pagina, setPagina] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [modalMaterial, setModalMaterial] = useState(undefined);
  const [acaoEmAndamento, setAcaoEmAndamento] = useState("");
  const [imagensComErro, setImagensComErro] = useState(new Set());
  const filtrosAtivos = Object.entries(filtrosAplicados).filter(
    ([key, value]) => key !== "busca" && Boolean(value)
  ).length;

  useEffect(() => {
    const controller = new AbortController();
    async function carregar() {
      setCarregando(true);
      setErro("");
      try {
        const response = await api.get("/admin/materiais-marketing", {
          params: { ...filtrosAplicados, pagina, limite: 12 },
          signal: controller.signal,
        });
        const normalized = normalizeMaterialResponse(response.data, { pagina, limite: 12 });
        setMateriais(normalized.materiais);
        setPaginacao(normalized.paginacao);
        setOpcoes(normalized.filtros);
      } catch (error) {
        if (error.code !== "ERR_CANCELED") {
          setErro(error.response?.data?.message || "Não foi possível carregar os materiais");
        }
      } finally {
        if (!controller.signal.aborted) setCarregando(false);
      }
    }
    carregar();
    return () => controller.abort();
  }, [filtrosAplicados, pagina, refreshKey]);

  const aplicarFiltros = (event) => {
    event.preventDefault();
    setPagina(1);
    setFiltrosAplicados({ ...filtros });
  };

  const limparFiltros = () => {
    setFiltros(filtrosIniciais);
    setFiltrosAplicados(filtrosIniciais);
    setPagina(1);
  };

  const concluirFormulario = (message) => {
    setModalMaterial(undefined);
    setFeedback({ type: "success", message });
    setRefreshKey((value) => value + 1);
  };

  const alterarStatus = async (material) => {
    setAcaoEmAndamento(material._id);
    setFeedback(null);
    try {
      const response = await api.patch(`/admin/materiais-marketing/${material._id}/status`, {
        ativo: !material.ativo,
      });
      setFeedback({ type: "success", message: response.data.message });
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setFeedback({ type: "error", message: error.response?.data?.message || "Não foi possível alterar o status" });
    } finally {
      setAcaoEmAndamento("");
    }
  };

  const excluir = async (material) => {
    const confirmed = window.confirm(`Excluir definitivamente o material "${material.titulo}"?`);
    if (!confirmed) return;

    setAcaoEmAndamento(material._id);
    setFeedback(null);
    try {
      const response = await api.delete(`/admin/materiais-marketing/${material._id}`);
      setFeedback({ type: "success", message: response.data.message });
      setPagina((current) => (materiais.length === 1 && current > 1 ? current - 1 : current));
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setFeedback({ type: "error", message: error.response?.data?.message || "Não foi possível excluir o material" });
    } finally {
      setAcaoEmAndamento("");
    }
  };

  const marcarImagemComErro = (id) => {
    setImagensComErro((current) => new Set(current).add(id));
  };

  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <header className={styles.pageHeader}>
          <div>
            <span>Conteúdo comercial</span>
            <h1>Materiais de Marketing</h1>
            <p>Organize links de campanhas, imagens e documentos para os distribuidores.</p>
          </div>
          <button type="button" className={styles.primaryButton} onClick={() => setModalMaterial(null)}>
            Novo material
          </button>
        </header>

        {feedback && (
          <div className={feedback.type === "success" ? styles.successFeedback : styles.errorFeedback} role="status">
            {feedback.message}
          </div>
        )}

        <FilterToolbar
          activeFilterCount={filtrosAtivos}
          layout="stacked"
          searchLabel="Buscar materiais"
          searchPlaceholder="Buscar por título, categoria ou marca..."
          searchValue={filtros.busca}
          onSearchChange={(event) => setFiltros({ ...filtros, busca: event.target.value })}
          onSubmit={aplicarFiltros}
          onClear={limparFiltros}
        >
          <select aria-label="Filtrar por categoria" value={filtros.categoria} onChange={(event) => setFiltros({ ...filtros, categoria: event.target.value })}>
            <option value="">Todas as categorias</option>
            {opcoes.categorias.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Filtrar por tipo" value={filtros.tipo} onChange={(event) => setFiltros({ ...filtros, tipo: event.target.value })}>
            <option value="">Todos os tipos</option>
            {opcoes.tipos.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Filtrar por marca" value={filtros.marca} onChange={(event) => setFiltros({ ...filtros, marca: event.target.value })}>
            <option value="">Todas as marcas</option>
            {opcoes.marcas.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Filtrar por linha" value={filtros.linha} onChange={(event) => setFiltros({ ...filtros, linha: event.target.value })}>
            <option value="">Todas as linhas</option>
            {opcoes.linhas.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Filtrar por status" value={filtros.ativo} onChange={(event) => setFiltros({ ...filtros, ativo: event.target.value })}>
            <option value="">Todos os status</option>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
          </select>
          <select aria-label="Filtrar por destaque" value={filtros.destaque} onChange={(event) => setFiltros({ ...filtros, destaque: event.target.value })}>
            <option value="">Todos</option>
            <option value="true">Em destaque</option>
            <option value="false">Sem destaque</option>
          </select>
        </FilterToolbar>

        <div className={styles.listHeader}>
          <strong>{paginacao.totalItens} materiais</strong>
          <span>Página {paginacao.paginaAtual} de {Math.max(paginacao.totalPaginas, 1)}</span>
        </div>

        {carregando ? (
          <div className={styles.loadingGrid} aria-label="Carregando materiais">
            {[1, 2, 3].map((item) => <div key={item} className={styles.skeleton} />)}
          </div>
        ) : erro ? (
          <div className={styles.stateBox} role="alert">
            <p>{erro}</p>
            <button type="button" className={styles.secondaryButton} onClick={() => setRefreshKey((value) => value + 1)}>Tentar novamente</button>
          </div>
        ) : materiais.length === 0 ? (
          <div className={styles.stateBox}>
            <h2>Nenhum material encontrado</h2>
            <p>Ajuste os filtros ou cadastre o primeiro material desta biblioteca.</p>
          </div>
        ) : (
          <section className={styles.grid} aria-label="Materiais cadastrados">
            {materiais.map((material) => (
              <article className={styles.card} key={material._id}>
                <div className={styles.cover}>
                  {material.imagemCapaUrl && !imagensComErro.has(material._id) ? (
                    <img
                      src={material.imagemCapaUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      onError={() => marcarImagemComErro(material._id)}
                    />
                  ) : (
                    <span>{material.tipo || "Material"}</span>
                  )}
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.badges}>
                    <span>{material.categoria}</span>
                    <span>{material.tipo}</span>
                    {material.destaque && <strong>Destaque</strong>}
                    <strong className={material.ativo ? styles.activeBadge : styles.inactiveBadge}>
                      {material.ativo ? "Ativo" : "Inativo"}
                    </strong>
                  </div>
                  <h2>{material.titulo}</h2>
                  <p>{material.descricao || "Sem descrição cadastrada."}</p>
                  <div className={styles.metadata}>
                    <span>{[material.marca, material.linha].filter(Boolean).join(" • ") || "Sem marca ou linha"}</span>
                    <span>Publicado em {formatarData(material.createdAt)}</span>
                  </div>
                </div>
                <footer className={styles.cardActions}>
                  <button type="button" onClick={() => openMaterialLink(material.linkExterno)}>Abrir</button>
                  <button type="button" onClick={() => setModalMaterial(material)}>Editar</button>
                  <button type="button" disabled={acaoEmAndamento === material._id} onClick={() => alterarStatus(material)}>
                    {material.ativo ? "Desativar" : "Ativar"}
                  </button>
                  <button type="button" className={styles.deleteButton} disabled={acaoEmAndamento === material._id} onClick={() => excluir(material)}>Excluir</button>
                </footer>
              </article>
            ))}
          </section>
        )}

        <PaginationControls
          currentPage={pagina}
          totalPages={paginacao.totalPaginas}
          disabled={carregando}
          onPrevious={() => setPagina((value) => value - 1)}
          onNext={() => setPagina((value) => value + 1)}
        />
      </main>

      {modalMaterial !== undefined && (
        <MaterialFormModal
          material={modalMaterial}
          onClose={() => setModalMaterial(undefined)}
          onSaved={concluirFormulario}
        />
      )}
    </>
  );
}

export default AdminMateriaisMarketing;
