import { toast } from 'sonner';
import type { Episode } from '@/types';
import { chooseWorkFile, openWorkPath } from '@/services/sceneWorkLinkService';
import { updateEpisodeReelPath } from '@/services/supabaseService';

export async function openOrRegisterEpisodeReel({
  episode,
  getEpisodes,
  setEpisodes,
  logLabel,
}: {
  episode: Pick<Episode, 'episodeNumber' | 'reelFilePath'>;
  getEpisodes: () => Episode[];
  setEpisodes: (episodes: Episode[]) => void;
  logLabel: string;
}): Promise<void> {
  if (episode.reelFilePath) {
    const res = await openWorkPath(episode.reelFilePath);
    if (!res.ok) toast.error('릴 파일 열기에 실패했어요');
    return;
  }

  const filePath = await chooseWorkFile();
  if (!filePath) return;

  const prev = getEpisodes();
  setEpisodes(prev.map((item) => (
    item.episodeNumber === episode.episodeNumber ? { ...item, reelFilePath: filePath } : item
  )));
  try {
    await updateEpisodeReelPath(episode.episodeNumber, filePath);
    toast.success('릴 파일 경로를 등록했어요');
  } catch (err) {
    console.error(`[${logLabel}] 릴 파일 경로 저장 실패:`, err);
    setEpisodes(prev);
    toast.error('릴 파일 경로 저장에 실패했어요');
  }
}
