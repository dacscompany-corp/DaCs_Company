import asyncio, hashlib, json, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.python-packages'))
import edge_tts
from mutagen.mp3 import MP3
VOICE='fil-PH-AngeloNeural'

def captions(words):
    result=[]; group=[]
    for word in words:
        group.append(word)
        text=' '.join(w['text'] for w in group).replace('Daks','DAC’S')
        if len(text)>=60 or len(group)>=9 or word['text'].endswith(('.', '?', '!')):
            result.append({'startMs':group[0]['offset']/10000,'endMs':(group[-1]['offset']+group[-1]['duration'])/10000,'text':text});group=[]
    if group:result.append({'startMs':group[0]['offset']/10000,'endMs':(group[-1]['offset']+group[-1]['duration'])/10000,'text':' '.join(w['text'] for w in group).replace('Daks','DAC’S')})
    return result

async def generate(scene):
    folder=ROOT/'public/audio/voice';folder.mkdir(parents=True,exist_ok=True)
    dest=folder/(scene['id']+'.mp3');meta=folder/(scene['id']+'.json')
    digest=hashlib.sha256((VOICE+'+0%'+scene['spokenText']).encode()).hexdigest()
    if meta.exists() and dest.exists():
        data=json.loads(meta.read_text('utf8'))
        if data.get('hash')==digest and MP3(dest).info.length>0:return data
    for attempt in range(3):
        try:
            temp=dest.with_suffix('.partial');words=[]
            stream=edge_tts.Communicate(scene['spokenText'],VOICE,rate='+0%',boundary='WordBoundary')
            with temp.open('wb') as audio:
                async for chunk in stream.stream():
                    if chunk['type']=='audio':audio.write(chunk['data'])
                    elif chunk['type']=='WordBoundary':words.append(chunk)
            duration=MP3(temp).info.length
            caps=captions(words)
            if not caps or duration<=0:raise ValueError('Empty narration or timing')
            data={'sceneId':scene['id'],'audioPath':f"audio/voice/{scene['id']}.mp3",'audioSeconds':duration,'captions':caps,'voice':VOICE,'hash':digest}
            temp.replace(dest);meta.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
            print(f"{scene['id']}: {duration:.2f}s, {len(caps)} captions",flush=True);return data
        except Exception as e:
            print(f"{scene['id']} attempt {attempt+1}: {type(e).__name__}: {e}",flush=True)
            if attempt==2:raise
            await asyncio.sleep(2)

async def main():
    requested=set(sys.argv[1:]); scenes=[]
    for name in ['workers','buying','web']:scenes.extend(json.loads((ROOT/f'content/{name}.json').read_text('utf8')))
    voices=await edge_tts.list_voices()
    if not any(v['ShortName']==VOICE for v in voices):raise RuntimeError(f'{VOICE} unavailable')
    print('Verified voice:',VOICE,flush=True)
    for scene in scenes:
        if not requested or scene['id'] in requested:await generate(scene)
    if not requested:
        manifest={s['id']:json.loads((ROOT/f"public/audio/voice/{s['id']}.json").read_text('utf8')) for s in scenes}
        (ROOT/'content/media-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
asyncio.run(main())
