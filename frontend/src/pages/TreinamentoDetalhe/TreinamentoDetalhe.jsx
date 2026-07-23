import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import PageHeader from "../../components/PageHeader/PageHeader";
import VideoPlayer from "../../components/VideoPlayer/VideoPlayer";
import { getAuthSession } from "../../utils/authSession";
import {
  buildTrainingWatermark,
  clampProgress,
  formatTrainingDuration,
  getTrainingProgressState,
} from "../../utils/training";
import styles from "./TreinamentoDetalhe.module.css";

const watermarkPositions = ["topLeft", "topRight", "middleLeft", "middleRight"];

function TreinamentoDetalhe() {
  const { id } = useParams();
  const navigate = useNavigate();
  const playerShellRef = useRef(null);
  const savingRef = useRef(false);
  const pendingProgressRef = useRef(null);
  const [treinamento, setTreinamento] = useState(null);
  const [progresso, setProgresso] = useState(null);
  const [resumePosition, setResumePosition] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [erroPlayer, setErroPlayer] = useState("");
  const [erroProgresso, setErroProgresso] = useState("");
  const [watermarkPosition, setWatermarkPosition] = useState(0);
  const watermark = buildTrainingWatermark(
    treinamento?.identificacaoAcesso || getAuthSession()?.usuario
  );

  useEffect(() => {
    const controller = new AbortController();
    async function carregar() {
      setCarregando(true);
      setErro("");
      try {
        const response = await api.get(`/treinamentos/${id}`, { signal: controller.signal });
        const data = response.data?.treinamento;
        setTreinamento(data);
        setProgresso(data?.progresso || {});
        setResumePosition(data?.progresso?.ultimaPosicaoSegundos || 0);
      } catch (error) {
        if (error.code !== "ERR_CANCELED") {
          if (error.response?.status === 404) {
            setErro("Este treinamento não está disponível.");
          } else if (error.response?.status === 403) {
            setErro("Sua conta não possui acesso a este treinamento.");
          } else {
            setErro("Não foi possível carregar o treinamento.");
          }
        }
      } finally {
        if (!controller.signal.aborted) setCarregando(false);
      }
    }
    carregar();
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    const interval = window.setInterval(
      () => setWatermarkPosition((current) => (current + 1) % watermarkPositions.length),
      12000
    );
    return () => window.clearInterval(interval);
  }, []);

  const salvarProgresso = useCallback(async (payload) => {
    pendingProgressRef.current = payload;
    if (savingRef.current) return;

    savingRef.current = true;
    while (pendingProgressRef.current) {
      const current = pendingProgressRef.current;
      pendingProgressRef.current = null;
      try {
        const response = await api.put(`/treinamentos/${id}/progresso`, current);
        setProgresso(response.data?.progresso || {});
        setErroProgresso("");
      } catch (error) {
        if (![401, 403].includes(error.response?.status)) {
          setErroProgresso("Não foi possível salvar o progresso agora.");
        }
      }
    }
    savingRef.current = false;
  }, [id]);

  const ativarTelaCheia = async () => {
    try {
      await playerShellRef.current?.requestFullscreen?.();
    } catch {
      setErroPlayer("A tela cheia não está disponível neste dispositivo.");
    }
  };

  if (carregando) {
    return (
      <><Navbar /><main className={styles.container}><div className={styles.loading} aria-live="polite">Carregando treinamento...</div></main></>
    );
  }

  if (erro || !treinamento) {
    return (
      <><Navbar /><main className={styles.container}><div className={styles.stateBox} role="alert"><h1>Treinamento indisponível</h1><p>{erro}</p><button type="button" onClick={() => navigate("/treinamentos")}>Voltar aos treinamentos</button></div></main></>
    );
  }

  const progressValue = clampProgress(progresso?.percentualAssistido);
  const progressState = getTrainingProgressState(progresso);

  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <button type="button" className={styles.backButton} onClick={() => navigate("/treinamentos")}>
          ← Voltar aos treinamentos
        </button>

        <PageHeader
          eyebrow="Conteúdo exclusivo AtualPet"
          title={treinamento.titulo}
          description={[
            treinamento.instrutor || "Equipe AtualPet",
            formatTrainingDuration(treinamento.duracaoSegundos),
          ].join(" • ")}
        >
          <div className={styles.badges}>
            <span>{treinamento.categoria}</span>
            {treinamento.obrigatorio && <strong>Obrigatório</strong>}
            {treinamento.destaque && <strong>Destaque</strong>}
          </div>
        </PageHeader>

        <section className={styles.playerSection} aria-label="Reprodução do treinamento">
          <div className={styles.playerShell} ref={playerShellRef}>
            <div className={styles.playerFrame}>
              <VideoPlayer
                provider={treinamento.provider}
                videoId={treinamento.videoId}
                titulo={treinamento.titulo}
                initialPosition={resumePosition}
                onProgress={salvarProgresso}
                onPlayerError={setErroPlayer}
              />
            </div>
            <div className={`${styles.watermark} ${styles[watermarkPositions[watermarkPosition]]}`} aria-hidden="true">
              <strong>{watermark.nome}</strong>
              <span>{watermark.cliente}</span>
              <small>AtualPet • {watermark.sessao}</small>
            </div>
            <button type="button" className={styles.fullscreenButton} onClick={ativarTelaCheia}>
              Tela cheia
            </button>
          </div>
          {erroPlayer && <div className={styles.feedback} role="alert">{erroPlayer}</div>}
        </section>

        <section className={styles.progressSection} aria-label="Seu progresso">
          <div>
            <span>Seu progresso</span>
            <strong>{progressState.label}</strong>
          </div>
          <div className={styles.progressValue}>
            <div className={styles.progressTrack} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progressValue)}>
              <span style={{ width: `${progressValue}%` }} />
            </div>
            <strong>{Math.round(progressValue)}%</strong>
          </div>
          {erroProgresso && <small role="status">{erroProgresso}</small>}
        </section>

        <section className={styles.content}>
          <div>
            <h2>Sobre este treinamento</h2>
            <p>{treinamento.descricao || treinamento.resumo || "Conteúdo exclusivo para distribuidores AtualPet."}</p>
          </div>
          <aside>
            <strong>Acesso exclusivo</strong>
            <p>Este conteúdo é destinado a distribuidores autenticados. A marca-d’água identifica visualmente a sessão, mas não impede gravações de tela.</p>
          </aside>
        </section>
      </main>
    </>
  );
}

export default TreinamentoDetalhe;
