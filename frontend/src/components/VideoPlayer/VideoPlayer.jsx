import YouTubePlayer from "./YouTubePlayer";
import { getPlayerKind } from "../../utils/training";
import styles from "./VideoPlayer.module.css";

function UnsupportedVideoProvider() {
  return (
    <div className={styles.unsupported} role="alert">
      Este provedor de vídeo ainda não é compatível com o portal.
    </div>
  );
}

function VideoPlayer({ provider, ...props }) {
  if (getPlayerKind(provider) === "youtube") {
    return <YouTubePlayer {...props} />;
  }

  return <UnsupportedVideoProvider />;
}

export default VideoPlayer;
