/**
 * PLAUD AI QUICK INJECT - Paste this into browser console
 *
 * This is a minified version of the telemetry client for quick testing.
 * Open http://100.75.237.36:8001/index.html, press F12, paste this in Console.
 */

(function(){const C={source:'plaud-ai-uploader',server:'http://localhost:3000',debug:true};
function genId(){return'plaud_'+Date.now()+'_'+Math.random().toString(36).substr(2,6)}
function emit(stage,action,data={},ok=true){const e={source:C.source,stage,action,success:ok,timestamp:new Date().toISOString(),correlationId:data.correlationId||genId(),data};
if(C.debug)console.log('[Plaud]',stage,action,e);
window.dispatchEvent(new CustomEvent('OBSERVER_TELEMETRY',{detail:e}));
fetch(C.server+'/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(e)}).catch(()=>{});}
const oFetch=window.fetch;window.fetch=async function(url,opts={}){const t=Date.now(),m=opts.method||'GET',cid=genId();
const u=new URL(url,location.origin),ep=u.pathname;emit('api',m+'_REQUEST',{endpoint:ep,correlationId:cid});
try{const r=await oFetch.call(this,url,opts),d=Date.now()-t;
let st='api',ac=m+'_'+ep.replace(/\//g,'_').toUpperCase(),ev={endpoint:ep,status:r.status,ms:d,correlationId:cid};
if(ep==='/upload'){st='upload';ac='TRANSCRIPT_SUBMITTED';try{const j=await r.clone().json();ev.patientId=j.patientId;ev.recordId=j.recordId;ev.confidence=j.confidence}catch(e){}}
else if(ep==='/patients'){st='query';ac='PATIENTS_LOADED';try{const j=await r.clone().json();ev.count=Array.isArray(j)?j.length:0}catch(e){}}
else if(ep.startsWith('/records/')){st='query';ac='RECORDS_RETRIEVED';ev.mrn=ep.split('/')[2]}
emit(st,ac,ev,r.ok);return r}catch(e){emit('api','REQUEST_FAILED',{endpoint:ep,error:e.message,correlationId:cid},false);throw e}};
document.addEventListener('click',e=>{const t=e.target.closest('[data-tab],.tab,[role="tab"]');if(t)emit('nav','TAB_CLICK',{tab:t.textContent?.trim()})});
document.addEventListener('submit',e=>{const f=e.target;emit('form','SUBMIT',{formId:f.id||'form',fields:Array.from(f.elements).filter(x=>x.name).map(x=>x.name)})});
emit('system','TELEMETRY_ACTIVE',{url:location.href});
window.PlaudTelemetry={emit,config:C};
console.log('%c[Plaud Telemetry] Active - sending to Observer','color:green;font-weight:bold');
})();
