import { useEffect, useRef } from "react";
import {
  createProgressThrottle,
  getYouTubePlayerOrigin,
} from "../../utils/training";
import { createYouTubePlayerSession } from "../../utils/youtubePlayerSession";
import styles from "./VideoPlayer.module.css";

let youtubeApiPromise;

const loadYouTubeApi = () => {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousCallback === "function") previousCallback();
      resolve(window.YT);
    };

    const existingScript = document.querySelector("script[data-atualpet-youtube-api]");
    if (existingScript) return;

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.dataset.atualpetYoutubeApi = "true";
    script.onerror = () => reject(new Error("Falha ao carregar o player"));
    document.head.appendChild(script);
  });

  return youtubeApiPromise;
};

function YouTubePlayer({
  videoId,
  titulo,
  initialPosition = 0,
  onProgress,
  onPlayerError,
}) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const sessionRef = useRef(null);
  const intervalRef = useRef(null);
  const progressCallbackRef = useRef(onProgress);
  const errorCallbackRef = useRef(onPlayerError);
  const titleRef = useRef(titulo);
  const initialPositionRef = useRef(initialPosition);

  useEffect(() => {
    progressCallbackRef.current = onProgress;
    errorCallbackRef.current = onPlayerError;
  }, [onProgress, onPlayerError]);

  useEffect(() => {
    titleRef.current = titulo;
    const iframe = playerRef.current?.getIframe?.();
    if (iframe) iframe.title = titulo || "Player do treinamento";
  }, [titulo]);

  useEffect(() => {
    initialPositionRef.current = initialPosition;
  }, [initialPosition]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let active = true;
    let throttle;
    let session;

    const clearProgressInterval = () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const readProgress = () => {
      const player = playerRef.current;
      if (!player?.getCurrentTime || !player?.getDuration) return null;
      const posicaoSegundos = player.getCurrentTime();
      const duracaoSegundos = player.getDuration();
      if (!Number.isFinite(posicaoSegundos) || !Number.isFinite(duracaoSegundos) || duracaoSegundos <= 0) {
        return null;
      }
      return { posicaoSegundos, duracaoSegundos };
    };

    const emitProgress = (force = false) => {
      const progress = readProgress();
      if (progress) throttle?.run(progress, { force });
    };

    loadYouTubeApi()
      .then((YT) => {
        if (!active || hostRef.current !== host || !host.isConnected) return;
        throttle = createProgressThrottle(
          (progress) => progressCallbackRef.current?.(progress),
          { interval: 15000 }
        );

        session = createYouTubePlayerSession({
          YT,
          host,
          options: {
            videoId,
            width: "100%",
            height: "100%",
            playerVars: {
              rel: 0,
              modestbranding: 1,
              playsinline: 1,
              enablejsapi: 1,
              origin: getYouTubePlayerOrigin(),
              fs: 0,
            },
            events: {
              onReady: (event) => {
                const iframe = event.target.getIframe();
                iframe.title = titleRef.current || "Player do treinamento";
                iframe.referrerPolicy = "strict-origin-when-cross-origin";
                iframe.setAttribute(
                  "allow",
                  "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                );
                if (initialPositionRef.current > 0) {
                  event.target.seekTo(initialPositionRef.current, true);
                }
              },
              onStateChange: (event) => {
                if (event.data === YT.PlayerState.PLAYING) {
                  clearProgressInterval();
                  intervalRef.current = window.setInterval(() => emitProgress(), 15000);
                } else if (event.data === YT.PlayerState.PAUSED) {
                  clearProgressInterval();
                  emitProgress(true);
                } else if (event.data === YT.PlayerState.ENDED) {
                  clearProgressInterval();
                  emitProgress(true);
                }
              },
              onError: () => errorCallbackRef.current?.("Não foi possível reproduzir este vídeo."),
            },
          },
        });
        playerRef.current = session.player;
        sessionRef.current = session;
      })
      .catch(() => errorCallbackRef.current?.("Não foi possível carregar o player de vídeo."));

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") emitProgress(true);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      emitProgress(true);
      clearProgressInterval();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (sessionRef.current === session) sessionRef.current = null;
      if (playerRef.current === session?.player) playerRef.current = null;
      session?.destroy();
    };
  }, [videoId]);

  return (
    <div
      className={styles.youtubePlayer}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div ref={hostRef} />
    </div>
  );
}

export default YouTubePlayer;
