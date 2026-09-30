import React from 'react';
import {Composition,staticFile} from 'remotion';
import {loadFont} from '@remotion/fonts';
import videos from '../content/timelines.json';
import {Showcase} from './Showcase';
import type {Video} from './types';
for(const [file,weight] of [['barlow_regular.ttf','400'],['barlow_semibold.ttf','600'],['barlow_bold.ttf','700'],['barlow_extrabold.ttf','800']])loadFont({family:'Barlow',url:staticFile('brand/'+file),weight});
loadFont({family:'Mono',url:staticFile('brand/ibm_plex_mono_regular.ttf'),weight:'400'});
export const Root=()=> <>{(videos as Video[]).map(video=><Composition key={video.id} id={video.id} component={Showcase} durationInFrames={video.durationInFrames} width={1920} height={1080} fps={30} defaultProps={{video}}/>)}</>;
