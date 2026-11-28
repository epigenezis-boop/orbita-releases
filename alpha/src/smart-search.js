(function(root){
'use strict';
const clean=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const compact=s=>clean(s).replace(/ /g,'');
const ru='йцукенгшщзхъфывапролджэячсмитьбю',en="qwertyuiop[]asdfghjkl;'zxcvbnm,.";
function keyboard(s){return [...s.toLowerCase()].map(c=>ru.includes(c)?en[ru.indexOf(c)]:en.includes(c)?ru[en.indexOf(c)]:c).join('');}
const translit={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
const latin=s=>[...clean(s)].map(c=>translit[c]??c).join('');
function distance(a,b){if(Math.abs(a.length-b.length)>2)return 3;let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]!==b[j-1]));prev=row;}return prev[b.length];}
function score(text,q){const h=clean(text),n=clean(q);if(!n)return 1;if(h.includes(n))return 100;if(compact(h).includes(compact(n)))return 90;const words=h.split(' ');let total=0;for(const token of n.split(' ')){if(h.includes(token)){total+=10;continue;}const limit=token.length>=8?2:token.length>=4?1:0;if(!limit||!words.some(w=>distance(w,token)<=limit))return 0;total+=4;}return total;}
function fieldScore(text,q){const direct=score(text,q);if(direct>=90)return direct;return Math.max(direct,score(text,keyboard(q))*.85,score(latin(text),latin(q))*.9);}
function trackScore(t,q){if(!clean(q))return 1;const combined=fieldScore([t.title,t.artist,t.album,t.fileName].filter(Boolean).join(' '),q);if(!combined)return 0;const artist=fieldScore(t.artist,q),title=fieldScore(t.title,q);return combined+(artist>0?1000+artist:title>0?500+title:0);}

function rank(rows,q,keepUnmatched=false){return rows.map((t,i)=>({t,i,s:trackScore(t,q)})).filter(x=>keepUnmatched||x.s>0).sort((a,b)=>b.s-a.s||a.i-b.i).map(x=>x.t);}
function variants(q,rows=[]){const n=clean(q),vocab=new Set(('the a an of to in on and or for my me your you i we all be is it this that with without from nothing else matters turn page back black love night wish metallica').split(' '));for(const t of rows)for(const w of clean([t.title,t.artist].join(' ')).split(' '))if(w.length>1)vocab.add(w);
function split(word){if(word.length<5||word.length>80||vocab.has(word))return word;const dp=Array(word.length+1).fill(null);dp[0]=[];for(let i=0;i<word.length;i++)if(dp[i])for(let j=word.length;j>i;j--){const w=word.slice(i,j);if(vocab.has(w)&&(!dp[j]||dp[j].length>dp[i].length+1))dp[j]=[...dp[i],w];}return dp[word.length]?.join(' ')||word;}
const spaced=n.split(' ').map(split).join(' ');return [...new Set([q.trim(),spaced,keyboard(n),latin(n),compact(n)])].filter(Boolean).slice(0,4);}
const api={clean,compact,keyboard,latin,score,trackScore,rank,variants};if(typeof module==='object')module.exports=api;else root.OrbitaSearch=api;
})(globalThis);
