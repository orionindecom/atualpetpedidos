import { useEffect, useState } from "react";
import api from "../../api/axios";
import ImageUploadField from "../../components/ImageUploadField/ImageUploadField";
import {
  FilterToolbar,
  PaginationControls,
} from "../../components/ListControls/ListControls";
import Navbar from "../../components/Navbar/Navbar";
import PageHeader from "../../components/PageHeader/PageHeader";
import VideoPlayer from "../../components/VideoPlayer/VideoPlayer";
import {
  extractYouTubeVideoId,
  formatTrainingDuration,
  getTrainingThumbnail,
  normalizeTrainingResponse,
  TRAINING_CATEGORIES,
} from "../../utils/training";
import { buildImageFormData } from "../../utils/imageUpload";
import styles from "./AdminTreinamentos.module.css";

const filtrosIniciais = {
  busca: "",
  categoria: "",
  marca: "",
  linha: "",
  ativo: "",
  destaque: "",
  obrigatorio: "",
};

const toDateTimeLocal = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const createEmptyForm = () => ({
  titulo: "",
  resumo: "",
  descricao: "",
  categoriaOpcao: TRAINING_CATEGORIES[0],
  categoriaOutro: "",
  marca: "",
  linha: "",
  instrutor: "",
  duracaoMinutos: "0",
  provider: "youtube",
  videoInput: "",
  destaque: false,
  obrigatorio: false,
  ordem: "0",
  ativo: true,
  publicadoEm: toDateTimeLocal(),
});

const createFormFromTraining = (training) => {
  if (!training) return createEmptyForm();
  const suggestedCategory = TRAINING_CATEGORIES.includes(training.categoria);
  return {
    titulo: training.titulo || "",
    resumo: training.resumo || "",
    descricao: training.descricao || "",
    categoriaOpcao: suggestedCategory ? training.categoria : "__outro",
    categoriaOutro: suggestedCategory ? "" : training.categoria || "",
    marca: training.marca || "",
    linha: training.linha || "",
    instrutor: training.instrutor || "",
    duracaoMinutos: String(Math.round((training.duracaoSegundos || 0) / 60)),
    provider: training.provider || "youtube",
    videoInput: training.videoId || "",
    destaque: Boolean(training.destaque),
    obrigatorio: Boolean(training.obrigatorio),
    ordem: String(training.ordem ?? 0),
    ativo: training.ativo !== false,
    publicadoEm: training.publicadoEm ? toDateTimeLocal(training.publicadoEm) : "",
  };
};

const formatDate = (value) => {
  if (!value) return "Não publicado";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Não publicado" : date.toLocaleDateString("pt-BR");
};

