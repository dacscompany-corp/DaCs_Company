import fs from 'node:fs';
import {createTimeline,toSrt} from './timing.mjs';
const media=JSON.parse(fs.readFileSync('content/media-manifest.json','utf8'));
const config=[['workers','WorkMateWorkers','dacs-workmate-workers-taglish','For Workers'],['buying','WorkMateBuying','dacs-workmate-buying-taglish','For Procurement / Buying'],['web','DacsWeb','dacs-web-taglish','The office workspace']];
const videos=config.map(([key,id,file,subtitle])=>{
 const scenes=JSON.parse(fs.readFileSync(`content/${key}.json`,'utf8'));
 const timeline=createTimeline(scenes,media);
 fs.writeFileSync(`out/${file}.srt`,toSrt(timeline));
 return {key,id,file,subtitle,...timeline};
});
fs.writeFileSync('content/timelines.json',JSON.stringify(videos,null,2));
fs.writeFileSync('out/taglish-narration.md',videos.map(v=>`# ${v.id}\n\n`+v.scenes.map(t=>`## ${t.scene.id} — ${t.scene.title}\n\n${t.scene.narration}`).join('\n\n')).join('\n\n'));
for(const v of videos)console.log(v.id,v.durationInFrames,'frames',Math.round(v.durationInFrames/30)+'s');
