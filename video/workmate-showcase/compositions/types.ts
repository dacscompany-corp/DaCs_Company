export type Scene={id:string;title:string;role:string;label:string;narration:string;spokenText:string;minimumSeconds:number;visualKey:string;direction:string};
export type Timed={scene:Scene;media:{audioPath:string;audioSeconds:number;captions:{startMs:number;endMs:number;text:string}[]};from:number;durationInFrames:number;narrationStartFrame:number};
export type Video={key:string;id:string;file:string;subtitle:string;scenes:Timed[];durationInFrames:number};
