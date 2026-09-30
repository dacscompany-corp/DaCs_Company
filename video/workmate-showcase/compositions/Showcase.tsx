import React from 'react';
import {AbsoluteFill,Html5Audio,Img,Sequence,interpolate,spring,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
import {C,Icon,Badge,Reveal,Tap} from './ui';
import {PhoneContent} from './phone-scenes';
import {WebContent} from './web-scenes';
import {beats} from './beats';
import type {Timed,Video} from './types';
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;

function Phone({id,p}:{id:string;p:number}){const f=useCurrentFrame();return <div style={{width:490,height:852,padding:12,boxSizing:'border-box',borderRadius:49,background:'#232B22',boxShadow:'16px 28px 55px #183C2525',transform:`rotate(${interpolate(f,[0,35],[-3,0],clamp)}deg)`}}><div style={{height:'100%',borderRadius:37,background:'#F5F6F0',overflow:'hidden',position:'relative'}}><div style={{height:41,padding:'12px 26px 0',boxSizing:'border-box',display:'flex',justifyContent:'space-between',fontSize:15,fontWeight:700}}><span>9:41</span><div style={{width:100,height:21,background:'#232B22',borderRadius:14,position:'absolute',left:183,top:8}}/><span>● ▰</span></div><div style={{padding:'20px 25px 0',height:691,boxSizing:'border-box',overflow:'hidden'}}><PhoneContent id={id} p={p}/></div><div style={{position:'absolute',bottom:0,height:74,left:0,right:0,display:'flex',justifyContent:'space-around',alignItems:'center',background:'white',borderTop:`1px solid ${C.line}`}}>{(id[0]==='B'?[['cart','Buy'],['note','Receipts'],['person','Profile']]:[['home','Home'],['box','Requests'],['note','Work'],['clock','History'],['person','Profile']]).map(([icon,label],i)=><div key={label} style={{display:'grid',justifyItems:'center',gap:5,color:i===(id[0]==='B'?0:['W09','W10'].includes(id)?2:['W04','W05','W06','W07','W08'].includes(id)?1:0)?C.green:'#92998E'}}><Icon name={icon} size={23}/><span style={{fontSize:14,fontWeight:600}}>{label}</span></div>)}</div></div></div>}

const navFor=(id:string)=>{const n=Number(id.slice(1));return n<=2?'Users':n<=8?'Project Control':n<=11?'Project Management':n===12?'Quotations':n===13?'Attendance':n===14||n===15?'Construction':n===18?'Appointments':'Project Control'};
function Desktop({id,p}:{id:string;p:number}){return <div style={{width:1450,height:686,borderRadius:22,border:'1.5px solid #CBD3C6',overflow:'hidden',background:'#F6F7F3',boxShadow:'0 22px 45px #25412D18'}}><div style={{height:46,background:'#E4E8DF',display:'flex',alignItems:'center',gap:8,padding:'0 20px'}}>{['#AEB8A5','#BAC2B1','#C7CEBE'].map(c=><span key={c} style={{width:10,height:10,borderRadius:10,background:c}}/>)}<div style={{fontSize:15,color:'#63715B',textAlign:'center',flex:1,fontFamily:'Mono'}}>DAC’S Web · Sample workspace</div><Icon name="home" size={18}/></div><div style={{height:67,display:'flex',gap:7,padding:'0 24px',alignItems:'center',background:'#fff',borderBottom:`1px solid ${C.line}`}}><Img src={staticFile('brand/dacs_logo.png')} style={{width:39,height:39,objectFit:'contain',marginRight:20}}/>{['Project Control','Project Management','Attendance','Quotations','Construction','Users'].map(n=><div key={n} style={{fontSize:18,fontWeight:600,padding:'12px 14px',borderRadius:9,background:navFor(id)===n?'#E9F0E3':'transparent',color:navFor(id)===n?C.green:C.muted}}>{n}</div>)}<div style={{marginLeft:'auto'}}><Badge tone="muted">{id==='D02'&&p>0?'Staff view':'Owner view'}</Badge></div></div><div style={{padding:'27px 31px',height:572,boxSizing:'border-box',overflow:'hidden'}}><WebContent id={id} p={p}/></div></div>}

function Captions({timed}:{timed:Timed}){const f=useCurrentFrame();const ms=(f-timed.narrationStartFrame)/30*1000;const c=timed.media.captions.find(x=>ms>=x.startMs&&ms<x.endMs);if(!c)return null;return <div style={{position:'absolute',left:160,right:160,bottom:36,display:'flex',justifyContent:'center'}}><div style={{background:'#173F2C',color:'#FFF',fontSize:30,lineHeight:1.3,fontWeight:600,textAlign:'center',padding:'13px 28px',borderRadius:12,maxWidth:1430,boxShadow:'0 4px 15px #0000000A'}}>{c.text}</div></div>}

function Scene({timed,video,index}:{timed:Timed;video:Video;index:number}){
 const f=useCurrentFrame();const {fps}=useVideoConfig();const web=video.key==='web';const scene=timed.scene;
 const elapsed=Math.max(0,f-15);const speechFrames=timed.media.audioSeconds*fps;
 const p=Math.min(2,Math.floor(elapsed/Math.max(1,speechFrames/3)));
 const entrance=spring({frame:f,fps,config:{damping:28,stiffness:115}});
 const out=interpolate(f,[timed.durationInFrames-10,timed.durationInFrames],[1,0],clamp);
 const intro=index===0;const outro=index===video.scenes.length-1;
 const words=beats[scene.id];const taps=[Math.round(15+speechFrames/3),Math.round(15+speechFrames*2/3)];
 return <AbsoluteFill style={{background:C.cream,fontFamily:'Barlow',color:C.ink,overflow:'hidden'}}>
  <div style={{position:'absolute',top:0,right:0,bottom:0,width:web?300:760,background:outro?C.deep:'#E4EBDC'}}/>
  <svg style={{position:'absolute',right:0,top:0,width:780,height:1080,opacity:.2}}><defs><pattern id="grid" width="70" height="70" patternUnits="userSpaceOnUse"><path d="M70 0H0v70" fill="none" stroke="#94AB81" strokeWidth="1"/></pattern></defs><rect width="100%" height="100%" fill="url(#grid)"/></svg>
  <div style={{position:'absolute',left:78,right:78,top:40,display:'flex',alignItems:'center',gap:15}}><Img src={staticFile('brand/dacs_logo.png')} style={{width:51,height:51,objectFit:'contain'}}/><div style={{fontWeight:800,fontSize:25}}>DAC’S <span style={{fontWeight:400}}>{web?'Web':'WorkMate'}</span></div><div style={{marginLeft:24,color:C.muted,fontSize:19}}>{video.subtitle}</div><div style={{marginLeft:'auto',fontFamily:'Mono',fontSize:15,letterSpacing:.6,color:outro?'#E0EBCF':C.muted}}>{scene.label}</div></div>
  <div style={{opacity:out,transform:`translateY(${(1-entrance)*24}px)`}}>
   {web?<>
    <div style={{position:'absolute',left:80,top:130,width:1710,fontSize:58,fontWeight:800,lineHeight:1.06}}>{scene.title}</div>
    <div style={{position:'absolute',left:80,top:300,width:245}}><div style={{fontFamily:'Mono',fontSize:16,color:C.muted,marginBottom:24}}>Inside DAC’S Web</div>{words.map((w,i)=><div key={w} style={{padding:'21px 0',borderBottom:`1px solid ${C.line}`,fontSize:24,lineHeight:1.25,fontWeight:i===p?700:400,color:i===p?C.green:'#8B9586',opacity:i<=p?1:.55}}>{w}</div>)}</div>
    <div style={{position:'absolute',left:380,top:230}}><Desktop id={scene.id} p={p}/><Tap x={1110} y={520} frame={taps[0]}/><Tap x={1130} y={535} frame={taps[1]}/></div>
   </>:<>
    <div style={{position:'absolute',left:112,top:190,width:855}}>
     <Reveal><div style={{fontFamily:'Mono',fontSize:18,color:C.green,marginBottom:24}}>{scene.role==='leader'?'Team leader workflow':video.key==='buying'?'Procurement workspace':'Worker workspace'}</div><div style={{fontSize:intro?112:78,lineHeight:1.015,fontWeight:800,letterSpacing:-2.8,maxWidth:840}}>{intro?<>DAC’S<br/>WorkMate.</>:scene.title}</div>{intro&&<div style={{fontSize:35,color:C.green,marginTop:24,fontWeight:600}}>{video.subtitle}</div>}</Reveal>
     <div style={{marginTop:45,width:705}}>{words.map((w,i)=><div key={w} style={{display:'flex',alignItems:'center',gap:18,padding:'20px 0',borderBottom:`1px solid ${C.line}`,opacity:i<=p?1:.35,color:i===p?C.green:C.ink}}><div style={{width:30,height:30,borderRadius:'50%',background:i<p?C.green:i===p?'#D4E7BC':'transparent',border:`1px solid ${i<=p?C.green:'#9EA997'}`,display:'grid',placeItems:'center',color:'white',flexShrink:0}}>{i<p?<Icon size={18}/>:<span style={{fontFamily:'Mono',fontSize:14,color:C.green}}>{i+1}</span>}</div><span style={{fontSize:29,fontWeight:i===p?700:400}}>{w}</span></div>)}</div>
    </div>
    <div style={{position:'absolute',left:1220,top:105,transform:`translateX(${(1-entrance)*70}px)`}}><Phone id={scene.id} p={p}/>{taps.map((t,i)=><Tap key={t} x={365} y={i?627:545} frame={t}/>)}</div>
   </>}
  </div>
  <div style={{position:'absolute',left:80,bottom:20,fontFamily:'Mono',fontSize:13,color:C.muted}}>{String(index+1).padStart(2,'0')} / {video.scenes.length}</div>
  <div style={{position:'absolute',left:0,right:0,bottom:0,height:4,background:'#DFE6D6'}}><div style={{height:4,background:C.green,width:`${(timed.from+f)/video.durationInFrames*100}%`}}/></div>
  <Captions timed={timed}/>
  <Sequence from={timed.narrationStartFrame}><Html5Audio src={staticFile(timed.media.audioPath)} volume={1}/></Sequence>
  <Html5Audio src={staticFile('audio/whoosh.wav')} volume={.12}/>
  {taps.map((t,i)=><Sequence from={t} key={t}><Html5Audio src={staticFile(`audio/${i?'confirm':'tap'}.wav`)} volume={.19}/></Sequence>)}
 </AbsoluteFill>
}
export function Showcase({video}:{video:Video}){return <AbsoluteFill>{video.scenes.map((timed,index)=><Sequence from={timed.from} durationInFrames={timed.durationInFrames} key={timed.scene.id} name={timed.scene.id}><Scene timed={timed} video={video} index={index}/></Sequence>)}</AbsoluteFill>}
