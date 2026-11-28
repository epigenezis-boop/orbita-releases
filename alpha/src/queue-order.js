'use strict';
(function(root){
 function moved(i,from,to){if(i===from)return to;if(from<to&&i>from&&i<=to)return i-1;if(from>to&&i>=to&&i<from)return i+1;return i;}
 class QueueOrder{
  constructor(){this.history=[];this.cursor=-1;this.priority=[];}
  reset(){this.history=[];this.cursor=-1;this.priority=[];}
  visit(i){this.priority=this.priority.filter(n=>n!==i);if(this.history[this.cursor]===i)return i;this.history.splice(this.cursor+1);this.history.push(i);if(this.history.length>10000)this.history.shift();this.cursor=this.history.length-1;return i;}
  back(){if(this.cursor>0)return this.history[--this.cursor];return this.history[0]??-1;}
  forward(current,length,shuffle,repeat,manual=false,random=Math.random){if(this.cursor+1<this.history.length)return this.history[++this.cursor];if(!length)return -1;if(this.priority.length)return this.visit(this.priority.shift());let i=current+1;if(current<0)i=0;else if(shuffle&&length>1){i=Math.floor(random()*(length-1));if(i>=current)i++;}else if(i>=length)i=repeat||manual?0:-1;return i>=0?this.visit(i):-1;}
  remap(map){let cursor=-1;this.history=this.history.flatMap((i,n)=>{const j=map(i);if(j<0)return [];if(n<=this.cursor)cursor++;return [j];});this.cursor=cursor;this.priority=this.priority.map(map).filter(i=>i>=0);}
  schedule(at){this.history.splice(this.cursor+1);this.priority.unshift(at);}
  insert(at){this.remap(i=>i>=at?i+1:i);}
  remove(at){this.remap(i=>i===at?-1:i>at?i-1:i);}
  move(from,to){this.remap(i=>moved(i,from,to));}
  trim(last){this.remap(i=>i<=last?i:-1);}
  restore(history,cursor,length,priority=[]){this.priority=Array.isArray(priority)?priority:[];const raw=Array.isArray(history)?history.slice(-10000):[];this.history=raw;this.cursor=Number.isInteger(cursor)?Math.min(cursor,raw.length-1):-1;this.remap(i=>Number.isInteger(i)&&i>=0&&i<length?i:-1);}
 }
 if(typeof module!=='undefined')module.exports={QueueOrder,moved};else{root.QueueOrder=QueueOrder;root.queueMovedIndex=moved;}
})(globalThis);
