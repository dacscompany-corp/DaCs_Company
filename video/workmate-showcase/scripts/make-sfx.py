import math,random,struct,wave
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'public/audio'
random.seed(24)
for name,duration in [('tap',.13),('confirm',.38),('whoosh',.5)]:
    samples=[]; rate=48000
    for i in range(int(duration*rate)):
        t=i/rate;p=t/duration
        if name=='tap':v=math.sin(2*math.pi*920*t)*math.exp(-42*t)*.45
        elif name=='confirm':v=(math.sin(2*math.pi*660*t)+math.sin(2*math.pi*880*t))*.2*math.sin(math.pi*p)*math.exp(-3*p)
        else:v=random.uniform(-1,1)*math.sin(math.pi*p)**3*.25
        samples.append(struct.pack('<h',round(v*32767)))
    with wave.open(str(root/(name+'.wav')),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes(b''.join(samples))
print('Generated three original WAV effects')