function TrainingFormModal({ training, onClose, onSaved }) {
  const [form, setForm] = useState(() => createFormFromTraining(training));
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [removeThumbnail, setRemoveThumbnail] = useState(false);
  const videoId = extractYouTubeVideoId(form.videoInput);
  const fallbackThumbnail = getTrainingThumbnail({
    provider: form.provider,
    videoId,
  });

  const updateField = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
    setErrors((current) => ({ ...current, [name]: undefined, videoId: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const categoria = form.categoriaOpcao === "__outro" ? form.categoriaOutro.trim() : form.categoriaOpcao;
    const localErrors = {};
    if (!form.titulo.trim()) localErrors.titulo = "Informe o título";
    if (!form.resumo.trim()) localErrors.resumo = "Informe um resumo curto";
    if (!categoria) localErrors.categoria = "Informe a categoria";
    if (!videoId) localErrors.videoId = "Informe um ID ou link válido do YouTube";
    if (!Number.isFinite(Number(form.duracaoMinutos)) || Number(form.duracaoMinutos) < 0) {
      localErrors.duracaoSegundos = "Informe uma duração válida";
    }
    if (!Number.isInteger(Number(form.ordem))) localErrors.ordem = "Informe um número inteiro";
    if (Object.keys(localErrors).length) {
      setErrors(localErrors);
      return;
    }

    const payload = {
      titulo: form.titulo,
      resumo: form.resumo,
      descricao: form.descricao,
      categoria,
      marca: form.marca,
      linha: form.linha,
      instrutor: form.instrutor,
      duracaoSegundos: Number(form.duracaoMinutos) * 60,
      provider: form.provider,
      videoId,
      destaque: form.destaque,
      obrigatorio: form.obrigatorio,
      ordem: Number(form.ordem),
      ativo: form.ativo,
      publicadoEm: form.publicadoEm ? new Date(form.publicadoEm).toISOString() : null,
    };

    setSubmitting(true);
    setErrors({});
    try {
      const requestBody = buildImageFormData(payload, {
        file: thumbnailFile,
        fileField: "thumbnail",
        remove: removeThumbnail,
        removeField: "removerThumbnail",
      });

      if (training) await api.put(`/admin/treinamentos/${training._id}`, requestBody);
      else await api.post("/admin/treinamentos", requestBody);
      onSaved(training ? "Treinamento atualizado com sucesso" : "Treinamento criado com sucesso");
    } catch (error) {
      setErrors(error.response?.data?.errors || {
        formulario: error.response?.data?.message || "Não foi possível salvar o treinamento",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onMouseDown={submitting ? undefined : onClose}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="training-form-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div><span>Conteúdo educacional</span><h2 id="training-form-title">{training ? "Editar treinamento" : "Novo treinamento"}</h2></div>
          <button type="button" onClick={onClose} disabled={submitting}>Fechar</button>
        </header>

        <form className={styles.form} onSubmit={submit} noValidate>
          {errors.formulario && <div className={styles.formError} role="alert">{errors.formulario}</div>}
          <div className={styles.fullField}>
            <label htmlFor="titulo">Título *</label>
            <input id="titulo" name="titulo" value={form.titulo} onChange={updateField} maxLength="180" autoFocus />
            {errors.titulo && <small>{errors.titulo}</small>}
          </div>
          <div className={styles.fullField}>
            <label htmlFor="resumo">Resumo *</label>
            <textarea id="resumo" name="resumo" value={form.resumo} onChange={updateField} maxLength="300" rows="2" />
            <div className={styles.fieldMeta}>{errors.resumo ? <small>{errors.resumo}</small> : <span />}<span>{form.resumo.length} / 300</span></div>
          </div>
          <div className={styles.fullField}>
            <label htmlFor="descricao">Descrição</label>
            <textarea id="descricao" name="descricao" value={form.descricao} onChange={updateField} maxLength="3000" rows="5" />
            <div className={styles.fieldMeta}>{errors.descricao ? <small>{errors.descricao}</small> : <span />}<span>{form.descricao.length} / 3000</span></div>
          </div>
          <div>
            <label htmlFor="categoriaOpcao">Categoria *</label>
            <select id="categoriaOpcao" name="categoriaOpcao" value={form.categoriaOpcao} onChange={updateField}>
              {TRAINING_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
              <option value="__outro">Outra categoria</option>
            </select>
            {form.categoriaOpcao === "__outro" && <input className={styles.conditionalInput} name="categoriaOutro" value={form.categoriaOutro} onChange={updateField} maxLength="120" placeholder="Informe a categoria" />}
            {errors.categoria && <small>{errors.categoria}</small>}
          </div>
          <div>
            <label htmlFor="provider">Provedor</label>
            <select id="provider" name="provider" value={form.provider} onChange={updateField}><option value="youtube">YouTube</option></select>
            {errors.provider && <small>{errors.provider}</small>}
          </div>
          <div><label htmlFor="marca">Marca</label><input id="marca" name="marca" value={form.marca} onChange={updateField} maxLength="120" /></div>
          <div><label htmlFor="linha">Linha</label><input id="linha" name="linha" value={form.linha} onChange={updateField} maxLength="120" /></div>
          <div><label htmlFor="instrutor">Instrutor</label><input id="instrutor" name="instrutor" value={form.instrutor} onChange={updateField} maxLength="150" /></div>
          <div>
            <label htmlFor="duracaoMinutos">Duração em minutos</label>
            <input id="duracaoMinutos" name="duracaoMinutos" type="number" min="0" max="1440" step="1" value={form.duracaoMinutos} onChange={updateField} />
            {errors.duracaoSegundos && <small>{errors.duracaoSegundos}</small>}
          </div>
          <div className={styles.fullField}>
            <label htmlFor="videoInput">Link ou ID do YouTube *</label>
            <input id="videoInput" name="videoInput" value={form.videoInput} onChange={updateField} placeholder="https://youtu.be/... ou ID do vídeo" inputMode="url" />
            {form.videoInput && !videoId && <small>O link ou ID informado não é válido.</small>}
            {errors.videoId && <small>{errors.videoId}</small>}
            <p className={styles.helpText}>Publique o vídeo no YouTube como não listado. O portal restringe o acesso à página do treinamento, mas o YouTube não oferece DRM nesta configuração.</p>
          </div>
          <ImageUploadField
            name="thumbnail"
            label="Thumbnail do treinamento"
            file={thumbnailFile}
            currentUrl={training?.thumbnailUrl || ""}
            fallbackUrl={fallbackThumbnail}
            removed={removeThumbnail}
            onFileChange={setThumbnailFile}
            onRemoveChange={setRemoveThumbnail}
            error={errors.thumbnail}
          />
          {videoId && (
            <div className={styles.previewArea}>
              <div><strong>Vídeo validado</strong><span>Somente o ID será salvo.</span></div>
              <VideoPlayer provider="youtube" videoId={videoId} titulo={`Prévia de ${form.titulo || "treinamento"}`} />
            </div>
          )}
          <div><label htmlFor="ordem">Ordem</label><input id="ordem" name="ordem" type="number" min="-100000" max="100000" step="1" value={form.ordem} onChange={updateField} />{errors.ordem && <small>{errors.ordem}</small>}</div>
          <div><label htmlFor="publicadoEm">Data de publicação</label><input id="publicadoEm" name="publicadoEm" type="datetime-local" value={form.publicadoEm} onChange={updateField} />{errors.publicadoEm && <small>{errors.publicadoEm}</small>}</div>
          <div className={styles.checks}>
            <label><input type="checkbox" name="destaque" checked={form.destaque} onChange={updateField} /> Destaque</label>
            <label><input type="checkbox" name="obrigatorio" checked={form.obrigatorio} onChange={updateField} /> Obrigatório</label>
            <label><input type="checkbox" name="ativo" checked={form.ativo} onChange={updateField} /> Ativo</label>
          </div>
          <footer className={styles.formActions}>
            <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="submit" className={styles.primaryButton} disabled={submitting}>{submitting ? "Salvando..." : "Salvar treinamento"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function ProgressModal({ training, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api.get(`/admin/treinamentos/${training._id}/progresso`, { signal: controller.signal })
      .then((response) => setData(response.data))
      .catch((requestError) => {
        if (requestError.code !== "ERR_CANCELED") setError(requestError.response?.data?.message || "Não foi possível carregar o progresso");
      });
    return () => controller.abort();
  }, [training._id]);

  return (
    <div className={styles.modalOverlay} onMouseDown={onClose}>
      <section className={`${styles.modal} ${styles.progressModal}`} role="dialog" aria-modal="true" aria-labelledby="progress-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}><div><span>Acompanhamento</span><h2 id="progress-title">{training.titulo}</h2></div><button type="button" onClick={onClose}>Fechar</button></header>
        {error ? <div className={styles.stateBox} role="alert">{error}</div> : !data ? <div className={styles.stateBox}>Carregando progresso...</div> : (
          <div className={styles.progressContent}>
            <div className={styles.metrics}>
              <div><span>Iniciaram</span><strong>{data.resumo.totalIniciaram}</strong></div>
              <div><span>Concluíram</span><strong>{data.resumo.totalConcluiram}</strong></div>
              <div><span>Média</span><strong>{Math.round(data.resumo.mediaProgresso)}%</strong></div>
            </div>
            {data.usuarios.length === 0 ? <div className={styles.stateBox}>Nenhum distribuidor iniciou este treinamento.</div> : (
              <div className={styles.progressList}>
                {data.usuarios.map((item) => (
                  <div key={item.usuarioId?._id || item.usuarioId}>
                    <span><strong>{item.usuarioId?.nomeFantasia || item.usuarioId?.nomeResponsavel || "Cliente"}</strong><small>{item.usuarioId?.email || ""}</small></span>
                    <span>{Math.round(item.percentualAssistido)}% • {item.concluido ? "Concluído" : "Em andamento"}</span>
                    <time>{item.ultimoAcessoEm ? new Date(item.ultimoAcessoEm).toLocaleDateString("pt-BR") : "Sem acesso recente"}</time>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function AdminTreinamentos() {
  const [treinamentos, setTreinamentos] = useState([]);
  const [paginacao, setPaginacao] = useState({ paginaAtual: 1, totalPaginas: 0, totalItens: 0 });
  const [opcoes, setOpcoes] = useState({ categorias: [], marcas: [], linhas: [] });
  const [filtros, setFiltros] = useState(filtrosIniciais);
  const [filtrosAplicados, setFiltrosAplicados] = useState(filtrosIniciais);
  const [pagina, setPagina] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [formTraining, setFormTraining] = useState(undefined);
  const [previewTraining, setPreviewTraining] = useState(null);
  const [progressTraining, setProgressTraining] = useState(null);
  const [actionId, setActionId] = useState("");
  const [imageErrors, setImageErrors] = useState(new Set());

  const filtrosAtivos = Object.entries(filtrosAplicados).filter(
    ([key, value]) => key !== "busca" && Boolean(value)
  ).length;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setCarregando(true);
      setErro("");
      try {
        const response = await api.get("/admin/treinamentos", { params: { ...filtrosAplicados, pagina, limite: 12 }, signal: controller.signal });
        const normalized = normalizeTrainingResponse(response.data, { pagina, limite: 12 });
        setTreinamentos(normalized.treinamentos);
        setPaginacao(normalized.paginacao);
        setOpcoes(normalized.filtros);
      } catch (error) {
        if (error.code !== "ERR_CANCELED") setErro(error.response?.data?.message || "Não foi possível carregar os treinamentos");
      } finally {
        if (!controller.signal.aborted) setCarregando(false);
      }
    }
    load();
    return () => controller.abort();
  }, [filtrosAplicados, pagina, refreshKey]);

  const applyFilters = (event) => { event.preventDefault(); setPagina(1); setFiltrosAplicados({ ...filtros }); };
  const clearFilters = () => { setFiltros(filtrosIniciais); setFiltrosAplicados(filtrosIniciais); setPagina(1); };
  const saved = (message) => { setFormTraining(undefined); setFeedback({ type: "success", message }); setRefreshKey((value) => value + 1); };
  const closeActionMenu = (event) => event.currentTarget.closest("details")?.removeAttribute("open");

  const changeStatus = async (training) => {
    setActionId(training._id);
    try {
      const response = await api.patch(`/admin/treinamentos/${training._id}/status`, { ativo: !training.ativo });
      setFeedback({ type: "success", message: response.data.message });
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setFeedback({ type: "error", message: error.response?.data?.message || "Não foi possível alterar o status" });
    } finally { setActionId(""); }
  };

  const remove = async (training) => {
    if (!window.confirm(`Excluir definitivamente o treinamento "${training.titulo}" e seus progressos?`)) return;
    setActionId(training._id);
    try {
      const response = await api.delete(`/admin/treinamentos/${training._id}`);
      setFeedback({ type: "success", message: response.data.message });
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setFeedback({ type: "error", message: error.response?.data?.message || "Não foi possível excluir o treinamento" });
    } finally { setActionId(""); }
  };

  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <PageHeader
          eyebrow="Administração de conteúdo"
          title="Treinamentos"
          description="Publique e acompanhe conteúdos exclusivos para distribuidores."
          action={<button type="button" className={styles.primaryButton} onClick={() => setFormTraining(null)}>Novo treinamento</button>}
        />
        {feedback && <div className={feedback.type === "success" ? styles.successFeedback : styles.errorFeedback} role="status">{feedback.message}</div>}
        <FilterToolbar
          activeFilterCount={filtrosAtivos}
          layout="stacked"
          searchLabel="Buscar treinamentos"
          searchPlaceholder="Buscar por título, descrição ou instrutor..."
          searchValue={filtros.busca}
          onSearchChange={(event) => setFiltros({ ...filtros, busca: event.target.value })}
          onSubmit={applyFilters}
          onClear={clearFilters}
        >
          <select aria-label="Categoria" value={filtros.categoria} onChange={(event) => setFiltros({ ...filtros, categoria: event.target.value })}><option value="">Todas as categorias</option>{opcoes.categorias.map((item) => <option key={item}>{item}</option>)}</select>
          <select aria-label="Marca" value={filtros.marca} onChange={(event) => setFiltros({ ...filtros, marca: event.target.value })}><option value="">Todas as marcas</option>{opcoes.marcas.map((item) => <option key={item}>{item}</option>)}</select>
          <select aria-label="Linha" value={filtros.linha} onChange={(event) => setFiltros({ ...filtros, linha: event.target.value })}><option value="">Todas as linhas</option>{opcoes.linhas.map((item) => <option key={item}>{item}</option>)}</select>
          <select aria-label="Status" value={filtros.ativo} onChange={(event) => setFiltros({ ...filtros, ativo: event.target.value })}><option value="">Todos os status</option><option value="true">Ativos</option><option value="false">Inativos</option></select>
          <select aria-label="Destaque" value={filtros.destaque} onChange={(event) => setFiltros({ ...filtros, destaque: event.target.value })}><option value="">Todos</option><option value="true">Destaques</option><option value="false">Sem destaque</option></select>
          <select aria-label="Obrigatório" value={filtros.obrigatorio} onChange={(event) => setFiltros({ ...filtros, obrigatorio: event.target.value })}><option value="">Todos</option><option value="true">Obrigatórios</option><option value="false">Opcionais</option></select>
        </FilterToolbar>
        <div className={styles.listHeader}><strong>{paginacao.totalItens} treinamentos</strong><span>Página {paginacao.paginaAtual} de {Math.max(1, paginacao.totalPaginas)}</span></div>
        {carregando ? <div className={styles.grid}>{[1,2,3].map((item) => <div className={styles.skeleton} key={item} />)}</div> : erro ? <div className={styles.stateBox} role="alert">{erro}</div> : treinamentos.length === 0 ? <div className={styles.stateBox}><h2>Nenhum treinamento encontrado</h2><p>Cadastre um conteúdo ou ajuste os filtros.</p></div> : (
          <section className={styles.grid} aria-label="Treinamentos cadastrados">
            {treinamentos.map((training) => {
              const thumbnail = getTrainingThumbnail(training);
              return (
                <article className={styles.card} key={training._id}>
                  <div className={styles.cover}>{thumbnail && !imageErrors.has(training._id) ? <img src={thumbnail} alt="" loading="lazy" decoding="async" onError={() => setImageErrors((current) => new Set(current).add(training._id))} /> : <span>Treinamento AtualPet</span>}</div>
                  <div className={styles.cardBody}>
                    <div className={styles.cardTopline}>
                      <span className={styles.category}>{training.categoria}</span>
                      <span className={training.ativo ? styles.activeStatus : styles.inactiveStatus}>{training.ativo ? "Ativo" : "Inativo"}</span>
                    </div>
                    <div className={styles.flags}><span>{training.provider === "youtube" ? "YouTube" : training.provider}</span>{training.destaque && <strong>Destaque</strong>}{training.obrigatorio && <strong>Obrigatório</strong>}</div>
                    <h2>{training.titulo}</h2>
                    <p>{training.resumo || "Sem resumo cadastrado."}</p>
                    <div className={styles.metadata}><span>{[training.marca, training.linha].filter(Boolean).join(" • ") || "Sem marca ou linha"}</span><span>{training.instrutor || "Sem instrutor"} • {formatTrainingDuration(training.duracaoSegundos)}</span><span>Publicação: {formatDate(training.publicadoEm)}</span></div>
                  </div>
                  <footer className={styles.cardActions}>
                    <button className={styles.editButton} onClick={() => setFormTraining(training)}>Editar</button>
                    <details className={styles.actionMenu}>
                      <summary aria-label={`Mais ações para ${training.titulo}`}>⋯</summary>
                      <div>
                        <button onClick={(event) => { closeActionMenu(event); setPreviewTraining(training); }}>Abrir prévia</button>
                        <button onClick={(event) => { closeActionMenu(event); setProgressTraining(training); }}>Ver progresso</button>
                        <button disabled={actionId === training._id} onClick={(event) => { closeActionMenu(event); changeStatus(training); }}>{training.ativo ? "Desativar" : "Ativar"}</button>
                        <button className={styles.deleteButton} disabled={actionId === training._id} onClick={(event) => { closeActionMenu(event); remove(training); }}>Excluir</button>
                      </div>
                    </details>
                  </footer>
                </article>
              );
            })}
          </section>
        )}
        <PaginationControls
          currentPage={pagina}
          totalPages={paginacao.totalPaginas}
          onPrevious={() => setPagina((value) => value - 1)}
          onNext={() => setPagina((value) => value + 1)}
        />
      </main>
      {formTraining !== undefined && <TrainingFormModal training={formTraining} onClose={() => setFormTraining(undefined)} onSaved={saved} />}
      {previewTraining && <div className={styles.modalOverlay} onMouseDown={() => setPreviewTraining(null)}><section className={`${styles.modal} ${styles.previewModal}`} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header className={styles.modalHeader}><div><span>Prévia administrativa</span><h2>{previewTraining.titulo}</h2></div><button type="button" onClick={() => setPreviewTraining(null)}>Fechar</button></header><VideoPlayer provider={previewTraining.provider} videoId={previewTraining.videoId} titulo={previewTraining.titulo} /></section></div>}
      {progressTraining && <ProgressModal training={progressTraining} onClose={() => setProgressTraining(null)} />}
    </>
  );
}

export default AdminTreinamentos;
