export function createTimeline(scenes, mediaById, fps=30) {
  let from=0; const seen=new Set();
  const timed=scenes.map(scene=>{
    if(seen.has(scene.id))throw new Error(`Duplicate scene ${scene.id}`);seen.add(scene.id);
    const media=mediaById[scene.id];
    if(!media || !Number.isFinite(media.audioSeconds) || media.audioSeconds<=0)throw new Error(`Missing/invalid narration ${scene.id}`);
    let previous=0;
    if(!media.captions?.length)throw new Error(`Missing captions ${scene.id}`);
    for(const c of media.captions){if(!c.text || c.startMs<previous || c.endMs<=c.startMs || c.endMs>media.audioSeconds*1000+100)throw new Error(`Invalid caption ${scene.id}`);previous=c.endMs;}
    const narrationStartFrame=15;
    const durationInFrames=Math.max(Math.ceil(scene.minimumSeconds*fps),narrationStartFrame+Math.ceil(media.audioSeconds*fps)+24);
    const result={scene,media,from,durationInFrames,narrationStartFrame};from+=durationInFrames;return result;
  });
  return {scenes:timed,durationInFrames:from};
}
const stamp=ms=>{const n=Math.round(ms);return `${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')},${String(n%1000).padStart(3,'0')}`;};
export function toSrt(timeline,fps=30){let i=0;return timeline.scenes.flatMap(t=>t.media.captions.map(c=>{const base=(t.from+t.narrationStartFrame)*1000/fps;return `${++i}\n${stamp(base+c.startMs)} --> ${stamp(base+c.endMs)}\n${c.text}\n`;})).join('\n');}
