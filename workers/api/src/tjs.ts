// The per tenant first party tracking script, served at GET /t.js on the
// tenant hostname and /t/{slug}.js on the agency host. The slug and the
// ingest origin are injected at serve time. Under 6 KB minified, no
// dependencies, async safe.

export interface TjsConfig {
  slug: string;
  origin: string;
  formSelector: string;
}

export function buildTrackingScript(cfg: TjsConfig): string {
  const config = JSON.stringify({ s: cfg.slug, o: cfg.origin, f: cfg.formSelector });
  // prettier-ignore
  return `(function(){var C=${config};
var D=document,W=window,N=navigator;
function rnd(){var a=new Uint8Array(16);crypto.getRandomValues(a);var s='';for(var i=0;i<16;i++)s+=('0'+a[i].toString(16)).slice(-2);return s}
function gc(n){var m=D.cookie.match('(^|;)\\\\s*'+n+'=([^;]*)');return m?decodeURIComponent(m[2]):null}
function sc(n,v){var d=new Date(Date.now()+341*864e5);D.cookie=n+'='+encodeURIComponent(v)+'; expires='+d.toUTCString()+'; path=/; SameSite=Lax'}
function ls(k,v){try{if(v===undefined)return W.localStorage.getItem(k);W.localStorage.setItem(k,v)}catch(e){return null}}
var vid=gc('_lbi_vid')||ls('_lbi_vid');
if(!vid){vid=rnd()}
sc('_lbi_vid',vid);ls('_lbi_vid',vid);
function qp(n){var m=W.location.search.match('[?&]'+n+'=([^&]*)');return m?decodeURIComponent(m[1].replace(/\\+/g,' ')):null}
var FT='_lbi_ft';
if(!ls(FT)){var ft={u:W.location.href,r:D.referrer||null,us:qp('utm_source'),um:qp('utm_medium'),uc:qp('utm_campaign'),ut:qp('utm_term'),uo:qp('utm_content'),g:qp('gclid'),f:qp('fbclid'),w:qp('wbraid'),m:qp('msclkid'),t:new Date().toISOString()};ls(FT,JSON.stringify(ft))}
var Q=[],T=null;
function flush(){if(!Q.length)return;var b=JSON.stringify({vid:vid,ft:JSON.parse(ls(FT)||'null'),ev:Q.splice(0,Q.length)});
if(N.sendBeacon){N.sendBeacon(C.o+'/ingest/'+C.s+'/pixel',new Blob([b],{type:'text/plain'}))}else{fetch(C.o+'/ingest/'+C.s+'/pixel',{method:'POST',body:b,keepalive:true,headers:{'content-type':'text/plain'}})}}
function send(e){e.t=e.t||new Date().toISOString();e.u=W.location.href;Q.push(e);clearTimeout(T);T=setTimeout(flush,2000)}
W.addEventListener('pagehide',flush);D.addEventListener('visibilitychange',function(){if(D.visibilityState==='hidden')flush()});
function pv(){send({k:'page_view',r:D.referrer||null})}
pv();
var hp=history.pushState;history.pushState=function(){hp.apply(history,arguments);pv()};
W.addEventListener('popstate',pv);
var SKIP=/password|card|cc-num|cc-csc|cvc|cvv|ssn|social/i;
function safe(el){if(!el.name&&!el.id)return false;if(el.type==='password'||el.type==='hidden')return false;
if(SKIP.test(el.name||'')||SKIP.test(el.autocomplete||'')||SKIP.test(el.id||''))return false;return true}
function fields(f){var o={},els=f.querySelectorAll('input,select,textarea');for(var i=0;i<els.length;i++){var el=els[i];if(safe(el)&&el.value)o[el.name||el.id]=el.value}return o}
function fid(f){if(!f._lbiId)f._lbiId=rnd();return f._lbiId}
var pt=null;
D.addEventListener('blur',function(ev){var el=ev.target;if(!el||!el.form)return;var f=el.form;if(!f.matches(C.f))return;
clearTimeout(pt);pt=setTimeout(function(){send({k:'form_partial',fi:fid(f),fd:fields(f)})},1500)},true);
D.addEventListener('submit',function(ev){var f=ev.target;if(!f.matches||!f.matches(C.f))return;
clearTimeout(pt);send({k:'form_submit',fi:fid(f),fd:fields(f)});flush()},true);
W.lbi={identify:function(p){send({k:'identify',fd:{email:p&&p.email,phone:p&&p.phone}});flush()}};
})();`;
}
