import fs from 'node:fs';
const spec=fs.readFileSync('../../docs/superpowers/specs/2026-09-30-workmate-remotion-video-design.md','utf8');
const names={W:'workers',B:'buying',D:'web'};
const titles={W:['Kasama sa bawat araw sa site.','Isang tingin. Alam ang gagawin.','Time In. Time Out. All clear.','Tamang item. Tamang project.','Ipakita ang kailangan.','Isang team. Isang malinaw na request.','Walang signal? May malinaw na status.','Hanapin. Kilalanin. Request ulit.','Klaro ang assignment.','I-report. I-check. I-verify.','Alam kung kanino ang tools.','Mas klaro ang araw sa site.'],B:['Mula shopping list hanggang receiving.','Alam kung ano ang uunahin.','Klaro kung sino ang bibili.','I-record ang actual na binili.','Bought six. Four to go.','Isang receipt. Tamang allocation.','May pagbabago? May dahilan.','Purchase at payment. Hiwalay.','Bilangin. I-check. I-confirm.','Draft muna. Sync kapag online.','Kita ang materials, bawat location.','Mas malinaw ang bawat bili.'],D:['Mula office hanggang site.','Tamang access sa bawat role.','Bawat project, malinaw ang picture.','Tatlong cost buckets. Isang total.','Traceable ang bawat expense.','Progress ang basehan.','Mula billing hanggang payment.','Hiwalay ang tamang records.','Project Management. Sariling workflow.','Site updates na nababalikan.','Maayos hanggang closeout.','Proposal muna. Project kapag ready.','Kita ang araw sa site.','Organized ang requests at receipts.','WorkMate, connected sa office.','Mula meeting notes sa malinaw na tasks.','Sariling view para sa bawat client.','Mula inquiry hanggang feedback.','Records na puwedeng balikan.','Mas malinaw. Mas maayos.']};
for(const prefix of Object.keys(names)){
 const rows=[...spec.matchAll(/^\| ([WBD]\d{2}) \/ (\d+) \| (.*?) \| (.*?) \|$/gm)].filter(m=>m[1][0]===prefix);
 const expected=prefix==='D'?20:12;if(rows.length!==expected)throw new Error(`Bad count ${prefix}`);
 const scenes=rows.map((m,i)=>{
  const id=m[1];if(id!==prefix+String(i+1).padStart(2,'0'))throw new Error(`Out of order ${id}`);
  let label=prefix==='D'?'SAMPLE DATA':'PRODUCT PREVIEW · SAMPLE DATA';
  if(['W08','W11','B11','D15'].includes(id))label='PLANNED MODULE';
  if(['W09','W10','D16'].includes(id))label='DESIGN PREVIEW';
  return {id,title:titles[prefix][i],role:prefix==='W'?(id==='W06'?'leader':'worker'):prefix==='B'?'buyer':'owner',label,narration:m[4],spokenText:m[4].replaceAll('DAC’S','Daks').replaceAll('BOQ','B O Q'),minimumSeconds:Number(m[2]),visualKey:id,direction:m[3]};
 });fs.writeFileSync(`content/${names[prefix]}.json`,JSON.stringify(scenes,null,2)+'\n');console.log(names[prefix],scenes.length);
}
