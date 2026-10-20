import {unpack,pack} from "./storage.mjs";
import {validateBoard} from "./core.mjs";
export function readBackup(raw){
 if(typeof raw!=="string"||raw.length>2500000)throw Error("Choose a GridRova backup smaller than 2.5 MB.");
 const s=unpack(raw);
 if(!s||!Number.isSafeInteger(s.coins)||s.coins>1000000000||new Set(s.completed).size!==s.completed.length||s.completed.some(id=>!Number.isInteger(id)||id<1||id>300)||!Array.isArray(s.notebook)||!Array.isArray(s.palettes)||!Array.isArray(s.events)||!s.medals||!s.best||!Array.isArray(s.dailyRewards))throw Error("This backup is not valid. Your current progress has not changed.");
 if(s.palettes.some(n=>!Number.isInteger(n)||n<0||n>15)||!s.palettes.includes(s.settings.palette)||s.settings.grid!==undefined&&!["light","heavy","none"].includes(s.settings.grid))throw Error("The backup settings are invalid. Your current progress has not changed.");
 if(s.settings.volume !== undefined && (!Number.isFinite(s.settings.volume)||s.settings.volume<0||s.settings.volume>1))throw Error("The backup volume is invalid. Your current progress has not changed.");
 if(s.active){const a=s.active;if(!a.board||validateBoard(a.board).length||!Array.isArray(a.found)||new Set(a.found).size!==a.found.length||a.found.some(w=>!a.board.targets.some(t=>t.word===w))||!Array.isArray(a.help)||!Array.isArray(a.bonuses))throw Error("The saved puzzle could not be verified. Your current progress has not changed.");}
 return s;
}
export function cloudBackup(state){const copy=JSON.parse(JSON.stringify(state));copy.events=[];const raw=pack(copy);if(raw.length>600000)throw Error("This save is too large for cloud backup. Export a backup file instead.");return raw;}
export function backupSummary(s){return {levels:s.completed.length,coins:s.coins,hasPuzzle:!!s.active&&!s.active.completed};}
