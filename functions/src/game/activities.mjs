import {sceneStops} from "./worlds.mjs";
export const PALETTE_NAMES=["Forest teal","Terracotta","Lavender","Rosewood","Meadow","Ocean blue","Lagoon","Golden sand","Heather","Pine","Sea glass","Clay","Wisteria","Olive","Sunset","Midnight blue"];
export const PALETTE_COLORS=["#16776A","#A35C39","#7456AC","#AC526E","#547238","#3F6FA0","#367B96","#946B2E","#8C5B7B","#3A7555","#417B83","#9E6040","#7C65A0","#657D43","#9F5528","#385677"];
export const PERSONAL_ART_LICENCE="For your own phone or computer wallpaper only. No resale, redistribution, commercial use or removal of the GridRova watermark. GridRova branding and layout © 2026. Artwork supplied under this personal-use licence.";
export function completedIds(s){return new Set((s.completed||[]).filter(n=>Number.isInteger(n)&&n>=1&&n<=300));}
export function prefixComplete(s,last){const ids=completedIds(s);for(let n=1;n<=last;n++)if(!ids.has(n))return false;return true;}
export function album(s){const ids=completedIds(s);return sceneStops.map((scene,index)=>({...scene,index,earned:Array.from({length:10},(_,i)=>index*10+i+1).every(n=>ids.has(n)),completed:Array.from({length:10},(_,i)=>index*10+i+1).filter(n=>ids.has(n)).length}));}
export function canExportWallpaper(s,index){return Number.isInteger(index)&&index>=0&&index<30&&prefixComplete(s,150)&&album(s)[index].earned;}
export function weekKey(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date||""))return null;const d=new Date(date+"T12:00:00Z");if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==date)return null;d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
export function missions(s,date){const week=weekKey(date);if(!week)return [];const day=s.activityDays?.[date]||{},weekly=s.activityWeeks?.[week]||{};return [
 {id:"daily-puzzles",period:date,label:"A little exploring",detail:"Finish 3 fresh puzzles",value:day.puzzles||0,goal:3,coins:20},
 {id:"daily-bonus",period:date,label:"Hidden discoveries",detail:"Find 5 new bonus words",value:day.bonus||0,goal:5,coins:15},
 {id:"daily-independent",period:date,label:"Your own way",detail:"Finish one fresh puzzle without hints",value:day.independent||0,goal:1,coins:15},
 {id:"weekly-puzzles",period:week,label:"A week of wandering",detail:"Finish 10 fresh puzzles this week",value:weekly.puzzles||0,goal:10,coins:75},
 {id:"weekly-bonus",period:week,label:"A curious week",detail:"Find 20 new bonus words this week",value:weekly.bonus||0,goal:20,coins:50}
 ].map(m=>({...m,claimed:!!s.ledger?.[`mission:${m.period}:${m.id}`],ready:m.value>=m.goal}));}
export function recordActivity(s,date,key,values){const week=weekKey(date);if(!week||s.ledger[`activity:${key}`])return;s.ledger[`activity:${key}`]=true;s.activityDays??={};s.activityWeeks??={};for(const [map,period] of [[s.activityDays,date],[s.activityWeeks,week]]){map[period]??={puzzles:0,bonus:0,independent:0};for(const [field,value] of Object.entries(values))map[period][field]=(map[period][field]||0)+value;}}
export function expedition(s,date){const week=weekKey(date);const record=s.expeditions?.[week]||{completed:[]};return {week,completed:record.completed||[],finished:record.completed?.length===5,keepsake:!!record.keepsake};}
export function localInsights(s){const events=s.events||[];const completed=events.filter(e=>e.type==="completion");const starts=events.filter(e=>e.type==="level_start");const stalled=events.filter(e=>e.type==="selection_miss").reduce((a,e)=>(a[e.id]=(a[e.id]||0)+1,a),{});return {starts:starts.length,finishes:completed.length,assisted:completed.filter(e=>e.help>0).length,activeDays:Object.keys(s.activityDays||{}).length,stalledLevels:Object.entries(stalled).sort((a,b)=>b[1]-a[1]).slice(0,5),note:"Device-only activity sample; not a global retention report."};}
