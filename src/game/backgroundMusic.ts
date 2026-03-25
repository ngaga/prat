import type Phaser from "phaser";

const backgroundMusicRegistryKey = "backgroundMusic";
const backgroundMusicGhostModeRegistryKey = "backgroundMusicGhostMode";
const backgroundMusicVisibilityCleanupRegistryKey = "backgroundMusicVisibilityCleanup";

const dayMusicPath = "/sounds/day.m4a";
const nightMusicPath = "/sounds/night.m4a";

function playBackgroundMusicIfPageVisible(audio: HTMLAudioElement): void {
  if (document.visibilityState !== "visible") {
    return;
  }
  void audio.play().catch(() => {
    // Autoplay blocked or load failed
  });
}

function detachPageVisibilityHandler(registry: Phaser.Data.DataManager): void {
  const cleanup = registry.get(backgroundMusicVisibilityCleanupRegistryKey) as
    | (() => void)
    | undefined;
  if (cleanup) {
    cleanup();
    registry.remove(backgroundMusicVisibilityCleanupRegistryKey);
  }
}

function attachPageVisibilityHandler(
  registry: Phaser.Data.DataManager,
  audio: HTMLAudioElement
): void {
  detachPageVisibilityHandler(registry);
  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      audio.pause();
    } else {
      void audio.play().catch(() => {
        // Autoplay may still be restricted in some cases after focus return
      });
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  const cleanup = (): void => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
  registry.set(backgroundMusicVisibilityCleanupRegistryKey, cleanup);
}

/**
 * Loops day or night track based on local ghost mode. Skips restart if the mode is unchanged.
 */
export function setBackgroundMusicForGhostMode(
  registry: Phaser.Data.DataManager,
  isGhost: boolean
): void {
  const previousMode = registry.get(backgroundMusicGhostModeRegistryKey) as boolean | undefined;
  if (previousMode === isGhost && registry.get(backgroundMusicRegistryKey)) {
    return;
  }

  detachPageVisibilityHandler(registry);
  const previousAudio = registry.get(backgroundMusicRegistryKey) as HTMLAudioElement | undefined;
  if (previousAudio) {
    previousAudio.pause();
    previousAudio.removeAttribute("src");
    previousAudio.load();
  }

  const url = isGhost ? nightMusicPath : dayMusicPath;
  try {
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.5;
    registry.set(backgroundMusicGhostModeRegistryKey, isGhost);
    registry.set(backgroundMusicRegistryKey, audio);
    attachPageVisibilityHandler(registry, audio);
    playBackgroundMusicIfPageVisible(audio);
  } catch {
    console.error("Failed to play background music using url: ", url);
  }
}

export function stopBackgroundMusic(registry: Phaser.Data.DataManager): void {
  detachPageVisibilityHandler(registry);
  const audio = registry.get(backgroundMusicRegistryKey) as HTMLAudioElement | undefined;
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  registry.remove(backgroundMusicRegistryKey);
  registry.remove(backgroundMusicGhostModeRegistryKey);
}
