import type Phaser from "phaser";

const backgroundMusicRegistryKey = "backgroundMusic";
const backgroundMusicGhostModeRegistryKey = "backgroundMusicGhostMode";

const dayMusicPath = "/sounds/day.m4a";
const nightMusicPath = "/sounds/night.m4a";

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
    void audio.play().catch(() => {
      // Autoplay blocked or load failed
    });
  } catch {
    console.error("Failed to play background music using url: ", url);
  }
}

export function stopBackgroundMusic(registry: Phaser.Data.DataManager): void {
  const audio = registry.get(backgroundMusicRegistryKey) as HTMLAudioElement | undefined;
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  registry.remove(backgroundMusicRegistryKey);
  registry.remove(backgroundMusicGhostModeRegistryKey);
}
