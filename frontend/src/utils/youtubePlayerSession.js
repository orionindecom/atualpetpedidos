const activeSessions = new WeakMap();

export function createYouTubePlayerSession({ YT, host, options }) {
  if (!YT?.Player || !host?.ownerDocument?.createElement) {
    throw new Error("Não foi possível inicializar o player do YouTube");
  }

  activeSessions.get(host)?.destroy();

  const mountNode = host.ownerDocument.createElement("div");
  host.replaceChildren(mountNode);

  let player;
  try {
    player = new YT.Player(mountNode, options);
  } catch (error) {
    host.replaceChildren();
    throw error;
  }

  let active = true;
  const session = {
    player,
    destroy() {
      if (!active) return;
      active = false;
      player.destroy?.();
      host.replaceChildren();
      if (activeSessions.get(host) === session) activeSessions.delete(host);
    },
  };

  activeSessions.set(host, session);
  return session;
}
