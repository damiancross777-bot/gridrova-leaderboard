// Phone-playtest baseline. Keep accessibility contrast independent of word colours.
export const AUDIO_MIX = Object.freeze({music:1,effects:0.3});
export const SOLVED_COLORS = Object.freeze([
  "#83B7F2","#F3BE6C","#BA9BE4","#79CBB2","#E99FB6","#B6CC7A","#79C9DE",
  "#DAA278","#9FADE5","#DBB3DC","#E6CF72","#8AC8A0","#A2CBD4","#D5AF8A",
]);
export function solvedWordColor(targetIndex){return SOLVED_COLORS[targetIndex%SOLVED_COLORS.length];}
export function readableTextStyle(style={}){
  const fontSize=Math.max(18,style.fontSize??20);
  return {...style,fontSize,lineHeight:Math.max(style.lineHeight??0,Math.ceil(fontSize*1.4))};
}
// Revised art-first default. Apply once, then preserve explicit contrast choices.
export function upgradeReadability(state){
  if(state.readabilityVersion>=2)return state;
  return {...state,readabilityVersion:2,settings:{...state.settings,contrast:false}};
}

export function wordTileColors(pastel="#DFEED6",found=false){
  const channels=pastel.slice(1).match(/../g).map(n=>parseInt(n,16)/255);
  const [r,g,b]=channels,max=Math.max(...channels),min=Math.min(...channels),delta=max-min;
  let hue=delta===0?100:max===r?60*(((g-b)/delta)%6):max===g?60*((b-r)/delta+2):60*((r-g)/delta+4);
  hue=(hue+360)%360;
  const hex=(s,l)=>{
    const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((hue/60)%2-1)),m=l-c/2;
    const rgb=hue<60?[c,x,0]:hue<120?[x,c,0]:hue<180?[0,c,x]:hue<240?[0,x,c]:hue<300?[x,0,c]:[c,0,x];
    return "#"+rgb.map(n=>Math.round((n+m)*255).toString(16).padStart(2,"0")).join("");
  };
  return {top:hex(.25,found ? .27 : .30),bottom:hex(.3,found?.15:.19),edge:found?"#C5B68B":hex(.25,.57),shadow:hex(.25,.1)};
}
