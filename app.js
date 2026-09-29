/* MSR · HCE Control — static PWA for GitHub Pages */
(() => {
  "use strict";

  const STORAGE_KEY = "msr_hce_control_v1";
  const ADMIN_UNDO_KEY = "msr_hce_admin_undo_v1";
  const CLOUD_CONFLICT_KEY = "msr_hce_cloud_conflict_v1";
  const DEVICE_ID_KEY = "msr_hce_device_id_v1";
  const DEVICE_ID = (() => {
    let id=localStorage.getItem(DEVICE_ID_KEY);
    if(!id){
      id=(crypto.randomUUID?.()||`dev_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(DEVICE_ID_KEY,id);
    }
    return id;
  })();
  const VERSION = 1;
  const defaultData = () => ({
    version: VERSION,
    msr: [],
    states: {},
    hce: [],
    meta: { updatedAt: null, msrImportedAt: null, hceImportedAt: null, lastImportReport: null, importHistory: [], auditLog: [], trash: [], errorLog: [] }
  });

  let db = load();
  let page = "inicio";
  let deferredInstall = null;
  let summaryFilter = "all";
  let summaryDateFilter = "all";
  let summaryDateFrom = "";
  let summaryDateTo = "";
  let summaryRolling48 = false;
  let summaryShippingFilter = "all";
  let summaryServalFilter = "all";
  let summaryPickingFilter = "all";
  let summaryTextFilter = "";
  let summaryIdsFilter = [];
  let summarySortKey = "planDateTime";
  let summarySortDir = "asc";
  let summaryPage = 1;
  let summaryPageSize = 25;
  let dashboardDateFrom = today();
  let dashboardDateTo = today();
  let dashboardRolling48 = false;
  let hceDateFrom = "";
  let hceDateTo = "";
  let hceProcessFilter = "all";
  let hceTimingFilter = "all";
  let hceSortKey = "planDateTime";
  let hceSortDir = "asc";
  let hcePage = 1;
  let hcePageSize = 25;
  let adminNotice = "";
  let adminSession = false;
  let adminSessionUntil = 0;
  let adminModalSection = null;
  let cloudStatus = "checking";
  let lastSyncAt = localStorage.getItem("msr_hce_last_sync") || null;
  let lastSyncError = "";
  let syncing = false;
  let cloudSaveChain = Promise.resolve();
  let cloudSaveSeq = 0;
  let lastCloudFingerprint = null;
  let cloudConflictActive = Boolean(localStorage.getItem(CLOUD_CONFLICT_KEY));
  let pendingCloudSave = localStorage.getItem("msr_hce_pending_sync")==="1";
  let pendingImportPreview = null;

  const $ = s => document.querySelector(s);
  const content = $("#content");

  function normalizeData(x){
    const base=defaultData();
    if(!x||typeof x!=="object")return base;
    return {
      ...base,
      ...x,
      msr:Array.isArray(x.msr)?x.msr:[],
      states:x.states&&typeof x.states==="object"?x.states:{},
      hce:Array.isArray(x.hce)?x.hce:[],
      meta:{
        ...base.meta,
        ...(x.meta||{}),
        importHistory:Array.isArray(x.meta?.importHistory)?x.meta.importHistory:[],
        auditLog:Array.isArray(x.meta?.auditLog)?x.meta.auditLog:[],
        trash:Array.isArray(x.meta?.trash)?x.meta.trash:[],
        errorLog:Array.isArray(x.meta?.errorLog)?x.meta.errorLog:[]
      }
    };
  }

  function load() {
    try {
      const x=JSON.parse(localStorage.getItem(STORAGE_KEY));
      return x&&x.version?normalizeData(x):defaultData();
    } catch { return defaultData(); }
  }
  function saveLocalOnly(){
    db.meta.updatedAt=new Date().toISOString();
    db.meta.writerId=DEVICE_ID;
    db.meta.revision=(Number(db.meta.revision)||0)+1;
    localStorage.setItem(STORAGE_KEY,JSON.stringify(db));
    window.dispatchEvent(new CustomEvent("msr-data-changed"));
  }

  function queueCloudSave(snapshot,seq){
    pendingCloudSave=true;
    localStorage.setItem("msr_hce_pending_sync","1");
    renderSyncStatus();

    cloudSaveChain=cloudSaveChain
      .catch(()=>{})
      .then(async()=>{
        if(!window.MSRCloud?.enabled||!navigator.onLine||cloudConflictActive)return;
        syncing=true;renderSyncStatus();

        const remoteRaw=await window.MSRCloud.load();
        const remote=remoteRaw?.version?normalizeData(remoteRaw):null;
        const remoteFingerprint=remote?JSON.stringify(remote):null;

        if(lastCloudFingerprint && remoteFingerprint && remoteFingerprint!==lastCloudFingerprint && remote?.meta?.writerId!==DEVICE_ID){
          localStorage.setItem(CLOUD_CONFLICT_KEY,JSON.stringify({at:nowISO(),local:db,remote}));
          cloudConflictActive=true;
          cloudStatus="error";
          lastSyncError="Conflicto detectado: otro dispositivo cambió la nube";
          renderSyncStatus();
          showEmployeePopup({
            type:"warning",
            title:"Sincronización detenida por seguridad",
            message:"Se han detectado cambios de otro dispositivo antes de subir tus cambios.",
            details:["Tu copia local se conserva.","La copia remota también se conserva.","Resuelve el conflicto desde Admin → Nube/copias."],
            primaryText:"Entendido"
          });
          return;
        }

        await window.MSRCloud.save(snapshot);
        lastCloudFingerprint=JSON.stringify(normalizeData(snapshot));

        if(seq===cloudSaveSeq){
          pendingCloudSave=false;
          localStorage.removeItem("msr_hce_pending_sync");
          markCloudOnline();
        }else{
          pendingCloudSave=true;
          localStorage.setItem("msr_hce_pending_sync","1");
          renderSyncStatus();
        }
      })
      .catch(err=>{
        console.warn("Cloud save",err);
        recordAppError(err,"cloud-save");
        pendingCloudSave=true;
        localStorage.setItem("msr_hce_pending_sync","1");
        markCloudError(err);
      })
      .finally(()=>{
        syncing=false;
        renderSyncStatus();
      });
    return cloudSaveChain;
  }

  function save() {
    db.meta.updatedAt = new Date().toISOString();
    db.meta.writerId=DEVICE_ID;
    db.meta.revision=(Number(db.meta.revision)||0)+1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    window.dispatchEvent(new CustomEvent("msr-data-changed"));
    const snapshot=JSON.parse(JSON.stringify(db));
    const seq=++cloudSaveSeq;
    if(window.MSRCloud?.enabled && navigator.onLine){
      queueCloudSave(snapshot,seq);
    }else{
      pendingCloudSave=true;
      localStorage.setItem("msr_hce_pending_sync","1");
      renderSyncStatus();
    }
  }
  let waitingServiceWorker=null;
  let reloadingForUpdate=false;

  function showAppUpdate(worker){
    waitingServiceWorker=worker||waitingServiceWorker;
    const banner=$("#appUpdateBanner");
    if(banner)banner.hidden=false;
  }

  function hideAppUpdate(){
    const banner=$("#appUpdateBanner");
    if(banner)banner.hidden=true;
  }

  function applyAppUpdate(){
    if(!waitingServiceWorker){
      toast("Buscando actualización…");
      navigator.serviceWorker?.getRegistration()?.then(reg=>reg?.update());
      return;
    }
    const btn=$("#applyUpdateBtn");
    if(btn){btn.disabled=true;btn.textContent="⏳ Actualizando…";}
    waitingServiceWorker.postMessage({type:"SKIP_WAITING"});
  }

  function wireServiceWorkerUpdates(reg){
    if(reg.waiting && navigator.serviceWorker.controller)showAppUpdate(reg.waiting);

    reg.addEventListener("updatefound",()=>{
      const worker=reg.installing;
      if(!worker)return;
      worker.addEventListener("statechange",()=>{
        if(worker.state==="installed" && navigator.serviceWorker.controller){
          showAppUpdate(worker);
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      if(reloadingForUpdate)return;
      reloadingForUpdate=true;
      location.reload();
    });

    setInterval(()=>reg.update().catch(()=>{}),5*60*1000);
  }

  function formatSyncTime(v){
    if(!v)return "Nunca";
    try{return new Date(v).toLocaleString("es-ES")}catch{return String(v)}
  }

  function renderSyncStatus(){
    const banner=$("#syncBanner"),dot=$("#syncDot"),title=$("#syncTitle"),detail=$("#syncDetail"),btn=$("#forceSyncBtn");
    if(!banner||!dot||!title||!detail)return;

    const online=navigator.onLine;
    dot.className="sync-dot";
    if(syncing){
      dot.classList.add("syncing");
      title.textContent="Sincronizando…";
      detail.textContent="Enviando/recibiendo cambios";
      if(btn)btn.disabled=true;
      return;
    }
    if(!online){
      dot.classList.add("offline");
      title.textContent="Sin conexión a Internet";
      detail.textContent=pendingCloudSave?`⚠️ Cambios pendientes · Última sincronización: ${formatSyncTime(lastSyncAt)}`:`Última sincronización: ${formatSyncTime(lastSyncAt)}`;
      if(btn)btn.disabled=false;
      return;
    }
    if(cloudStatus==="online"){
      dot.classList.add("online");
      title.textContent="En línea · sincronización activa";
      detail.textContent=pendingCloudSave?`⚠️ Hay cambios pendientes de confirmar · Última: ${formatSyncTime(lastSyncAt)}`:`Última sincronización: ${formatSyncTime(lastSyncAt)}`;
    }else if(cloudStatus==="error"){
      dot.classList.add("error");
      title.textContent="Modo local · nube no disponible";
      detail.textContent=lastSyncError?`${lastSyncError} · tus cambios siguen guardándose en este dispositivo`:`Sin nube · última sincronización: ${formatSyncTime(lastSyncAt)}`;
    }else{
      dot.classList.add("checking");
      title.textContent="Comprobando conexión…";
      detail.textContent=`Última sincronización: ${formatSyncTime(lastSyncAt)}`;
    }
    if(btn)btn.disabled=false;
  }

  function markCloudOnline(){
    cloudStatus="online";
    lastSyncAt=nowISO();
    localStorage.setItem("msr_hce_last_sync",lastSyncAt);
    lastSyncError="";
    renderSyncStatus();
  }

  function markCloudError(err){
    cloudStatus="error";
    lastSyncError=err?.message||"Error de sincronización";
    renderSyncStatus();
  }

  async function forceSync(){
    if(!window.MSRCloud?.enabled){
      cloudStatus="error";lastSyncError="Nube no configurada";renderSyncStatus();return;
    }
    if(!navigator.onLine){
      renderSyncStatus();toast("Sin Internet: no se puede sincronizar ahora",true);return;
    }
    syncing=true;renderSyncStatus();
    try{
      const rawCloud=await window.MSRCloud.load();
      const cloud=rawCloud?.version?normalizeData(rawCloud):null;
      const localTs=Date.parse(db?.meta?.updatedAt||0)||0;
      const cloudTs=Date.parse(cloud?.meta?.updatedAt||0)||0;
      const cloudDifferent=cloud && JSON.stringify(cloud)!==JSON.stringify(db);

      if(pendingCloudSave && cloudDifferent && cloud?.meta?.writerId!==DEVICE_ID){
        localStorage.setItem(CLOUD_CONFLICT_KEY,JSON.stringify({at:nowISO(),local:db,remote:cloud}));
        cloudStatus="error";
        lastSyncError="Cambios simultáneos detectados · revisa Admin > Nube/copias";
        showEmployeePopup({
          type:"warning",
          title:"No se ha forzado la sincronización",
          message:"Hay cambios locales pendientes y una copia distinta en la nube.",
          details:["No se ha sobrescrito ninguna copia.","En Admin → Nube/copias puedes decidir cuál conservar."],
          primaryText:"Entendido"
        });
        return;
      }

      if(cloud?.version && cloudTs>localTs && !pendingCloudSave){
        db=cloud;
        localStorage.setItem(STORAGE_KEY,JSON.stringify(db));
        lastCloudFingerprint=JSON.stringify(db);
        render();
        toast("☁️ Se descargó la versión más reciente");
      }else{
        db.meta.writerId=DEVICE_ID;
        await window.MSRCloud.save(db);
        lastCloudFingerprint=JSON.stringify(normalizeData(db));
        toast("☁️ Datos enviados y sincronizados");
      }
      pendingCloudSave=false;
      localStorage.removeItem("msr_hce_pending_sync");
      clearCloudConflict();
      markCloudOnline();
    }catch(err){
      console.warn("Force sync",err);
      recordAppError(err,"force-sync");
      markCloudError(err);
      toast("No se pudo sincronizar",true);
    }finally{
      syncing=false;renderSyncStatus();
    }
  }

  function showEmployeePopup({type="info",title="Aviso",message="",details=[],primaryText="Entendido",onPrimary=null,secondaryText="",onSecondary=null}={}){
    document.querySelector("#employeePopup")?.remove();
    const icon=type==="error"?"❌":type==="warning"?"⚠️":type==="success"?"✅":"ℹ️";
    const overlay=document.createElement("div");
    overlay.id="employeePopup";
    overlay.className="employee-popup-overlay";
    overlay.innerHTML=`<div class="employee-popup ${type}">
      <div class="employee-popup-icon">${icon}</div>
      <div class="employee-popup-copy">
        <div class="employee-popup-label">${type==="error"?"ERROR":type==="warning"?"REVISAR":type==="success"?"CORRECTO":"INFORMACIÓN"}</div>
        <h3>${esc(title)}</h3>
        <p>${esc(message)}</p>
        ${details?.length?`<div class="employee-popup-details">${details.map(x=>`<div><span>•</span><span>${esc(x)}</span></div>`).join("")}</div>`:""}
      </div>
      <div class="employee-popup-actions">
        ${secondaryText?`<button class="btn ghost" id="employeePopupSecondary">${esc(secondaryText)}</button>`:""}
        <button class="btn ${type==="error"?"danger":type==="warning"?"warning-popup-btn":"primary"}" id="employeePopupPrimary">${esc(primaryText)}</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    const close=()=>overlay.remove();
    const p=overlay.querySelector("#employeePopupPrimary");
    if(p)p.onclick=()=>{close();if(onPrimary)onPrimary();};
    const s=overlay.querySelector("#employeePopupSecondary");
    if(s)s.onclick=()=>{close();if(onSecondary)onSecondary();};
  }

  function requestServalComment(id,previousServal="No"){
    document.querySelector("#servalCommentModal")?.remove();
    const s=stateFor(id);
    const overlay=document.createElement("div");
    overlay.id="servalCommentModal";
    overlay.className="employee-popup-overlay";
    overlay.innerHTML=`<div class="employee-popup error serval-comment-popup">
      <div class="employee-popup-icon">🚨</div>
      <div class="employee-popup-copy">
        <div class="employee-popup-label">SERVAL</div>
        <h3>Comentario obligatorio</h3>
        <p>Explica brevemente la incidencia de la ID ${esc(id)}. Serval no quedará activado sin comentario.</p>
        <textarea id="servalRequiredComment" class="serval-required-comment" rows="4" placeholder="Describe la incidencia…">${esc(s.comment||"")}</textarea>
      </div>
      <div class="employee-popup-actions">
        <button class="btn ghost" id="servalCommentCancel">Cancelar</button>
        <button class="btn danger" id="servalCommentSave">🚨 Activar Serval</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const cancel=()=>{
      s.serval=previousServal||"No";
      overlay.remove();
      render();
    };
    overlay.querySelector("#servalCommentCancel").onclick=cancel;
    overlay.querySelector("#servalCommentSave").onclick=()=>{
      const comment=overlay.querySelector("#servalRequiredComment").value.trim();
      if(!comment){
        overlay.querySelector("#servalRequiredComment").classList.add("input-error");
        return;
      }
      const old={serval:previousServal||"No",comment:s.comment||""};
      s.serval="Si";s.comment=comment;s.updatedAt=nowISO();
      logAudit("msr",id,"Serval activado",{from:old,to:{serval:"Si",comment}},"empleado");
      save();
      overlay.remove();
      toast("🚨 Serval activado y comentario guardado");
      render();
    };
    setTimeout(()=>overlay.querySelector("#servalRequiredComment")?.focus(),30);
  }

  function importIssueFix(issue,kind){
    const msg=String(issue?.message||"").toLowerCase();
    const value=String(issue?.value||"").trim();
    let problem=issue?.message||"Dato no válido";
    let fix="Corrige el dato en el fichero y vuelve a importarlo.";
    if(msg.includes("código/id vacío")||msg.includes("codigo/id vacio")){
      problem="Código/ID vacío"; fix="Rellena la columna Código de esa línea.";
    }else if(msg.includes("no numérico")||msg.includes("no numerico")){
      problem="Código/ID no válido"; fix="Deja solo números en la columna Código.";
    }else if(msg.includes("orden de trabajo vacía")||msg.includes("orden de trabajo vacia")){
      problem="Orden de trabajo vacía"; fix="Rellena la columna Orden de trabajo.";
    }else if(msg.includes("tienda vacía")||msg.includes("tienda vacia")){
      problem="Tienda vacía"; fix="Rellena la columna Tienda.";
    }else if(msg.includes("fecha/hora prevista")||msg.includes("fecha prevista")){
      problem="Fecha/hora prevista no detectada";
      fix=kind==="msr"?"Revisa el formato de Orden de trabajo o corrige fecha/hora manualmente.":"Corrige Fecha prevista y Hora prevista.";
    }else if(msg.includes("duplicada")||msg.includes("duplicado")){
      problem="ID duplicada"; fix="Revisa las líneas repetidas. Se conserva la última aparición.";
    }else if(msg.includes("falta id entrada")||msg.includes("matrícula")||msg.includes("matricula")){
      problem="Falta matrícula / ID entrada"; fix="Rellena Matrícula o ID ENTRADA para identificar el HCE.";
    }else if(msg.includes("cantidad no numérica")||msg.includes("cantidad no numerica")){
      problem="Cantidad no válida"; fix="Usa un número en la columna Cantidad.";
    }else if(msg.includes("manual")){
      problem="Registro manual detectado"; fix="No requiere corrección: el sistema lo conservará o combinará automáticamente.";
    }
    return {line:issue?.line??"—",problem,fix,value};
  }
  function importIssuesPopup(kind,errors,warnings){
    const total=(errors?.length||0)+(warnings?.length||0);
    if(!total)return;
    const items=[
      ...(errors||[]).map(x=>({level:"error",...x})),
      ...(warnings||[]).map(x=>({level:"warning",...x}))
    ].slice(0,6).map(x=>{
      const i=importIssueFix(x,kind);
      return `${x.level==="error"?"❌":"⚠️"} Línea ${i.line}: ${i.problem} → ${i.fix}${i.value?` · Dato: ${i.value}`:""}`;
    });
    if(total>6)items.push(`… y ${total-6} incidencia(s) más en el informe detallado.`);
    showEmployeePopup({
      type:errors?.length?"error":"warning",
      title:`${errors?.length?"Importación con errores":"Importación con avisos"} · ${kind==="msr"?"MSR":"HCE"}`,
      message:errors?.length
        ?`${errors.length} línea(s) no se han importado correctamente. Corrige lo indicado y vuelve a cargar el fichero.`
        :`${warnings.length} línea(s) se han importado, pero conviene revisarlas.`,
      details:items,
      primaryText:"Ver detalle",
      secondaryText:"Cerrar",
      onPrimary:()=>go(kind==="msr"?"import-msr":"import-hce")
    });
  }

  function toast(msg, error=false) {
    const el=$("#toast"); el.textContent=msg; el.className="toast show"+(error?" error":"");
    clearTimeout(toast._t); toast._t=setTimeout(()=>el.className="toast",2600);
  }
  function esc(v=""){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]))}
  function norm(s=""){return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
  function idNorm(v){ const s=String(v??"").trim().replace(/^0+/,""); return s || String(v??"").trim(); }
  function nowISO(){return new Date().toISOString()}
  function today(){
    const d=new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function fmtDate(v){ if(!v)return ""; const s=String(v); if(/^\d{4}-\d{2}-\d{2}$/.test(s)){const [y,m,d]=s.split("-");return `${d}/${m}/${y}`} return s; }
  function fmtTime(v){ if(!v)return ""; return String(v).slice(0,5); }
  function dt(date,time){ if(!date)return null; const d=new Date(`${date}T${time||"00:00"}:00`); return isNaN(d)?null:d; }
  function download(name,text,type="application/json"){
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href);
  }
  function parseDate(v){
    if(v==null||v==="")return "";
    if(v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,"0")}-${String(v.getDate()).padStart(2,"0")}`;
    if(typeof v==="number" && window.XLSX){
      const d=XLSX.SSF.parse_date_code(v); if(d) return `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;
    }
    const s=String(v).trim();
    let m=s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if(m){let y=m[3];if(y.length===2)y="20"+y;return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`}
    m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m)return `${m[1]}-${m[2]}-${m[3]}`;
    return "";
  }
  function parseTime(v){
    if(v==null||v==="")return "";
    if(typeof v==="number"){ const total=Math.round((v%1)*24*60);return `${String(Math.floor(total/60)%24).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;}
    const s=String(v).trim(); const m=s.match(/(\d{1,2}):(\d{2})/); return m?`${m[1].padStart(2,"0")}:${m[2]}`:"";
  }
  const findHeader=(headers,candidates)=>{
    const hn=headers.map(norm);
    for(const c of candidates){const nc=norm(c); let i=hn.findIndex(h=>h===nc); if(i>=0)return i;}
    for(const c of candidates){const nc=norm(c); let i=hn.findIndex(h=>h.includes(nc)||nc.includes(h)); if(i>=0)return i;}
    return -1;
  };
  const pick=(row,idx,def="")=>idx>=0?(row[idx]??def):def;

  function recordAppError(error,context="app"){
    try{
      db.meta.errorLog=Array.isArray(db.meta.errorLog)?db.meta.errorLog:[];
      db.meta.errorLog.unshift({
        at:nowISO(),
        context,
        message:error?.message||String(error||"Error desconocido"),
        stack:String(error?.stack||"").slice(0,3000)
      });
      if(db.meta.errorLog.length>100)db.meta.errorLog.length=100;
      localStorage.setItem(STORAGE_KEY,JSON.stringify(db));
    }catch{}
  }

  function logAudit(entityType,id,action,changes={},source="empleado"){
    db.meta.auditLog=Array.isArray(db.meta.auditLog)?db.meta.auditLog:[];
    db.meta.auditLog.unshift({
      at:nowISO(),
      entityType,
      id:String(id||""),
      action,
      changes,
      source
    });
    if(db.meta.auditLog.length>1000)db.meta.auditLog.length=1000;
  }

  function pushTrash(entry){
    db.meta.trash=Array.isArray(db.meta.trash)?db.meta.trash:[];
    db.meta.trash.unshift({trashId:`tr_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,deletedAt:nowISO(),...entry});
    if(db.meta.trash.length>50)db.meta.trash.length=50;
  }

  function addImportHistory(report){
    db.meta.importHistory=Array.isArray(db.meta.importHistory)?db.meta.importHistory:[];
    db.meta.importHistory.unshift({...report});
    if(db.meta.importHistory.length>30)db.meta.importHistory.length=30;
  }

  function detectProblems(){
    const problems=[];
    db.msr.forEach(o=>{
      const s=db.states[idNorm(o.id)]||{};
      if((s.shipping==="Total"||s.shipping==="Parcial")&&(!s.date||!s.time)){
        problems.push({type:"msr",severity:"error",id:o.id,title:"Envío sin fecha/hora",detail:o.description||o.store||""});
      }
      if(s.serval==="Si"&&!String(s.comment||"").trim()){
        problems.push({type:"msr",severity:"error",id:o.id,title:"Serval sin comentario",detail:o.description||""});
      }
      if(Boolean(s.date)!==Boolean(s.time)){
        problems.push({type:"msr",severity:"warning",id:o.id,title:"Expedición incompleta",detail:"Completa fecha y hora de expedición"});
      }
      if(!o.planDate||!o.planTime){
        problems.push({type:"msr",severity:"warning",id:o.id,title:"Sin fecha/hora prevista",detail:o.description||""});
      }
    });
    db.hce.forEach(x=>{
      if((x.process||"Pendiente de recibir")!=="Pendiente de recibir"&&(!x.realDate||!x.realTime)){
        problems.push({type:"hce",severity:"error",id:x.number||x.entryId,title:"Estado avanzado sin llegada",detail:x.process||""});
      }
      if(!x.planDate||!x.planTime){
        problems.push({type:"hce",severity:"warning",id:x.number||x.entryId,title:"Sin fecha/hora prevista",detail:""});
      }
      if(Boolean(x.realDate)!==Boolean(x.realTime)){
        problems.push({type:"hce",severity:"warning",id:x.number||x.entryId,title:"Llegada incompleta",detail:"Completa fecha y hora de llegada"});
      }
    });
    const r=db.meta?.lastImportReport;
    if(r){
      (r.errors||[]).forEach(x=>problems.push({type:"import",severity:"error",id:`Línea ${x.line}`,title:x.message,detail:x.value||""}));
      (r.warnings||[]).forEach(x=>problems.push({type:"import",severity:"warning",id:`Línea ${x.line}`,title:x.message,detail:x.value||""}));
    }
    if(pendingCloudSave)problems.push({type:"sync",severity:"warning",id:"Nube",title:"Cambios pendientes de sincronizar",detail:formatSyncTime(lastSyncAt)});
    return problems;
  }

  function stateFor(id){
    const k=idNorm(id);
    if(!db.states[k]) db.states[k]={id:k,status:"Pendiente",date:"",time:"",shipping:"No",serval:"No",comment:"",updatedAt:null};
    const s=db.states[k];
    if(!["Pendiente","En proceso","Finalizado"].includes(s.status))s.status="Pendiente";
    if(!["No","Parcial","Total"].includes(s.shipping))s.shipping="No";
    if(!["No","Si"].includes(s.serval))s.serval="No";
    s.date=s.date||"";s.time=s.time||"";s.comment=s.comment||"";
    return s;
  }
  function palletsLeft(s){
    const t=Number(s.total), n=Number(s.sent);
    return Number.isFinite(t)&&Number.isFinite(n)?Math.max(0,t-n):"";
  }
  function plannedFor(o){ return dt(o.planDate,o.planTime); }
  function actualFor(o,s){ return dt(s?.date,s?.time); }
  function situation(o){
    const s=db.states[idNorm(o.id)]||{};
    if(s.shipping==="Total") return "EXPEDIDO";
    if(s.shipping==="Parcial") return "EXPEDIDO PARCIAL";
    const p=plannedFor(o);
    if(p && new Date()>p) return "RETRASO";
    return "PENDIENTE";
  }
  function exactDurationLabel(ms){
    const total=Math.round(Math.abs(ms)/60000);
    const h=Math.floor(total/60),m=total%60;
    return h?`${h} h ${m} min`:`${m} min`;
  }

  function timing(o,s){
    const p=plannedFor(o), a=actualFor(o,s);
    if(!p)return "⚪ SIN PREVISIÓN";
    const ref=a||new Date();
    const diff=ref-p;
    const label=exactDurationLabel(diff);
    if(a){
      if(diff<=0)return `🟢 A TIEMPO · ${label} antes`;
      return `🔴 TARDE · ${label}`;
    }
    if(diff>0)return `🔴 RETRASO · ${label}`;
    return `🔵 FALTAN · ${label}`;
  }

  function msrComplianceCell(o,s){
    const ship=s?.shipping||"No";
    const p=plannedFor(o);
    const a=actualFor(o,s);
    const plannedText=p?`${fmtDate(o.planDate)} · ${fmtTime(o.planTime)}`:"Sin previsión";
    const actualText=a?`${fmtDate(s.date)} · ${fmtTime(s.time)}`:"Sin expedición";

    let cls="cmp-neutral",icon="⚪",title="SIN DATOS",delta="Sin cálculo",meaning="Revisar información.";
    if(ship==="Total"){
      meaning="Pedido completo enviado · no queda mercancía pendiente de esta ID.";
      if(a&&p){
        const diff=a-p;
        if(diff<=0){cls="cmp-success";icon="✅";title="TOTAL · ENVIADO A TIEMPO";delta=`${exactDurationLabel(diff)} antes del previsto`;}
        else{cls="cmp-complete-late";icon="🟣";title="TOTAL · ENVIADO CON RETRASO";delta=`${exactDurationLabel(diff)} después del previsto`;}
      }else{
        cls="cmp-success";icon="✅";title="TOTAL · PEDIDO COMPLETO ENVIADO";delta="⚠️ Falta registrar fecha/hora real";
      }
    }else if(ship==="Parcial"){
      meaning="Se ha enviado una parte del pedido · queda mercancía pendiente de esta misma ID.";
      if(a&&p){
        const diff=a-p;
        cls=diff>0?"cmp-partial-late":"cmp-partial";
        icon="🟠";title="PARCIAL · QUEDA RESTO PENDIENTE";
        delta=diff<=0?`Parte enviada ${exactDurationLabel(diff)} antes del previsto`:`Parte enviada ${exactDurationLabel(diff)} después del previsto`;
      }else{
        cls="cmp-partial";icon="🟠";title="PARCIAL · QUEDA RESTO PENDIENTE";delta="⚠️ Registra fecha/hora del envío parcial";
      }
    }else if(p){
      meaning="No consta ningún envío de esta ID.";
      const diff=new Date()-p;
      if(diff>0){cls="cmp-danger";icon="🔴";title="NO ENVIADO · FUERA DE PLAZO";delta=`${exactDurationLabel(diff)} de retraso`;}
      else{cls="cmp-info";icon="🔵";title="NO ENVIADO · TODAVÍA EN PLAZO";delta=`Faltan ${exactDurationLabel(diff)} para la hora prevista`;}
    }else{
      cls="cmp-neutral";icon="⚪";title="NO ENVIADO";delta="No se puede calcular el cumplimiento";meaning="Falta fecha/hora prevista.";
    }

    return `<div class="compliance-card ${cls}">
      <div class="compliance-main"><span class="compliance-icon">${icon}</span><strong>${title}</strong></div>
      <div class="compliance-delta">${esc(delta)}</div>
      <div class="compliance-meaning">${esc(meaning)}</div>
      <div class="compliance-meta">
        <span>📅 Previsto: ${esc(plannedText)}</span>
        <span>🚚 Expedición: ${esc(actualText)}</span>
      </div>
    </div>`;
  }

  function msrShippingBadge(value){
    const v=value||"No";
    if(v==="Total")return '<span class="status-chip ship-total" title="Pedido completo enviado">✅ Total · completo</span>';
    if(v==="Parcial")return '<span class="status-chip ship-partial" title="Parte enviada; queda resto pendiente">🟠 Parcial · queda resto</span>';
    return '<span class="status-chip ship-no" title="No consta ningún envío">⏳ No enviado</span>';
  }

  function servalBadge(value){
    return value==="Si"
      ? '<span class="status-chip serval-yes">🚨 Sí</span>'
      : '<span class="status-chip serval-no">✓ No</span>';
  }

  function msrComplianceBadge(o,s){
    const ship=s?.shipping||"No";
    const p=plannedFor(o);
    const a=actualFor(o,s);
    if(!p){
      const label=ship==="Total"?"✅ ENVIADO":ship==="Parcial"?"🟠 PARCIAL":"⏳ NO ENVIADO";
      return `<span class="badge b-gray">${label} · SIN PREVISIÓN</span>`;
    }

    if(ship==="Total"||ship==="Parcial"){
      if(!a){
        const cls=ship==="Total"?"b-green":"b-orange";
        const label=ship==="Total"?"✅ ENVIADO":"🟠 PARCIAL";
        return `<span class="badge ${cls}">${label} · SIN HORA REAL</span>`;
      }
      const diff=a-p;
      const txt=exactDurationLabel(diff);
      const label=ship==="Total"?"✅ ENVIADO":"🟠 PARCIAL";
      const cls=diff<=0?(ship==="Total"?"b-green":"b-orange"):"b-red";
      return `<span class="badge ${cls}">${label} · ${diff<=0?txt+" antes":txt+" tarde"}</span>`;
    }

    const diff=new Date()-p;
    if(diff>0)return `<span class="badge b-red">🔴 NO ENVIADO · ${exactDurationLabel(diff)} de retraso</span>`;
    return `<span class="badge b-blue">🔵 NO ENVIADO · faltan ${exactDurationLabel(diff)}</span>`;
  }

  function msrTimeBadge(o,s){
    const t=timing(o,s);
    let cls="b-gray";
    if(t.includes("A TIEMPO"))cls="b-green";
    else if(t.includes("TARDE")||t.includes("RETRASO"))cls="b-red";
    else if(t.includes("FALTAN"))cls="b-blue";
    return `<span class="badge ${cls}">${esc(t)}</span>`;
  }

  function msrRowClass(o,s){
    if((s.serval||"No")==="Si")return "row-serval";
    const ship=s.shipping||"No";
    const p=plannedFor(o),a=actualFor(o,s);

    if(ship==="Total"){
      if(a&&p&&a>p)return "row-complete-late";
      return "row-success";
    }
    if(ship==="Parcial")return "row-partial";
    if(p&&new Date()>p)return "row-danger";
    if(p)return "row-info";
    return "row-neutral";
  }

  function hceRowClass(x){
    const p=x.process||"Pendiente de recibir";
    const t=hceTiming(x);
    if(p==="Descargado")return t.kind==="red"?"row-done-late":"row-success";
    if(t.kind==="red")return "row-danger";
    if(p==="Descargando")return "row-purple";
    if(p==="Posicionado")return "row-info";
    return "row-warning-soft";
  }

  function stateSelectClass(type,value){
    const v=String(value||"");
    if(type==="shipping"){
      if(v==="Total")return "select-ok";
      if(v==="Parcial")return "select-warn";
      return "select-neutral";
    }
    if(type==="serval"){
      return v==="Si"?"select-danger":"select-ok-soft";
    }
    if(type==="picking"){
      if(v==="Finalizado")return "select-ok";
      if(v==="En proceso")return "select-info";
      return "select-warn-soft";
    }
    if(type==="hce"){
      if(v==="Descargado")return "select-ok";
      if(v==="Descargando")return "select-purple";
      if(v==="Posicionado")return "select-info";
      return "select-warn-soft";
    }
    return "";
  }

  function badge(text){
    const t=String(text||"");
    let cls="b-gray";
    if(["EXPEDIDO","Finalizado","Descargado","Total","Si"].includes(t))cls="b-green";
    else if(["RETRASO","Serval"].includes(t))cls="b-red";
    else if(["PENDIENTE","Pendiente","Pendiente de recibir"].includes(t))cls="b-yellow";
    else if(["En proceso","Posicionado"].includes(t))cls="b-blue";
    else if(["EXPEDIDO PARCIAL","Parcial"].includes(t))cls="b-orange";
    else if(["Descargando"].includes(t))cls="b-violet";
    return `<span class="badge ${cls}">${esc(t)}</span>`;
  }

  const pages={
    inicio:["Inicio","Centro de mando MSR / HCE"],
    resumen:["Resumen MSR","Situación de órdenes, expediciones y cumplimiento"],
    hce:["Contenedores HCE","Recepción, descarga y checklist operativo"],
    "import-msr":["Importar MSR","Carga el export MSR sin borrar estados manuales"],
    "import-hce":["Importar HCE","Carga la planificación HCE del día"],
    datos:["Datos / copias","Backup, restauración y limpieza"]
  };

  function go(p){
    if(p==="estados")p="resumen";
    page=p; location.hash=p;
    document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===p));
    $("#pageTitle").textContent=pages[p][0]; $("#pageSubtitle").textContent=pages[p][1];
    $("#sidebar").classList.remove("open");
    render();
  }

  function kpis(){
    const total=db.msr.length;
    const sit=db.msr.map(situation);
    const sent=sit.filter(x=>x==="EXPEDIDO").length;
    const partial=sit.filter(x=>x==="EXPEDIDO PARCIAL").length;
    const late=sit.filter(x=>x==="RETRASO").length;
    const left=Object.values(db.states).reduce((a,s)=>a+(Number(palletsLeft(s))||0),0);
    const htotal=db.hce.length;
    const unloaded=db.hce.filter(x=>x.process==="Descargado").length;
    return {total,sent,partial,late,left,htotal,unloaded,hpending:htotal-unloaded};
  }


  function showProblemsModal(){
    const problems=detectProblems();
    document.querySelector("#problemsModal")?.remove();
    const overlay=document.createElement("div");
    overlay.id="problemsModal";
    overlay.className="problems-modal-overlay";
    overlay.innerHTML=`<div class="problems-modal-shell">
      <div class="problems-modal-head">
        <div><span>🧭 CONTROL DE CALIDAD</span><h2>Problemas detectados</h2><p>${problems.length} elemento(s) requieren revisión.</p></div>
        <button id="problemsModalClose">✕</button>
      </div>
      <div class="problems-modal-list">
        ${problems.length?problems.map(p=>`<div class="problem-item ${p.severity}">
          <span class="problem-icon">${p.severity==="error"?"❌":"⚠️"}</span>
          <div><strong>${esc(p.title)}</strong><small>${esc(p.type.toUpperCase())} · ${esc(p.id||"")}${p.detail?" · "+esc(p.detail):""}</small></div>
        </div>`).join(""):`<div class="admin-editor-empty compact"><span>✅</span><strong>No se detectan problemas</strong><small>La información actual es coherente.</small></div>`}
      </div>
      <div class="problems-modal-actions"><button class="btn primary" id="problemsModalOk">Entendido</button></div>
    </div>`;
    document.body.appendChild(overlay);
    const close=()=>overlay.remove();
    overlay.querySelector("#problemsModalClose").onclick=close;
    overlay.querySelector("#problemsModalOk").onclick=close;
  }

  function restoreTrashItem(trashId){
    const list=Array.isArray(db.meta.trash)?db.meta.trash:[];
    const item=list.find(x=>x.trashId===trashId);
    if(!item){toast("Elemento de papelera no encontrado",true);return;}
    if(item.type==="msr-full"){
      if(item.order&&!db.msr.some(o=>idNorm(o.id)===idNorm(item.order.id)))db.msr.push({...item.order});
      if(item.state)db.states[idNorm(item.id)]={...item.state};
      db.msr.sort((a,b)=>(`${a.planDate||""}${a.planTime||""}${a.id}`).localeCompare(`${b.planDate||""}${b.planTime||""}${b.id}`));
      logAudit("msr",item.id,"Restaurado desde papelera",{},"admin");
    }else if(item.type==="msr-memory"){
      if(item.state)db.states[idNorm(item.id)]={...item.state};
      logAudit("msr",item.id,"Memoria restaurada desde papelera",{},"admin");
    }else if(item.type==="hce-full"){
      if(item.item&&!db.hce.some(x=>x.key===item.item.key))db.hce.push({...item.item});
      logAudit("hce",item.id,"Restaurado desde papelera",{},"admin");
    }
    db.meta.trash=list.filter(x=>x.trashId!==trashId);
    save();
    toast("♻️ Elemento restaurado");
    if(document.querySelector("#adminModal"))renderAdminModal();
  }

  function renderInicio(){
    const inDashboardRange=(d,t="00:00")=>{
      if(!d)return false;
      if(dashboardRolling48){
        const point=dt(d,t);
        if(!point)return false;
        const now=Date.now();
        return point.getTime()>=now-(48*60*60*1000) && point.getTime()<=now;
      }
      if(dashboardDateFrom && d<dashboardDateFrom)return false;
      if(dashboardDateTo && d>dashboardDateTo)return false;
      return true;
    };
    const msr=orderRows().filter(({o})=>inDashboardRange(o.planDate,o.planTime))
      .sort((a,b)=>(`${a.o.planDate}${a.o.planTime}`).localeCompare(`${b.o.planDate}${b.o.planTime}`));
    const hce=db.hce.filter(x=>inDashboardRange(x.planDate,x.planTime))
      .sort((a,b)=>(`${a.planDate}${a.planTime}`).localeCompare(`${b.planDate}${b.planTime}`));

    const msrNo=msr.filter(({s})=>(s.shipping||"No")==="No").length;
    const msrPartial=msr.filter(({s})=>(s.shipping||"No")==="Parcial").length;
    const msrTotal=msr.filter(({s})=>(s.shipping||"No")==="Total").length;
    const msrServal=msr.filter(({s})=>(s.serval||"No")==="Si").length;
    const pickPending=msr.filter(({s})=>(s.status||"Pendiente")==="Pendiente").length;
    const pickProcess=msr.filter(({s})=>(s.status||"Pendiente")==="En proceso").length;
    const pickDone=msr.filter(({s})=>(s.status||"Pendiente")==="Finalizado").length;
    const msrLate=msr.filter(({o,s})=>timing(o,s).includes("RETRASO")||timing(o,s).includes("TARDE")).length;

    const hcePending=hce.filter(x=>!(x.realDate&&x.realTime)).length;
    const hceOnTime=hce.filter(x=>x.realDate&&x.realTime&&hceTiming(x).hours<=0).length;
    const hceLate=hce.filter(x=>x.realDate&&x.realTime&&hceTiming(x).hours>0).length;
    const hceDownloading=hce.filter(x=>x.process==="Descargando").length;
    const hceDone=hce.filter(x=>x.process==="Descargado").length;

    const alerts=[];
    if(msrLate)alerts.push(`🔴 ${msrLate} orden(es) MSR con retraso`);
    if(msrPartial)alerts.push(`🟠 ${msrPartial} envío(s) parcial(es)`);
    if(msrServal)alerts.push(`⚠️ ${msrServal} orden(es) con Serval`);
    if(hceLate)alerts.push(`🚨 ${hceLate} contenedor(es) llegaron tarde`);
    if(hcePending)alerts.push(`⏳ ${hcePending} contenedor(es) pendientes de llegada`);

    const rangeLabel=dashboardRolling48
      ?"Últimas 48 horas"
      :dashboardDateFrom||dashboardDateTo
      ? `${dashboardDateFrom?fmtDate(dashboardDateFrom):"Inicio"} → ${dashboardDateTo?fmtDate(dashboardDateTo):"Actualidad"}`
      : "Todas las fechas";
    const detectedProblems=detectProblems();
    const criticalProblems=detectedProblems.filter(x=>x.severity==="error").length;
    const shiftSummary=`MSR: ${msr.length} órdenes · Picking ${pickPending} pendientes / ${pickProcess} en proceso / ${pickDone} finalizados · ${msrNo} sin enviar · ${msrPartial} parciales · ${msrTotal} totales · ${msrLate} con retraso. HCE: ${hce.length} previstos · ${hcePending} pendientes de llegada · ${hceDownloading} descargando · ${hceDone} descargados · ${hceLate} llegaron tarde.`;
    const shiftStatus=criticalProblems>0
      ?`Turno con ${criticalProblems} incidencia(s) crítica(s) que requieren revisión.`
      :detectedProblems.length
      ?`Turno operativo con ${detectedProblems.length} aviso(s) por revisar.`
      :"Turno sin incidencias críticas detectadas en los datos visibles.";

    content.innerHTML=`
      <div class="dashboard-toolbar no-capture">
        <div class="dashboard-filters">
          <div class="dashboard-date-group">
            <label>Desde<input id="dashboardDateFrom" class="filter-input modern-control" type="date" value="${esc(dashboardDateFrom)}"></label>
            <label>Hasta<input id="dashboardDateTo" class="filter-input modern-control" type="date" value="${esc(dashboardDateTo)}"></label>
          </div>
          <div class="dashboard-quick">
            <button class="btn chip blue" id="dashboardToday">📅 Hoy</button>
            <button class="btn chip violet" id="dashboardYesterday">↩️ Ayer</button>
            <button class="btn chip amber" id="dashboard48h">⏱️ 48 h</button>
            <button class="btn chip slate" id="dashboardAll">🗂️ Todas</button>
          </div>
          <div class="dashboard-actions">
            <button class="btn ${detectedProblems.length?"problem-btn":"success"}" id="problemsBtn">${detectedProblems.length?"⚠️ "+detectedProblems.length+" por revisar":"✅ Sin problemas"}</button>
            <button class="btn pdf-main-btn" id="printDashboardBtn">📄 Generar PDF del parte</button>
          </div>
        </div>
      </div>

      <section class="report-card" id="operationalReport">
        <div class="pdf-cover-title print-only">
          <div class="pdf-cover-mark">📦</div>
          <div><strong>PARTE OPERATIVO MSR · HCE</strong><span>Resumen de expediciones y recepciones</span></div>
        </div>
        <div class="report-head">
          <div>
            <div class="eyebrow">📦 PARTE OPERATIVO · MSR / HCE</div>
            <h2>${rangeLabel}</h2>
            <div class="report-sub">🔄 Actualizado a fecha y hora exacta · este informe refleja el estado visible en el momento de generarlo.</div>
          </div>
          <div class="report-updated">🕒 ${new Date().toLocaleString("es-ES")}</div>
        </div>

        <div class="report-alerts ${alerts.length?"has-alerts":"all-clear"}">
          <strong>${alerts.length?"🚨 Avisos que requieren atención":"✅ Sin alertas destacadas"}</strong>
          <div>${alerts.length?alerts.map(x=>`<span>${esc(x)}</span>`).join(""):"Todo está dentro de los parámetros visibles para este periodo."}</div>
        </div>

        <div class="shift-summary">
          <div class="shift-summary-icon">${criticalProblems?"🚨":detectedProblems.length?"⚠️":"✅"}</div>
          <div>
            <strong>Situación del turno</strong>
            <p>${esc(shiftSummary)}</p>
            <small>${esc(shiftStatus)}</small>
          </div>
        </div>

        <div class="status-legend">
          <span class="legend success">🟢 Total enviado a tiempo</span>
          <span class="legend purple">🟣 Enviado con retraso</span>
          <span class="legend warning">🟠 Parcial · queda resto pendiente</span>
          <span class="legend danger">🔴 No enviado y retrasado</span>
          <span class="legend info">🔵 No enviado, aún en plazo</span>
          <span class="legend serval">🚨 Serval</span>
        </div>
        <section class="pdf-section pdf-msr-section">
        <div class="section-title">📋 MSR · Repartos / Expediciones</div>
        <div class="grid report-kpis visual-kpis">
          ${kpi("📦 Órdenes",msr.length,"Total del periodo")}
          ${kpi("⏳ Sin enviar",msrNo,"Envío = No")}
          ${kpi("🟠 Parciales",msrPartial,"Revisar continuidad")}
          ${kpi("✅ Totales",msrTotal,"Expedidas")}
          ${kpi("⚠️ Serval",msrServal,"Requieren comentario")}
          ${kpi("🔴 Retraso",msrLate,"Fuera de hora")}
        </div>

        <div class="table-wrap report-table">
          <table class="data-table report-data-table">
            <thead><tr><th>⏱ Cumplimiento</th><th>🔢 Código</th><th>📦 Picking</th><th>📝 Orden de trabajo</th><th>🏬 Tienda</th><th>🚚 Envío</th><th>🕒 Expedición</th><th>⚠️ Serval</th><th>💬 Comentario</th></tr></thead>
            <tbody>${msr.length?msr.map(({o,s})=>`<tr class="${msrRowClass(o,s)} ${s.serval==="Si"?"serval-alert":""}">
              <td>${msrComplianceCell(o,s)}</td>
              <td><strong>${esc(o.id)}</strong></td>
              <td>${pickingBadge(s.status||"Pendiente")}</td>
              <td class="wrap">${esc(o.description||"")}</td>
              <td>${esc(o.store||"")}</td>
              <td>${msrShippingBadge(s.shipping||"No")}</td>
              <td>${s.date?`${fmtDate(s.date)} · ${fmtTime(s.time)}`:"—"}</td>
              <td>${servalBadge(s.serval||"No")}</td>
              <td class="wrap">${esc(s.comment||"")}</td>
            </tr>`).join(""):`<tr><td colspan="9" class="empty">No hay órdenes MSR en este periodo.</td></tr>`}</tbody>
          </table>
        </div>

        </section>
        <section class="pdf-section pdf-hce-section">
        <div class="section-title hce-title">🚛 HCE · Entradas / Recepciones</div>
        <div class="grid report-kpis hce-kpis visual-kpis">
          ${kpi("🚛 Contenedores",hce.length,"Total del periodo")}
          ${kpi("⏳ Pendientes",hcePending,"Sin llegada")}
          ${kpi("🟢 A tiempo",hceOnTime,"Llegaron antes/en hora")}
          ${kpi("🔴 Tarde",hceLate,"Llegaron fuera de hora")}
          ${kpi("🔄 Descargando",hceDownloading,"En proceso")}
          ${kpi("✅ Descargados",hceDone,"Finalizados")}
        </div>

        <div class="table-wrap report-table">
          <table class="data-table report-data-table">
            <thead><tr><th>⏱ Cumplimiento</th><th>🚛 Matrícula</th><th>📅 Previsto</th><th>📥 Llegada</th><th>📌 Estado</th></tr></thead>
            <tbody>${hce.length?hce.map(x=>`<tr class="${hceRowClass(x)}">
              <td>${hceComplianceCell(x)}</td>
              <td><strong>${esc(x.number||x.entryId)}</strong></td>
              <td>${fmtDate(x.planDate)} · ${fmtTime(x.planTime)}</td>
              <td>${x.realDate?`${fmtDate(x.realDate)} · ${fmtTime(x.realTime)}`:"—"}</td>
              <td>${hceProcessBadge(x.process||"Pendiente de recibir")}</td>
            </tr>`).join(""):`<tr><td colspan="5" class="empty">No hay contenedores HCE en este periodo.</td></tr>`}</tbody>
          </table>
        </div>

        </section>
        <div class="report-footer">MSR · HCE Control · Parte generado ${new Date().toLocaleString("es-ES")}</div>
      </section>`;
  }
  function stampReportNow(){
    const now=new Date();
    const label=now.toLocaleString("es-ES");
    const head=document.querySelector("#operationalReport .report-updated");
    const foot=document.querySelector("#operationalReport .report-footer");
    if(head)head.textContent=`🕒 Generado / actualizado: ${label}`;
    if(foot)foot.textContent=`MSR · HCE Control · Informe generado: ${label}`;
    return label;
  }

  function kpi(label,value,hint){
    const l=String(label);
    let cls="kpi-neutral";
    if(l.includes("Totales")||l.includes("A tiempo")||l.includes("Descargados"))cls="kpi-success";
    else if(l.includes("Retraso")||l.includes("Tarde"))cls="kpi-danger";
    else if(l.includes("Parciales")||l.includes("Pendientes"))cls="kpi-warning";
    else if(l.includes("Serval"))cls="kpi-serval";
    else if(l.includes("Sin enviar")||l.includes("Contenedores")||l.includes("Órdenes"))cls="kpi-info";
    return `<div class="kpi ${cls}"><small>${label}</small><strong>${esc(value)}</strong><div class="hint">${hint}</div></div>`;
  }

  function orderRows(){
    return db.msr.map(o=>({o,s:stateFor(o.id)}));
  }

  function pickingOptions(current){
    const items=[
      ["Pendiente","📦 Pendiente · picking todavía no finalizado"],
      ["En proceso","🔄 En proceso · picking en curso"],
      ["Finalizado","✅ Finalizado · picking completado"]
    ];
    return items.map(([v,label])=>`<option value="${v}" ${current===v?"selected":""}>${label}</option>`).join("");
  }

  function pickingBadge(value){
    const v=value||"Pendiente";
    if(v==="Finalizado")return '<span class="status-chip pick-done">✅ Finalizado</span>';
    if(v==="En proceso")return '<span class="status-chip pick-process">🔄 En proceso</span>';
    return '<span class="status-chip pick-pending">📦 Pendiente</span>';
  }

  function pagerHtml(prefix,page,pageSize,total){
    const pages=Math.max(1,Math.ceil(total/pageSize));
    const safe=Math.min(Math.max(1,page),pages);
    const from=total?((safe-1)*pageSize)+1:0;
    const to=Math.min(total,safe*pageSize);
    return `<div class="table-pager">
      <div class="pager-info"><strong>${from}–${to}</strong> de ${total}</div>
      <div class="pager-actions">
        <label>Mostrar
          <select id="${prefix}PageSize" class="pager-select">
            ${[25,50,100].map(n=>`<option value="${n}" ${pageSize===n?"selected":""}>${n}</option>`).join("")}
          </select>
        </label>
        <button class="btn ghost pager-btn" id="${prefix}Prev" ${safe<=1?"disabled":""}>← Anterior</button>
        <span class="pager-page">Página ${safe} / ${pages}</span>
        <button class="btn ghost pager-btn" id="${prefix}Next" ${safe>=pages?"disabled":""}>Siguiente →</button>
      </div>
    </div>`;
  }

  function shippingOptions(current){
    const items=[
      ["No","⏳ No enviado · todavía no ha salido mercancía"],
      ["Parcial","🟠 Parcial · se ha enviado una parte; queda resto pendiente"],
      ["Total","✅ Total · pedido completo enviado"]
    ];
    return items.map(([v,label])=>`<option value="${v}" ${current===v?"selected":""}>${label}</option>`).join("");
  }

  function hceProcessOptions(current){
    const items=[
      ["Pendiente de recibir","⏳ Pendiente de recibir · todavía no ha llegado"],
      ["Posicionado","📍 Posicionado · ya llegó y está ubicado"],
      ["Descargando","🔄 Descargando · descarga en curso"],
      ["Descargado","✅ Descargado · descarga finalizada"]
    ];
    return items.map(([v,label])=>`<option value="${v}" ${current===v?"selected":""}>${label}</option>`).join("");
  }

  function msrOptions(current, options){
    return options.map(v=>`<option value="${esc(v)}" ${current===v?"selected":""}>${esc(v)}</option>`).join("");
  }

  function sortSummaryRows(rows){
    const val=({o,s})=>{
      if(summarySortKey==="planDateTime")return `${o.planDate||""} ${o.planTime||""}`;
      if(summarySortKey==="id")return Number(o.id)||0;
      if(summarySortKey==="store")return o.store||"";
      if(summarySortKey==="shipping")return s.shipping||"No";
      if(summarySortKey==="sendDateTime")return `${s.date||""} ${s.time||""}`;
      if(summarySortKey==="serval")return s.serval||"No";
      return "";
    };
    return rows.sort((a,b)=>{
      const va=val(a),vb=val(b);
      const cmp=typeof va==="number"&&typeof vb==="number"
        ? va-vb
        : String(va).localeCompare(String(vb),"es",{numeric:true,sensitivity:"base"});
      return summarySortDir==="desc"?-cmp:cmp;
    });
  }

  function tableOrders(rows,compact=false){
    const rr=rows.map(x=>x.o?x:{o:x,s:stateFor(x.id)});
    if(!rr.length)return `<div class="empty">No hay órdenes MSR con estos filtros.</div>`;

    if(compact){
      return `<table class="data-table compact-table"><thead><tr><th>Código</th><th>Picking</th><th>Orden de trabajo</th><th>Tienda</th></tr></thead><tbody>${rr.map(({o,s})=>`<tr><td><strong>${esc(o.id)}</strong></td><td>${pickingBadge(s.status||"Pendiente")}</td><td class="wrap">${esc(o.description||"")}</td><td>${esc(o.store||"")}</td></tr>`).join("")}</tbody></table>`;
    }

    return `<table class="data-table msr-table"><thead><tr>
      <th class="c-code">Código</th>
      <th class="c-picking">Picking</th>
      <th class="c-work">Orden de trabajo</th>
      <th class="c-store">Tienda</th>
      <th class="c-shipping">Envío</th>
      <th class="c-date">Fecha expedición</th>
      <th class="c-time">Hora expedición</th>
      <th class="c-serval">Serval</th>
      <th class="c-comment">Comentario</th>
    </tr></thead><tbody>${rr.map(({o,s})=>`<tr class="${msrRowClass(o,s)} ${s.serval==="Si"?"serval-alert":""}">
      <td><strong>${esc(o.id)}</strong></td>
      <td><select class="msr-edit msr-picking ${stateSelectClass("picking",s.status||"Pendiente")}" data-msr-id="${esc(o.id)}" data-msr-field="status">${pickingOptions(s.status||"Pendiente")}</select></td>
      <td class="wrap msr-description">${esc(o.description||"")}</td>
      <td class="wrap">${esc(o.store||"")}</td>
      <td><select class="msr-edit msr-select ${stateSelectClass("shipping",s.shipping||"No")}" data-msr-id="${esc(o.id)}" data-msr-field="shipping">${shippingOptions(s.shipping||"No")}</select></td>
      <td><input class="msr-edit msr-date" type="date" data-msr-id="${esc(o.id)}" data-msr-field="date" value="${esc(s.date||"")}"></td>
      <td><input class="msr-edit msr-time" type="time" data-msr-id="${esc(o.id)}" data-msr-field="time" value="${esc(s.time||"")}"></td>
      <td><select class="msr-edit msr-select-short ${stateSelectClass("serval",s.serval||"No")} ${s.serval==="Si"?"serval-field":""}" data-msr-id="${esc(o.id)}" data-msr-field="serval">${msrOptions(s.serval||"No",["No","Si"])}</select></td>
      <td><textarea class="msr-edit msr-comment ${s.serval==="Si"?"serval-field":""}" rows="2" data-msr-id="${esc(o.id)}" data-msr-field="comment" placeholder="Comentario">${esc(s.comment||"")}</textarea></td>
    </tr>`).join("")}</tbody></table>`;
  }

  function openManualMsrModal(){
    document.querySelector("#manualEntryModal")?.remove();
    const overlay=document.createElement("div");
    overlay.id="manualEntryModal";
    overlay.className="manual-entry-overlay";
    overlay.innerHTML=`<div class="manual-entry-shell">
      <div class="manual-entry-head">
        <div><span>➕ ALTA MANUAL</span><h2>Nueva orden MSR</h2><p>Úsalo si una orden no aparece en la importación.</p></div>
        <button id="manualEntryClose">✕</button>
      </div>
      <div class="manual-entry-form">
        <label>Código / ID *<input id="mmId" inputmode="numeric" placeholder="Ej. 450"></label>
        <label class="wide">Orden de trabajo *<input id="mmWork" placeholder="Ej. 512096_SABELA_2809_07AM"></label>
        <label>Tienda *<input id="mmStore" placeholder="Tienda / destino"></label>
        <label>Nº OT carga<input id="mmLoadOT"></label>
        <label>Fecha prevista *<input id="mmDate" type="date"></label>
        <label>Hora prevista *<input id="mmTime" type="time"></label>
        <label>Cadena<input id="mmChain"></label>
        <label>Origen / estado de referencia<input id="mmSource" value="Manual"></label>
      </div>
      <div class="manual-entry-note">💾 Si esa ID aparece después en una importación, el sistema la detectará como existente/manual y conservará su estado operativo.</div>
      <div class="manual-entry-actions">
        <button class="btn ghost" id="manualEntryCancel">Cancelar</button>
        <button class="btn primary" id="manualEntrySave">💾 Crear ID</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close=()=>overlay.remove();
    overlay.querySelector("#manualEntryClose").onclick=close;
    overlay.querySelector("#manualEntryCancel").onclick=close;
    overlay.querySelector("#manualEntrySave").onclick=()=>{
      const id=idNorm(overlay.querySelector("#mmId").value);
      const work=overlay.querySelector("#mmWork").value.trim();
      const store=overlay.querySelector("#mmStore").value.trim();
      const planDate=overlay.querySelector("#mmDate").value;
      const planTime=overlay.querySelector("#mmTime").value;
      if(!id||!/^\d+$/.test(id)||!work||!store||!planDate||!planTime){
        showEmployeePopup({type:"error",title:"Faltan datos obligatorios",message:"Completa Código, Orden de trabajo, Tienda, Fecha prevista y Hora prevista.",primaryText:"Corregir"});
        return;
      }
      if(db.msr.some(o=>idNorm(o.id)===id)){
        showEmployeePopup({type:"warning",title:"La ID ya existe",message:`La ID ${id} ya está en el MSR actual. No se ha creado un duplicado.`,primaryText:"Entendido"});
        return;
      }
      const hadMemory=Boolean(db.states[id]);
      const order={
        id,description:work,store,
        loadOT:overlay.querySelector("#mmLoadOT").value.trim(),
        planDate,planTime,
        chain:overlay.querySelector("#mmChain").value.trim(),
        sourceStatus:overlay.querySelector("#mmSource").value.trim()||"Manual",
        manual:true,manualCreatedAt:nowISO()
      };
      db.msr.push(order);
      db.msr.sort((a,b)=>(`${a.planDate}${a.planTime}${a.id}`).localeCompare(`${b.planDate}${b.planTime}${b.id}`));
      stateFor(id);
      logAudit("msr",id,"Alta manual",{order}, "empleado");
      save();
      close();
      toast(hadMemory?"✅ ID creada y memoria histórica recuperada":"✅ ID manual creada");
      render();
    };
  }

  function openManualHceModal(){
    document.querySelector("#manualEntryModal")?.remove();
    const overlay=document.createElement("div");
    overlay.id="manualEntryModal";
    overlay.className="manual-entry-overlay";
    overlay.innerHTML=`<div class="manual-entry-shell">
      <div class="manual-entry-head">
        <div><span>➕ ALTA MANUAL</span><h2>Nuevo contenedor HCE</h2><p>Úsalo si un contenedor/entrada no aparece en el fichero.</p></div>
        <button id="manualEntryClose">✕</button>
      </div>
      <div class="manual-entry-form">
        <label>Matrícula / contenedor *<input id="mhNumber" placeholder="Ej. MSKU4731708"></label>
        <label>ID entrada<input id="mhEntry"></label>
        <label>Fecha prevista *<input id="mhDate" type="date"></label>
        <label>Hora prevista *<input id="mhTime" type="time"></label>
        <label>Transportista<input id="mhTransporter"></label>
        <label class="wide">Razón / descripción<input id="mhReason"></label>
      </div>
      <div class="manual-entry-actions">
        <button class="btn ghost" id="manualEntryCancel">Cancelar</button>
        <button class="btn primary" id="manualEntrySave">💾 Crear HCE</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close=()=>overlay.remove();
    overlay.querySelector("#manualEntryClose").onclick=close;
    overlay.querySelector("#manualEntryCancel").onclick=close;
    overlay.querySelector("#manualEntrySave").onclick=()=>{
      const number=overlay.querySelector("#mhNumber").value.trim().toUpperCase();
      const entryId=overlay.querySelector("#mhEntry").value.trim();
      const planDate=overlay.querySelector("#mhDate").value;
      const planTime=overlay.querySelector("#mhTime").value;
      if(!number||!planDate||!planTime){
        showEmployeePopup({type:"error",title:"Faltan datos obligatorios",message:"Completa Matrícula/contenedor, Fecha prevista y Hora prevista.",primaryText:"Corregir"});
        return;
      }
      const key=number;
      if(db.hce.some(x=>String(x.key||x.number||"").toUpperCase()===key)){
        showEmployeePopup({type:"warning",title:"El HCE ya existe",message:`${number} ya está cargado. No se ha creado un duplicado.`,primaryText:"Entendido"});
        return;
      }
      const item={
        key,number,entryId,entryIds:entryId?[entryId]:[],planDate,planTime,
        transporter:overlay.querySelector("#mhTransporter").value.trim(),
        reason:overlay.querySelector("#mhReason").value.trim(),
        plannedQty:0,lines:1,realDate:"",realTime:"",process:"Pendiente de recibir",
        updatedAt:null,manual:true,manualCreatedAt:nowISO()
      };
      db.hce.push(item);
      db.hce.sort((a,b)=>(`${a.planDate}${a.planTime}`).localeCompare(`${b.planDate}${b.planTime}`));
      logAudit("hce",key,"Alta manual",{item},"empleado");
      save();close();toast("✅ HCE manual creado");render();
    };
  }

  function renderResumen(){
    let rows=orderRows();
    if(summaryRolling48){
      const now=Date.now(),from=now-(48*60*60*1000);
      rows=rows.filter(({o})=>{
        const p=plannedFor(o);
        return p&&p.getTime()>=from&&p.getTime()<=now;
      });
    }else{
      if(summaryDateFrom)rows=rows.filter(({o})=>o.planDate&&o.planDate>=summaryDateFrom);
      if(summaryDateTo)rows=rows.filter(({o})=>o.planDate&&o.planDate<=summaryDateTo);
    }
    if(summaryShippingFilter!=="all")rows=rows.filter(({s})=>(s.shipping||"No")===summaryShippingFilter);
    if(summaryServalFilter!=="all")rows=rows.filter(({s})=>(s.serval||"No")===summaryServalFilter);
    if(summaryPickingFilter!=="all")rows=rows.filter(({s})=>(s.status||"Pendiente")===summaryPickingFilter);
    if(summaryTextFilter){
      const q=norm(summaryTextFilter);
      rows=rows.filter(({o,s})=>norm([o.id,o.description,o.store,s.comment,s.status].join(" ")).includes(q));
    }
    rows=sortSummaryRows(rows);
    const periodLabel=summaryRolling48
      ?"Últimas 48 horas"
      :summaryDateFrom||summaryDateTo
      ?`${summaryDateFrom?fmtDate(summaryDateFrom):"Inicio"} → ${summaryDateTo?fmtDate(summaryDateTo):"Actualidad"}`
      :"Todas las fechas";
    const totalFiltered=rows.length;
    const maxPage=Math.max(1,Math.ceil(totalFiltered/summaryPageSize));
    if(summaryPage>maxPage)summaryPage=maxPage;
    const visibleRows=rows.slice((summaryPage-1)*summaryPageSize,summaryPage*summaryPageSize);

    content.innerHTML=`
      <div class="panel" style="margin-top:0">
        <div class="panel-head">
          <div><h2>📊 Resumen MSR</h2><p>${totalFiltered} órdenes visibles de ${db.msr.length}. Los cambios se guardan automáticamente y se sincronizan en línea.</p></div>
          <div class="actions"><button class="btn primary" id="addManualMSRBtn">➕ Añadir ID manual</button><button class="btn ghost" id="resetSummaryFilters">🧹 Limpiar filtros</button><button class="btn danger-soft" id="clearMSRBtn">🗑️ Vaciar MSR</button></div>
        </div>
        <div class="operational-help msr-help">
          <div class="help-title">🧭 Guía rápida MSR</div>
          <div class="help-items">
            <span class="help-item info"><b>📦 Picking</b><small>Pendiente → En proceso → Finalizado.</small></span>
            <span class="help-item neutral"><b>⏳ No enviado</b><small>No ha salido mercancía de esta ID.</small></span>
            <span class="help-item partial"><b>🟠 Parcial</b><small>Ha salido una parte; queda resto pendiente.</small></span>
            <span class="help-item total"><b>✅ Total</b><small>Pedido completo enviado; no queda resto.</small></span>
          </div>
        </div>
        <div class="summary-period-panel">
          <div class="summary-period-title">
            <div><strong>📅 Periodo MSR</strong><small>${esc(periodLabel)}</small></div>
            <div class="summary-period-presets">
              <button class="btn ${!summaryRolling48&&summaryDateFrom===today()&&summaryDateTo===today()?"primary":"ghost"}" id="summaryToday">Hoy</button>
              <button class="btn ghost" id="summaryYesterday">Ayer</button>
              <button class="btn ${summaryRolling48?"primary":"ghost"}" id="summary48h">Últimas 48 h</button>
              <button class="btn ghost" id="summary7d">Últimos 7 días</button>
              <button class="btn ${!summaryRolling48&&!summaryDateFrom&&!summaryDateTo?"primary":"ghost"}" id="summaryAllDates">Todas</button>
            </div>
          </div>
          <div class="summary-period-inputs">
            <label>Desde<input id="summaryDateFrom" class="filter-input" type="date" value="${esc(summaryDateFrom)}" ${summaryRolling48?"disabled":""}></label>
            <span class="period-arrow">→</span>
            <label>Hasta<input id="summaryDateTo" class="filter-input" type="date" value="${esc(summaryDateTo)}" ${summaryRolling48?"disabled":""}></label>
          </div>
        </div>

        <div class="simple-filter-grid summary-filters">
          <label>Picking<select id="summaryPickingFilter" class="filter-input"><option value="all" ${summaryPickingFilter==="all"?"selected":""}>📦 Todos</option><option value="Pendiente" ${summaryPickingFilter==="Pendiente"?"selected":""}>📦 Pendiente</option><option value="En proceso" ${summaryPickingFilter==="En proceso"?"selected":""}>🔄 En proceso</option><option value="Finalizado" ${summaryPickingFilter==="Finalizado"?"selected":""}>✅ Finalizado</option></select></label>
          <label>Envío<select id="summaryShippingFilter" class="filter-input"><option value="all" ${summaryShippingFilter==="all"?"selected":""}>🚚 Todos</option><option value="No" ${summaryShippingFilter==="No"?"selected":""}>⏳ No enviado</option><option value="Parcial" ${summaryShippingFilter==="Parcial"?"selected":""}>🟠 Parcial</option><option value="Total" ${summaryShippingFilter==="Total"?"selected":""}>✅ Total</option></select></label>
          <label>Serval<select id="summaryServalFilter" class="filter-input"><option value="all" ${summaryServalFilter==="all"?"selected":""}>⚠️ Todos</option><option value="No" ${summaryServalFilter==="No"?"selected":""}>No</option><option value="Si" ${summaryServalFilter==="Si"?"selected":""}>🚨 Sí</option></select></label>
          <label>Buscar<input id="summaryTextFilter" class="filter-input" placeholder="Código, orden, tienda..." value="${esc(summaryTextFilter)}"></label>
          <label>Ordenar<select id="summarySortKey" class="filter-input"><option value="planDateTime" ${summarySortKey==="planDateTime"?"selected":""}>Fecha prevista</option><option value="id" ${summarySortKey==="id"?"selected":""}>Código</option><option value="store" ${summarySortKey==="store"?"selected":""}>Tienda</option><option value="shipping" ${summarySortKey==="shipping"?"selected":""}>Envío</option><option value="sendDateTime" ${summarySortKey==="sendDateTime"?"selected":""}>Expedición</option><option value="serval" ${summarySortKey==="serval"?"selected":""}>Serval</option></select></label>
          <label>Dirección<select id="summarySortDir" class="filter-input"><option value="asc" ${summarySortDir==="asc"?"selected":""}>↑ Ascendente</option><option value="desc" ${summarySortDir==="desc"?"selected":""}>↓ Descendente</option></select></label>
        </div>
        <div class="table-wrap operational-table-wrap">${tableOrders(visibleRows)}</div>
        ${pagerHtml("summary",summaryPage,summaryPageSize,totalFiltered)}
      </div>`;
  }

  function filterBtn(key,label){return `<button class="btn ${summaryFilter===key?"primary":"ghost"}" data-summary-filter="${esc(key)}">${label}</button>`}


  function hceProcessBadge(value){
    const v=value||"Pendiente de recibir";
    if(v==="Descargado")return '<span class="status-chip hce-done">✅ Descargado</span>';
    if(v==="Descargando")return '<span class="status-chip hce-downloading">🔄 Descargando</span>';
    if(v==="Posicionado")return '<span class="status-chip hce-positioned">📍 Posicionado</span>';
    return '<span class="status-chip hce-pending">⏳ Pendiente</span>';
  }

  function hceTiming(c){
    const p=dt(c.planDate,c.planTime);
    if(!p)return {label:"⚪ SIN PREVISIÓN",hours:null,kind:"gray",state:"unknown",level:0,detail:"No hay fecha/hora prevista"};
    const a=dt(c.realDate,c.realTime);
    const now=new Date();

    if(a){
      const diff=a-p;
      const hours=diff/36e5;
      const amount=exactDurationLabel(diff);
      if(diff<=0)return {label:`🟢 LLEGÓ A TIEMPO · ${amount} antes`,hours,kind:"green",state:"arrived-ontime",level:0,detail:`Llegada registrada ${fmtDate(c.realDate)} · ${fmtTime(c.realTime)}`};
      const level=hours>=24?4:hours>=8?3:hours>=2?2:1;
      return {label:`🔴 LLEGÓ TARDE · ${amount}`,hours,kind:"red",state:"arrived-late",level,detail:`Llegó ${amount} después de la hora prevista`};
    }

    const diff=now-p;
    const hours=diff/36e5;
    const amount=exactDurationLabel(diff);
    if(diff>0){
      const level=hours>=24?4:hours>=8?3:hours>=2?2:1;
      return {label:`🔴 AÚN NO HA LLEGADO · ${amount} de retraso`,hours,kind:"red",state:"missing-late",level,detail:`Previsto ${fmtDate(c.planDate)} · ${fmtTime(c.planTime)}`};
    }
    return {label:`🔵 AÚN NO HA LLEGADO · faltan ${amount}`,hours,kind:"blue",state:"missing-ontime",level:0,detail:`Previsto ${fmtDate(c.planDate)} · ${fmtTime(c.planTime)}`};
  }

  function hceComplianceCell(c){
    const info=hceTiming(c);
    const cls=info.kind==="green"?"hce-cmp-green":info.kind==="blue"?"hce-cmp-blue":info.kind==="red"?`hce-cmp-red-${info.level||1}`:"hce-cmp-gray";
    const subtitle=info.state==="arrived-late"
      ? "Llegada registrada · llegó después de la hora prevista"
      :info.state==="missing-late"
      ? "Todavía no ha llegado · el retraso sigue aumentando"
      :info.state==="arrived-ontime"
      ? "Llegada registrada · cumplimiento correcto"
      :info.state==="missing-ontime"
      ? "Todavía no ha llegado · aún está dentro del plazo"
      :"Sin cálculo";
    return `<div class="hce-compliance ${cls}">
      <strong>${esc(info.label)}</strong>
      <span>${esc(subtitle)}</span>
      <small>${esc(info.detail||"")}</small>
    </div>`;
  }

  function timeBadge(info){
    const cls=info.kind==="green"?"b-green":info.kind==="red"?"b-red":info.kind==="blue"?"b-blue":"b-gray";
    return `<span class="badge ${cls}">${esc(info.label)}</span>`;
  }

  function containerStatus(c){
    if(c.process==="Descargado")return "Descargado";
    if(c.process==="Descargando")return "Descargando";
    if(c.process==="Posicionado")return "Posicionado";
    const p=dt(c.planDate,c.planTime);
    return p && new Date()>p?"Retraso":"Pendiente de recibir";
  }
  function renderHCE(){
    let rows=db.hce.slice();
    if(hceDateFrom)rows=rows.filter(x=>x.planDate&&x.planDate>=hceDateFrom);
    if(hceDateTo)rows=rows.filter(x=>x.planDate&&x.planDate<=hceDateTo);
    if(hceProcessFilter!=="all")rows=rows.filter(x=>(x.process||"Pendiente de recibir")===hceProcessFilter);
    if(hceTimingFilter!=="all"){
      rows=rows.filter(x=>{
        const t=hceTiming(x);
        if(hceTimingFilter==="late")return t.kind==="red";
        if(hceTimingFilter==="ontime")return x.realDate&&x.realTime&&t.kind==="green";
        if(hceTimingFilter==="pending")return !(x.realDate&&x.realTime);
        return true;
      });
    }
    const hv=x=>{
      if(hceSortKey==="number")return x.number||"";
      if(hceSortKey==="process")return x.process||"";
      if(hceSortKey==="timing")return hceTiming(x).hours??0;
      return `${x.planDate||""} ${x.planTime||""}`;
    };
    rows.sort((a,b)=>{const va=hv(a),vb=hv(b);const cmp=typeof va==="number"?va-vb:String(va).localeCompare(String(vb),"es",{numeric:true});return hceSortDir==="desc"?-cmp:cmp;});

    const totalFiltered=rows.length;
    const maxPage=Math.max(1,Math.ceil(totalFiltered/hcePageSize));
    if(hcePage>maxPage)hcePage=maxPage;
    const visibleRows=rows.slice((hcePage-1)*hcePageSize,hcePage*hcePageSize);

    content.innerHTML=`
      <div class="panel" style="margin-top:0">
        <div class="panel-head">
          <div><h2>🚛 Contenedores HCE</h2><p>${totalFiltered} registros visibles de ${db.hce.length}. Registra la llegada antes de avanzar el estado.</p></div>
          <div class="actions"><button class="btn primary" id="addManualHCEBtn">➕ Añadir HCE manual</button><button class="btn ghost" id="resetHCEFilters">🧹 Limpiar filtros</button><button class="btn danger-soft" id="clearHCEBtn">🗑️ Vaciar HCE</button></div>
        </div>
        <div class="operational-help hce-help">
          <div class="help-title">🧭 Guía rápida HCE</div>
          <div class="help-items">
            <span class="help-item neutral"><b>⏳ Pendiente</b><small>Todavía no ha llegado.</small></span>
            <span class="help-item info"><b>📍 Posicionado</b><small>Ya llegó y está ubicado.</small></span>
            <span class="help-item purple"><b>🔄 Descargando</b><small>Descarga en curso.</small></span>
            <span class="help-item total"><b>✅ Descargado</b><small>Descarga finalizada.</small></span>
          </div>
        </div>
        <div class="simple-filter-grid hce-simple-filters">
          <label>Desde<input id="hceDateFrom" class="filter-input" type="date" value="${esc(hceDateFrom)}"></label>
          <label>Hasta<input id="hceDateTo" class="filter-input" type="date" value="${esc(hceDateTo)}"></label>
          <label>Estado<select id="hceProcessFilter" class="filter-input"><option value="all" ${hceProcessFilter==="all"?"selected":""}>📌 Todos</option><option value="Pendiente de recibir" ${hceProcessFilter==="Pendiente de recibir"?"selected":""}>⏳ Pendiente</option><option value="Posicionado" ${hceProcessFilter==="Posicionado"?"selected":""}>📍 Posicionado</option><option value="Descargando" ${hceProcessFilter==="Descargando"?"selected":""}>🔄 Descargando</option><option value="Descargado" ${hceProcessFilter==="Descargado"?"selected":""}>✅ Descargado</option></select></label>
          <label>Cumplimiento<select id="hceTimingFilter" class="filter-input"><option value="all" ${hceTimingFilter==="all"?"selected":""}>⏱ Todos</option><option value="ontime" ${hceTimingFilter==="ontime"?"selected":""}>🟢 A tiempo</option><option value="late" ${hceTimingFilter==="late"?"selected":""}>🔴 Retraso</option><option value="pending" ${hceTimingFilter==="pending"?"selected":""}>🔵 Sin llegada</option></select></label>
          <label>Ordenar<select id="hceSortKey" class="filter-input"><option value="planDateTime" ${hceSortKey==="planDateTime"?"selected":""}>Fecha + hora</option><option value="number" ${hceSortKey==="number"?"selected":""}>Matrícula</option><option value="process" ${hceSortKey==="process"?"selected":""}>Estado</option><option value="timing" ${hceSortKey==="timing"?"selected":""}>Cumplimiento</option></select></label>
          <label>Dirección<select id="hceSortDir" class="filter-input"><option value="asc" ${hceSortDir==="asc"?"selected":""}>↑ Ascendente</option><option value="desc" ${hceSortDir==="desc"?"selected":""}>↓ Descendente</option></select></label>
        </div>
        <div class="table-wrap operational-table-wrap">${tableHCE(visibleRows)}</div>
        ${pagerHtml("hce",hcePage,hcePageSize,totalFiltered)}
      </div>`;
  }

  function tableHCE(rows){
    if(!rows.length)return `<div class="empty">No hay contenedores HCE con estos filtros.</div>`;
    return `<table class="data-table hce-table simple-hce"><thead><tr><th>Cumplimiento</th><th>Matrícula</th><th>Fecha prevista</th><th>Hora prevista</th><th>Fecha llegada</th><th>Hora llegada</th><th>Estado</th></tr></thead>
      <tbody>${rows.map(x=>`<tr class="${hceRowClass(x)}">
        <td>${hceComplianceCell(x)}</td>
        <td><strong>${esc(x.number||x.entryId)}</strong></td>
        <td>${fmtDate(x.planDate)}</td>
        <td>${fmtTime(x.planTime)}</td>
        <td><input class="hce-edit hce-date" type="date" data-hce-key="${esc(x.key)}" data-hce-field="realDate" value="${esc(x.realDate||"")}"></td>
        <td><input class="hce-edit hce-time" type="time" data-hce-key="${esc(x.key)}" data-hce-field="realTime" value="${esc(x.realTime||"")}"></td>
        <td><select class="hce-edit hce-select ${stateSelectClass("hce",x.process||"Pendiente de recibir")}" data-hce-key="${esc(x.key)}" data-hce-field="process">${hceProcessOptions(x.process||"Pendiente de recibir")}</select></td>
      </tr>`).join("")}</tbody></table>`;
  }


  function renderImport(kind){
    const msr=kind==="msr";
    const when=msr?db.meta.msrImportedAt:db.meta.hceImportedAt;
    const count=msr?db.msr.length:db.hce.length;
    const report=db.meta?.lastImportReport;
    const showReport=report&&report.kind===kind;
    const issueList=showReport?[...(report.errors||[]).map(x=>({level:"error",...x})),...(report.warnings||[]).map(x=>({level:"warning",...x}))]:[];

    content.innerHTML=`
      <div class="panel import-panel" style="margin-top:0">
        <div class="panel-head">
          <div>
            <h2>📥 Importar ${msr?"MSR":"HCE"}</h2>
            <p>El sistema valida el fichero antes de terminar la carga y te avisa de líneas problemáticas.</p>
          </div>
          <button class="btn danger-soft" id="${msr?"clearMSRBtn":"clearHCEBtn"}">🧹 Limpiar ${msr?"MSR":"HCE"}</button>
        </div>

        <div class="workflow-guide">
          <div class="workflow-step"><b>1</b><span><strong>Limpiar</strong><small>Quita la planificación anterior</small></span></div>
          <div class="workflow-arrow">→</div>
          <div class="workflow-step"><b>2</b><span><strong>Importar</strong><small>Se valida línea por línea</small></span></div>
          <div class="workflow-arrow">→</div>
          <div class="workflow-step"><b>3</b><span><strong>Corregir</strong><small>Revisa avisos si aparecen</small></span></div>
          <div class="workflow-arrow">→</div>
          <div class="workflow-step"><b>4</b><span><strong>Gestionar</strong><small>Continúa con la operativa</small></span></div>
        </div>

        <div class="import-zone" id="dropZone">
          <div class="import-icon">📄</div>
          <h3>Arrastra aquí el archivo</h3>
          <p>.xlsx · .xls · .csv</p>
          <input type="file" id="fileInput" accept=".xlsx,.xls,.csv">
          <label class="btn primary upload-btn" for="fileInput">📥 Seleccionar archivo</label>
        </div>

        <div class="notice ${msr?"":"warn"}" style="margin-top:16px">
          ${msr
            ? `💾 <strong>Memoria activa:</strong> si una ID vuelve a aparecer, recupera automáticamente Envío, fecha/hora, Serval y comentario.`
            : `🚛 <strong>HCE:</strong> las líneas del mismo contenedor/matrícula se agrupan automáticamente.`}
        </div>

        ${showReport?`
          <div class="import-report ${report.errors?.length?"report-has-errors":"report-ok"}">
            <div class="import-report-head">
              <div>
                <strong>${report.errors?.length?"⚠️ Importación completada con incidencias":"✅ Importación revisada"}</strong>
                <small>${new Date(report.at).toLocaleString("es-ES")}</small>
              </div>
              <div class="import-report-kpis">
                <span>📄 ${report.totalRows} líneas</span>
                <span>✅ ${report.imported} importadas</span>
                <span>❌ ${report.errors?.length||0} errores</span>
                <span>⚠️ ${report.warnings?.length||0} avisos</span>
              </div>
            </div>
            ${issueList.length?`
              <div class="issue-list">
                ${issueList.slice(0,60).map(x=>{const i=importIssueFix(x,kind);return `<div class="issue-item ${x.level}"><b>${x.level==="error"?"❌":"⚠️"} Línea ${i.line}</b><span><strong>${esc(i.problem)}</strong><small>→ ${esc(i.fix)}</small></span>${i.value?`<code>${esc(i.value)}</code>`:""}</div>`}).join("")}
                ${issueList.length>60?`<div class="issue-more">… y ${issueList.length-60} incidencias más. Descarga el diagnóstico desde Datos / copias.</div>`:""}
              </div>`:"<div class=\"import-clean\">No se han detectado errores en las líneas importadas.</div>"}
            <div class="actions import-report-actions">
              <button class="btn primary" data-go="${msr?"resumen":"hce"}">Continuar → ${msr?"Resumen MSR":"HCE"}</button>
              <button class="btn ghost" id="clearImportReport">Ocultar informe</button>
            </div>
          </div>`:""}

        <div class="preview import-meta">
          <span><strong>🕒 Última importación:</strong> ${when?new Date(when).toLocaleString("es-ES"):"Nunca"}</span>
          <span><strong>📦 Registros actuales:</strong> ${count}</span>
          ${msr?`<span><strong>💾 IDs con memoria:</strong> ${Object.keys(db.states).length}</span>`:""}
        </div>
      </div>`;
  }

  function memoryRowsHtml(){
    const activeMap=new Map(db.msr.map(o=>[idNorm(o.id),o]));
    const ids=Object.keys(db.states||{}).sort((a,b)=>String(a).localeCompare(String(b),"es",{numeric:true}));
    if(!ids.length)return '<div class="history-empty">Todavía no hay IDs guardadas en memoria.</div>';
    return `<div class="memory-table-wrap">
      <table class="data-table memory-table">
        <thead><tr><th>ID</th><th>Situación</th><th>Picking</th><th>Envío</th><th>Serval</th><th>Último cambio</th><th>Acción</th></tr></thead>
        <tbody>${ids.map(id=>{
          const s=stateFor(id),active=activeMap.get(id);
          const search=norm([id,active?.description,active?.store,s.status,s.shipping,s.serval,s.comment].join(" "));
          return `<tr class="${active?"memory-active":"memory-orphan"}" data-memory-row data-memory-search="${esc(search)}" data-memory-active="${active?"1":"0"}">
            <td><strong>${esc(id)}</strong></td>
            <td>${active?'<span class="memory-state active">🟢 Activa</span>':'<span class="memory-state orphan">💾 Solo memoria</span>'}</td>
            <td>${pickingBadge(s.status||"Pendiente")}</td>
            <td>${msrShippingBadge(s.shipping||"No")}</td>
            <td>${servalBadge(s.serval||"No")}</td>
            <td>${s.updatedAt?new Date(s.updatedAt).toLocaleString("es-ES"):"—"}</td>
            <td><button class="btn ghost memory-open-btn" data-memory-open="${esc(id)}">✏️ Revisar</button></td>
          </tr>`;
        }).join("")}</tbody>
      </table>
    </div>`;
  }

  function renderMemoryAdminEditor(id){
    const k=idNorm(id),s=db.states?.[k];
    const target=document.querySelector("#adminEditorResult");
    if(!target)return;
    if(!s){
      target.className="admin-editor-empty";
      target.innerHTML=`<span>❌</span><strong>No existe memoria para la ID ${esc(k)}</strong>`;
      return;
    }
    const active=db.msr.find(o=>idNorm(o.id)===k);
    const history=(db.meta.auditLog||[]).filter(x=>x.entityType==="msr"&&idNorm(x.id)===k).slice(0,12);
    target.className="admin-editor-card";
    target.innerHTML=`
      <div class="admin-editor-title">
        <div><span>💾 MEMORIA MSR</span><h3>ID ${esc(k)}</h3><small>${active?"La ID está activa en el MSR actual.":"La ID no está activa; solo conserva su estado histórico."}</small></div>
        <span class="admin-editor-status">${active?"🟢 Activa":"💾 Solo memoria"}</span>
      </div>
      <div class="admin-form-grid">
        <label>Picking<select id="amPicking">${pickingOptions(s.status||"Pendiente")}</select></label>
        <label>Envío<select id="amShipping">${shippingOptions(s.shipping||"No")}</select></label>
        <label>Fecha expedición<input id="amDate" type="date" value="${esc(s.date||"")}"></label>
        <label>Hora expedición<input id="amTime" type="time" value="${esc(s.time||"")}"></label>
        <label>Serval<select id="amServal">${msrOptions(s.serval||"No",["No","Si"])}</select></label>
        <label class="wide">Comentario<textarea id="amComment" rows="3">${esc(s.comment||"")}</textarea></label>
      </div>
      <div class="admin-editor-actions">
        <button class="btn primary" id="adminSaveMemory" data-id="${esc(k)}">💾 Guardar memoria</button>
        ${active?`<button class="btn ghost" id="adminOpenActiveMsr" data-id="${esc(k)}">📦 Abrir ficha MSR completa</button>`:""}
        <button class="btn danger-soft" id="adminTrashMemory" data-id="${esc(k)}">🗑️ Enviar memoria a papelera</button>
      </div>
      <div class="entity-history">
        <h4>🕘 Historial de esta ID</h4>
        ${history.length?history.map(x=>`<div class="history-item"><strong>${new Date(x.at).toLocaleString("es-ES")} · ${esc(x.action)}</strong><small>${esc(x.source||"")}</small></div>`).join(""):'<div class="history-empty">Sin historial registrado.</div>'}
      </div>`;
    const saveBtn=target.querySelector("#adminSaveMemory");
    saveBtn.onclick=()=>{
      const before={...s};
      const serval=target.querySelector("#amServal").value;
      const comment=target.querySelector("#amComment").value.trim();
      if(serval==="Si"&&!comment){toast("Serval = Sí requiere comentario",true);return;}
      const shipping=target.querySelector("#amShipping").value;
      const date=target.querySelector("#amDate").value,time=target.querySelector("#amTime").value;
      if(shipping!=="No"&&(!date||!time)){toast("Envío Parcial/Total requiere fecha y hora",true);return;}
      makeAdminSnapshot(`Antes de editar memoria ${k}`);
      s.status=target.querySelector("#amPicking").value;s.shipping=shipping;s.date=date;s.time=time;s.serval=serval;s.comment=comment;s.updatedAt=nowISO();
      logAudit("msr",k,"Edición memoria admin",{before,after:{...s}},"admin");
      save();toast("✅ Memoria actualizada");renderMemoryAdminEditor(k);
    };
    const activeBtn=target.querySelector("#adminOpenActiveMsr");if(activeBtn)activeBtn.onclick=()=>renderMsrAdminEditor(k);
    const trashBtn=target.querySelector("#adminTrashMemory");if(trashBtn)trashBtn.onclick=()=>{
      if(!confirm(`¿Enviar la memoria de ID ${k} a la papelera?`))return;
      makeAdminSnapshot(`Antes de borrar memoria ID ${k}`);
      pushTrash({type:"msr-memory",id:k,state:{...s}});delete db.states[k];
      logAudit("msr",k,"Memoria enviada a papelera",{},"admin");
      save();toast("Memoria enviada a papelera");renderAdminModal();
    };
  }

  function decodeTextSmart(bytes){
    const utf=new TextDecoder("utf-8").decode(bytes);
    const win=new TextDecoder("windows-1252").decode(bytes);
    const score=s=>{
      const replacement=(s.match(/�/g)||[]).length*20;
      const mojibake=(s.match(/Ã.|Â.|â€|â€™|â€œ|â€/g)||[]).length*5;
      return replacement+mojibake;
    };
    return score(utf)<=score(win)?{text:utf,encoding:"UTF-8"}:{text:win,encoding:"Windows-1252"};
  }

  function detectCsvDelimiter(text){
    const line=String(text||"").split(/\r?\n/).find(x=>x.trim())||"";
    const counts={";":0,",":0,"\t":0};
    let quoted=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"')quoted=!quoted;
      else if(!quoted&&Object.prototype.hasOwnProperty.call(counts,ch))counts[ch]++;
    }
    return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[1]>0?Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0]:";";
  }

  function parseDelimitedText(text,delimiter=";"){
    const rows=[];let row=[],field="",quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(ch==='"'){
        if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;
      }else if(ch===delimiter&&!quoted){row.push(field);field="";
      }else if((ch==="\n"||ch==="\r")&&!quoted){
        if(ch==="\r"&&text[i+1]==="\n")i++;
        row.push(field);field="";rows.push(row);row=[];
      }else field+=ch;
    }
    if(field!==""||row.length){row.push(field);rows.push(row);}
    return rows;
  }

  function normalizeRepairRows(rows){
    const source=Array.isArray(rows)?rows:[];
    const originalNonEmpty=source.filter(r=>Array.isArray(r)&&r.some(v=>String(v??"").trim()!==""));
    const removedEmpty=Math.max(0,source.length-originalNonEmpty.length);
    const originalWidths=originalNonEmpty.map(r=>r.length);
    let clean=originalNonEmpty.map(r=>r.map(v=>v==null?"":String(v)));
    if(!clean.length)return {rows:[],changes:["Archivo sin datos útiles"],issues:["No se encontraron filas con contenido."]};

    let max=0;
    clean.forEach(r=>{for(let i=r.length-1;i>=0;i--){if(String(r[i]).trim()!==""){max=Math.max(max,i+1);break;}}});
    const changes=[],issues=[];
    if(removedEmpty)changes.push(`Se eliminaron ${removedEmpty} fila(s) completamente vacías.`);
    if(new Set(originalWidths).size>1)issues.push("Las filas tenían distinto número de columnas; se han igualado.");
    clean=clean.map(r=>Array.from({length:max},(_,i)=>String(r[i]??"").trim()));

    const originalHeader=clean[0]||[];
    const seen=new Map();
    const header=originalHeader.map((v,i)=>{
      let h=String(v||"").trim().replace(/^\uFEFF/,"");
      if(!h){h=`Columna_${i+1}`;changes.push(`Cabecera vacía en columna ${i+1} → ${h}`);}
      const key=norm(h)||`columna ${i+1}`;
      const n=(seen.get(key)||0)+1;seen.set(key,n);
      if(n>1){const renamed=`${h}_${n}`;changes.push(`Cabecera duplicada "${h}" → "${renamed}"`);h=renamed;}
      return h;
    });
    clean[0]=header;
    return {rows:clean,changes:[...new Set(changes)],issues:[...new Set(issues)]};
  }

  function csvEscape(v){const s=String(v??"");return /[;"\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
  function rowsToCsv(rows){return "\uFEFF"+rows.map(r=>r.map(csvEscape).join(";")).join("\r\n")}

  async function openFileDoctor(file){
    if(!file)return;
    try{
      let rows=[],sourceType="",sheetName="",encoding="";
      const name=String(file.name||"archivo");
      if(/\.csv$/i.test(name)||/\.txt$/i.test(name)){
        sourceType="CSV/TXT";
        const buf=await file.arrayBuffer();
        const bytes=new Uint8Array(buf);
        const decoded=decodeTextSmart(bytes);
        const txt=decoded.text;encoding=decoded.encoding;
        const delim=detectCsvDelimiter(txt);
        rows=parseDelimitedText(txt,delim);
      }else{
        if(!window.XLSX)throw new Error("El lector Excel no está disponible.");
        sourceType="Excel";
        const buf=await file.arrayBuffer();
        const wb=XLSX.read(buf,{type:"array",cellDates:true});
        sheetName=wb.SheetNames[0]||"";
        if(!sheetName)throw new Error("El Excel no contiene hojas.");
        rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:"",raw:false});
      }
      const normalized=normalizeRepairRows(rows);
      showFileDoctorResult({file,name,sourceType,sheetName,encoding,originalRows:rows,rows:normalized.rows,changes:normalized.changes,issues:normalized.issues});
    }catch(err){
      recordAppError(err,"file-doctor");
      showEmployeePopup({type:"error",title:"No se ha podido analizar el archivo",message:err?.message||"Archivo no reconocido.",details:["El archivo original no se ha modificado.","Prueba a abrirlo y guardarlo de nuevo como XLSX o CSV UTF-8."],primaryText:"Entendido"});
    }
  }

  function showFileDoctorResult(r){
    document.querySelector("#fileDoctorModal")?.remove();
    const overlay=document.createElement("div");
    overlay.id="fileDoctorModal";overlay.className="admin-modal-overlay";
    const rows=r.rows||[],header=rows[0]||[],data=rows.slice(1);
    const msrRecognized=findHeader(header,["Código","Codigo"])>=0;
    const hceRecognized=findHeader(header,["MATRÍCULA","Matricula","ID ENTRADA"])>=0;
    const inconsistent=(r.originalRows||[]).filter(x=>Array.isArray(x)&&x.length!==header.length).length;
    overlay.innerHTML=`<div class="file-doctor-shell">
      <div class="admin-modal-head">
        <div><div class="admin-modal-eyebrow">🧰 REPARADOR DE ARCHIVOS</div><h2>${esc(r.name)}</h2><p>Diagnóstico seguro: el original no se modifica.</p></div>
        <button class="admin-modal-close" id="fileDoctorClose">✕</button>
      </div>
      <div class="file-doctor-body">
        <div class="admin-section-summary">
          <div><b>📄 ${data.length}</b><span>Filas de datos</span></div>
          <div><b>🧱 ${header.length}</b><span>Columnas</span></div>
          <div><b>⚠️ ${inconsistent+r.issues.length}</b><span>Problemas detectados</span></div>
          <div><b>${msrRecognized?"📦":hceRecognized?"🚛":"❔"}</b><span>${msrRecognized?"Formato MSR reconocido":hceRecognized?"Formato HCE reconocido":"Formato genérico"}</span></div>
        </div>
        <div class="file-doctor-info">
          <span><strong>Tipo:</strong> ${esc(r.sourceType)}</span>
          ${r.sheetName?`<span><strong>Hoja:</strong> ${esc(r.sheetName)}</span>`:""}
          ${r.encoding?`<span><strong>Codificación:</strong> ${esc(r.encoding)}</span>`:""}
        </div>
        <div class="file-doctor-columns"><strong>Cabeceras detectadas</strong><div>${header.map(h=>`<span>${esc(h)}</span>`).join("")}</div></div>
        <div class="file-doctor-findings">
          <h3>🔎 Qué se ha corregido / detectado</h3>
          ${[...r.changes,...r.issues].length?[...r.changes.map(x=>"✅ "+x),...r.issues.map(x=>"⚠️ "+x)].map(x=>`<div>${esc(x)}</div>`).join(""):'<div class="import-clean">✅ Estructura básica correcta. No ha sido necesario reparar cabeceras.</div>'}
        </div>
        <div class="manual-entry-note">🛡️ Descargar una copia reparada no cambia MSR/HCE. Después puedes importarla normalmente y revisar la previsualización segura.</div>
      </div>
      <div class="file-doctor-actions">
        <button class="btn ghost" id="doctorCsv">⬇️ Descargar CSV reparado</button>
        ${window.XLSX?'<button class="btn ghost" id="doctorXlsx">⬇️ Descargar Excel reparado</button>':""}
        ${msrRecognized||hceRecognized?'<button class="btn primary" id="doctorPreview">🔎 Previsualizar importación</button>':""}
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close=()=>overlay.remove();
    overlay.querySelector("#fileDoctorClose").onclick=close;
    overlay.querySelector("#doctorCsv").onclick=()=>download(`reparado_${r.name.replace(/\.[^.]+$/,"")}.csv`,rowsToCsv(rows),"text/csv;charset=utf-8");
    const xb=overlay.querySelector("#doctorXlsx");if(xb)xb.onclick=()=>{
      const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,"Reparado");XLSX.writeFile(wb,`reparado_${r.name.replace(/\.[^.]+$/,"")}.xlsx`);
    };
    const preview=overlay.querySelector("#doctorPreview");if(preview)preview.onclick=()=>{
      try{
        const p=msrRecognized?buildMSRPreview(header,data,r.name):buildHCEPreview(header,data,r.name);
        close();showImportPreview(p);
      }catch(err){showEmployeePopup({type:"error",title:"No se puede previsualizar",message:err.message,primaryText:"Entendido"});}
    };
  }

  function renderDatos(){
    const orphanStates=Object.keys(db.states||{}).filter(id=>!db.msr.some(o=>idNorm(o.id)===id)).length;
    const undo=(()=>{try{return JSON.parse(localStorage.getItem(ADMIN_UNDO_KEY)||"null")}catch{return null}})();

    content.innerHTML=`
      <div class="grid two-col">
        <div class="panel" style="margin-top:0">
          <div class="panel-head"><div><h2>💾 Copias y recuperación</h2><p>Antes de cambios importantes, guarda una copia.</p></div></div>
          <div class="actions">
            <button class="btn primary" id="backupBtn">⬇️ Descargar backup</button>
            <button class="btn ghost" id="restoreBtn">⬆️ Restaurar backup</button>
          </div>
          <input id="restoreInput" type="file" accept=".json" hidden>
          <div class="admin-mini-info">${undo?`↩️ Último punto de recuperación: ${new Date(undo.at).toLocaleString("es-ES")} · ${esc(undo.reason||"Cambio admin")}`:"ℹ️ Todavía no hay punto de recuperación admin."}</div>
        </div>

        <div class="panel" style="margin-top:0">
          <div class="panel-head"><div><h2>☁️ Estado del sistema</h2><p>Resumen de datos compartidos.</p></div></div>
          <div class="system-kpis">
            <div><b>📦 ${db.msr.length}</b><span>MSR activas</span></div>
            <div><b>💾 ${Object.keys(db.states||{}).length}</b><span>IDs en memoria</span></div>
            <div><b>🧹 ${orphanStates}</b><span>Memorias no activas</span></div>
            <div><b>🚛 ${db.hce.length}</b><span>HCE actuales</span></div>
          </div>
          <div class="actions" style="margin-top:12px">
            <button class="btn ghost" id="networkDiagBtn">🌐 Diagnóstico de red</button>
          </div>
        </div>
      </div>

      ${adminNotice?`<div class="admin-result"><strong>ℹ️ Resultado administrador</strong><pre>${esc(adminNotice)}</pre></div>`:""}

      ${db.meta?.lastImportReport?`
      <div class="panel import-audit-panel">
        <div class="panel-head">
          <div>
            <h2>🧾 Último control de importación</h2>
            <p>${db.meta.lastImportReport.kind==="msr"?"MSR":"HCE"} · ${new Date(db.meta.lastImportReport.at).toLocaleString("es-ES")}</p>
          </div>
          <span class="admin-badge">${(db.meta.lastImportReport.errors?.length||0)+(db.meta.lastImportReport.warnings?.length||0)} incidencias</span>
        </div>
        <div class="system-kpis">
          <div><b>📄 ${db.meta.lastImportReport.totalRows||0}</b><span>Líneas leídas</span></div>
          <div><b>✅ ${db.meta.lastImportReport.imported||0}</b><span>Registros importados</span></div>
          <div><b>❌ ${db.meta.lastImportReport.errors?.length||0}</b><span>Errores</span></div>
          <div><b>⚠️ ${db.meta.lastImportReport.warnings?.length||0}</b><span>Avisos</span></div>
        </div>
        ${(db.meta.lastImportReport.errors?.length||db.meta.lastImportReport.warnings?.length)?`
          <div class="issue-list admin-issue-list">
            ${[...(db.meta.lastImportReport.errors||[]).map(x=>({level:"error",...x})),...(db.meta.lastImportReport.warnings||[]).map(x=>({level:"warning",...x}))].slice(0,30).map(x=>{const i=importIssueFix(x,db.meta.lastImportReport.kind);return `<div class="issue-item ${x.level}"><b>${x.level==="error"?"❌":"⚠️"} Línea ${i.line}</b><span><strong>${esc(i.problem)}</strong><small>→ ${esc(i.fix)}</small></span>${i.value?`<code>${esc(i.value)}</code>`:""}</div>`}).join("")}
          </div>`:"<div class=\"import-clean\">Sin incidencias en la última importación.</div>"}
      </div>`:""}

      <div class="panel memory-panel">
        <div class="panel-head">
          <div><h2>💾 Memoria de IDs MSR</h2><p>Estados guardados que reaparecen cuando vuelves a importar una ID. Las IDs no activas siguen conservando su histórico.</p></div>
          <span class="admin-badge">${Object.keys(db.states||{}).length} guardadas</span>
        </div>
        <div class="memory-toolbar">
          <input id="memorySearch" class="filter-input" placeholder="🔎 Buscar ID, tienda, estado, comentario…">
          <label class="memory-check"><input id="memoryOnlyOrphans" type="checkbox"> Solo memorias no activas</label>
          <button class="btn ghost" id="memoryExportBtn">📤 Exportar memorias</button>
        </div>
        ${memoryRowsHtml()}
      </div>

      <div class="panel admin-panel admin-launcher">
        <div class="panel-head">
          <div>
            <h2>🔐 Centro de administrador</h2>
            <p>Entra por categoría. Dentro tendrás todas las herramientas relacionadas, sin botones dispersos.</p>
          </div>
          <span class="admin-badge">Acceso protegido</span>
        </div>

        <div class="admin-category-grid">
          <button class="admin-category edit" data-admin-open="edit">
            <span class="admin-category-icon">✏️</span>
            <div><strong>Buscar y editar datos</strong><small>MSR por ID · HCE por matrícula · estados · fechas · tienda · comentarios</small></div>
            <b>→</b>
          </button>
          <button class="admin-category repair" data-admin-open="repair">
            <span class="admin-category-icon">🛠️</span>
            <div><strong>Errores y reparación</strong><small>Incidencias de importación · duplicados · normalización · diagnóstico</small></div>
            <b>→</b>
          </button>
          <button class="admin-category cloud" data-admin-open="cloud">
            <span class="admin-category-icon">☁️</span>
            <div><strong>Nube, copias y recuperación</strong><small>Forzar sincronización · backups · restaurar · deshacer cambios</small></div>
            <b>→</b>
          </button>
          <button class="admin-category danger" data-admin-open="danger">
            <span class="admin-category-icon">🗑️</span>
            <div><strong>Borrados y limpieza</strong><small>Borrar memoria de ID · ID completa · vaciar MSR/HCE · limpieza avanzada</small></div>
            <b>→</b>
          </button>
        </div>
      </div>

      <div class="admin-safety-strip">
        <span>🛡️</span>
        <div><strong>Protección activa</strong><small>Las acciones destructivas crean un punto de recuperación y requieren confirmación.</small></div>
      </div>`;
  }

  function makeAdminSnapshot(reason){
    try{
      localStorage.setItem(ADMIN_UNDO_KEY,JSON.stringify({reason,at:nowISO(),db}));
    }catch(err){console.warn("Admin snapshot",err);}
  }

  function adminStateSummary(id){
    const k=idNorm(id);
    const s=db.states?.[k];
    const active=db.msr.find(o=>idNorm(o.id)===k);
    if(!s&&!active)return null;
    return {
      id:k,
      active:Boolean(active),
      order:active?.description||"",
      store:active?.store||"",
      shipping:s?.shipping||"No",
      date:s?.date||"",
      time:s?.time||"",
      serval:s?.serval||"No",
      comment:s?.comment||"",
      updatedAt:s?.updatedAt||null
    };
  }

  async function openAdminCenter(section="edit"){
    const validSession=adminSession && Date.now()<adminSessionUntil;
    if(!validSession){
      adminSession=false;
      if(!(await adminAuth()))return;
      adminSession=true;
      adminSessionUntil=Date.now()+(15*60*1000);
    }else{
      adminSessionUntil=Date.now()+(15*60*1000);
    }
    adminModalSection=section;
    renderAdminModal();
  }

  function closeAdminCenter(){
    adminModalSection=null;
    document.querySelector("#adminModal")?.remove();
  }

  function adminModalHeader(title,subtitle){
    return `<div class="admin-modal-head">
      <div>
        <div class="admin-modal-eyebrow">🔐 CENTRO DE ADMINISTRADOR</div>
        <h2>${title}</h2>
        <p>${subtitle}</p>
      </div>
      <button class="admin-modal-close" id="adminModalClose" aria-label="Cerrar">✕</button>
    </div>`;
  }

  function adminEditPanel(){
    return `
      <div class="admin-editor-search">
        <div>
          <label>Código / ID MSR</label>
          <div class="admin-search-row">
            <input id="adminMsrSearch" class="filter-input" placeholder="Ej. 282">
            <button class="btn primary" id="adminMsrSearchBtn">🔎 Buscar MSR</button>
          </div>
        </div>
        <div>
          <label>Matrícula / contenedor HCE</label>
          <div class="admin-search-row">
            <input id="adminHceSearch" class="filter-input" placeholder="Ej. MSKU4731708">
            <button class="btn primary" id="adminHceSearchBtn">🔎 Buscar HCE</button>
          </div>
        </div>
      </div>
      <div id="adminEditorResult" class="admin-editor-empty">
        <span>👆</span>
        <strong>Busca una ID o matrícula</strong>
        <small>Se abrirá un formulario completo con todos sus datos editables.</small>
      </div>`;
  }

  function adminRepairPanel(){
    const r=db.meta?.lastImportReport;
    const issues=r?[...(r.errors||[]).map(x=>({level:"error",...x})),...(r.warnings||[]).map(x=>({level:"warning",...x}))]:[];
    const importHistory=(db.meta.importHistory||[]).slice(0,10);
    return `
      <div class="admin-section-summary">
        <div><b>🧪 ${r?issues.length:0}</b><span>Incidencias última importación</span></div>
        <div><b>💾 ${Object.keys(db.states||{}).length}</b><span>Memorias guardadas</span></div>
        <div><b>📦 ${db.msr.length}</b><span>MSR actuales</span></div>
        <div><b>🚛 ${db.hce.length}</b><span>HCE actuales</span></div>
      </div>
      <div class="admin-tool-row">
        <button class="admin-tool-card" data-admin-run="repair"><span>🛠️</span><strong>Reparar estructura</strong><small>Normaliza IDs y elimina duplicados internos</small></button>
        <button class="admin-tool-card" data-admin-run="diag"><span>🧪</span><strong>Descargar diagnóstico</strong><small>Exporta datos e incidencias para revisión</small></button>
        <button class="admin-tool-card" data-admin-run="export-memory"><span>📤</span><strong>Exportar memoria</strong><small>Copia de todos los estados históricos MSR</small></button>
        <button class="admin-tool-card featured" id="adminFileDoctorBtn"><span>🧰</span><strong>Reparar Excel / CSV</strong><small>Analiza un archivo roto, normaliza filas/cabeceras y crea una copia reparada</small></button>
        <button class="admin-tool-card" data-admin-run="health-check"><span>🩺</span><strong>Chequeo integral</strong><small>Busca IDs duplicadas, estados inválidos, fechas incompletas y problemas de memoria</small></button>
      </div>
      <input id="adminFileDoctorInput" type="file" accept=".xlsx,.xls,.csv,.txt" hidden>
      <div class="admin-modal-subsection">
        <h3>🧾 Incidencias de la última importación</h3>
        ${!r?`<div class="admin-editor-empty compact"><span>✅</span><strong>No hay informe reciente</strong></div>`
        :!issues.length?`<div class="import-clean">✅ La última importación no tuvo incidencias.</div>`
        :`<div class="issue-list admin-modal-issues">${issues.slice(0,100).map(x=>{const i=importIssueFix(x,r?.kind||"msr");return `
          <div class="issue-item ${x.level}">
            <b>${x.level==="error"?"❌":"⚠️"} Línea ${i.line}</b>
            <span><strong>${esc(i.problem)}</strong><small>→ ${esc(i.fix)}</small></span>
            ${i.value?`<code>${esc(i.value)}</code>`:""}
          </div>`}).join("")}</div>`}
      </div>
      <div class="admin-modal-subsection">
        <h3>🩺 Errores técnicos recientes</h3>
        ${(db.meta.errorLog||[]).length?`<div class="tech-error-list">${(db.meta.errorLog||[]).slice(0,20).map(x=>`
          <div class="tech-error-item"><strong>${new Date(x.at).toLocaleString("es-ES")} · ${esc(x.context||"app")}</strong><small>${esc(x.message||"Error")}</small></div>
        `).join("")}</div>`:"<div class=\"history-empty\">No hay errores técnicos registrados.</div>"}
      </div>
      <div class="admin-modal-subsection">
        <h3>📚 Historial de importaciones</h3>
        ${importHistory.length?`<div class="import-history-list">${importHistory.map(x=>`
          <div class="import-history-item">
            <div><strong>${x.kind==="msr"?"📦 MSR":"🚛 HCE"} · ${new Date(x.at).toLocaleString("es-ES")}</strong><small>${esc(x.fileName||"Archivo")} · ${x.imported||0} registros</small></div>
            <div class="import-history-stats"><span>❌ ${x.errors?.length||0}</span><span>⚠️ ${x.warnings?.length||0}</span><span>🆕 ${x.comparison?.newCount||0}</span><span>✏️ ${x.comparison?.changed||0}</span></div>
          </div>`).join("")}</div>`:"<div class=\"history-empty\">Aún no hay importaciones registradas.</div>"}
      </div>`;
  }

  function getCloudConflict(){
    try{return JSON.parse(localStorage.getItem(CLOUD_CONFLICT_KEY)||"null")}catch{return null}
  }

  function clearCloudConflict(){
    localStorage.removeItem(CLOUD_CONFLICT_KEY);
    cloudConflictActive=false;
  }

  function adminCloudPanel(){
    const undo=(()=>{try{return JSON.parse(localStorage.getItem(ADMIN_UNDO_KEY)||"null")}catch{return null}})();
    const conflict=getCloudConflict();
    return `
      <div class="admin-section-summary">
        <div><b>${cloudStatus==="online"?"🟢":cloudStatus==="error"?"🔴":"🟠"}</b><span>${cloudStatus==="online"?"Nube conectada":cloudStatus==="error"?"Revisar sincronización":"Comprobando nube"}</span></div>
        <div><b>🕒</b><span>Última sync: ${formatSyncTime(lastSyncAt)}</span></div>
        <div><b>↩️</b><span>${undo?new Date(undo.at).toLocaleString("es-ES"):"Sin recuperación"}</span></div>
        <div><b>${conflict?"⚠️":"✅"}</b><span>${conflict?"Conflicto pendiente":"Sin conflictos guardados"}</span></div>
      </div>

      ${conflict?`<div class="cloud-conflict-card">
        <div><strong>⚠️ Conflicto entre dispositivos</strong><small>Detectado ${new Date(conflict.at).toLocaleString("es-ES")}. Ninguna copia se ha eliminado.</small></div>
        <div class="cloud-conflict-actions">
          <button class="btn ghost" id="restoreConflictLocal">💻 Conservar copia local</button>
          <button class="btn primary" id="restoreConflictRemote">☁️ Usar copia de la nube</button>
          <button class="btn danger-soft" id="discardConflict">Cerrar aviso</button>
        </div>
      </div>`:""}

      <div class="admin-tool-row">
        <button class="admin-tool-card" data-admin-run="pull"><span>☁️⬇️</span><strong>Nube → dispositivo</strong><small>Descargar la copia compartida</small></button>
        <button class="admin-tool-card" data-admin-run="push"><span>☁️⬆️</span><strong>Dispositivo → nube</strong><small>Forzar esta copia a todos</small></button>
        <button class="admin-tool-card" id="adminBackupBtn"><span>💾</span><strong>Descargar backup</strong><small>JSON completo de seguridad</small></button>
        <button class="admin-tool-card" id="adminRestoreBtn"><span>📥</span><strong>Restaurar backup</strong><small>Sustituir datos con una copia guardada</small></button>
        <button class="admin-tool-card" data-admin-run="restore-undo"><span>↩️</span><strong>Deshacer último cambio admin</strong><small>Volver al punto automático anterior</small></button>
      </div>
      <input id="adminRestoreInput" type="file" accept=".json" hidden>`;
  }

  function adminDangerPanel(){
    const active=new Set(db.msr.map(o=>idNorm(o.id)));
    const orphan=Object.keys(db.states||{}).filter(id=>!active.has(id)).length;
    const trash=(db.meta.trash||[]).slice(0,20);
    return `
      <div class="admin-danger-banner">🚨 Estas herramientas eliminan datos. Los borrados individuales se guardan en Papelera y las acciones masivas crean un punto de recuperación.</div>
      <div class="admin-danger-search">
        <label>Borrar por ID concreta</label>
        <div class="admin-search-row">
          <input id="adminDeleteId" class="filter-input" placeholder="Código / ID MSR">
          <button class="btn danger-soft" id="adminDeleteMemoryBtn">🧹 Solo memoria</button>
          <button class="btn danger" id="adminDeleteFullBtn">🗑️ ID completa</button>
        </div>
      </div>
      <div class="admin-tool-row">
        <button class="admin-tool-card danger" data-admin-run="purge-orphans"><span>♻️</span><strong>Memorias no activas</strong><small>Borrar ${orphan} estados de IDs fuera del MSR actual</small></button>
        <button class="admin-tool-card danger" data-admin-run="clear-msr"><span>📦</span><strong>Vaciar MSR</strong><small>Conserva memoria histórica</small></button>
        <button class="admin-tool-card danger" data-admin-run="clear-hce"><span>🚛</span><strong>Vaciar HCE</strong><small>Elimina planificación HCE actual</small></button>
        <button class="admin-tool-card nuclear" id="adminNuclearBtn"><span>☢️</span><strong>Borrado total</strong><small>MSR + HCE + memorias + nube</small></button>
      </div>
      <div class="admin-modal-subsection">
        <h3>🗑️ Papelera · últimos borrados</h3>
        ${trash.length?`<div class="trash-list">${trash.map(x=>`
          <div class="trash-item">
            <div><strong>${x.type==="msr-memory"?"Memoria MSR":"Elemento borrado"} · ${esc(x.id||"")}</strong><small>${new Date(x.deletedAt).toLocaleString("es-ES")}</small></div>
            <button class="btn ghost restore-trash-btn" data-trash-id="${esc(x.trashId)}">♻️ Restaurar</button>
          </div>`).join("")}</div>`:"<div class=\"history-empty\">La papelera está vacía.</div>"}
      </div>`;
  }

  function renderAdminModal(){
    document.querySelector("#adminModal")?.remove();
    const overlay=document.createElement("div");
    overlay.id="adminModal";
    overlay.className="admin-modal-overlay";
    const section=adminModalSection||"edit";
    const meta={
      edit:["✏️ Buscar y editar datos","Corrige una línea completa en una sola pantalla."],
      repair:["🛠️ Errores y reparación","Revisa importaciones, duplicados y estructura interna."],
      cloud:["☁️ Nube, copias y recuperación","Sincronización, backups y puntos de recuperación."],
      danger:["🗑️ Borrados y limpieza","Herramientas destructivas agrupadas y protegidas."]
    }[section];
    const body=section==="edit"?adminEditPanel():section==="repair"?adminRepairPanel():section==="cloud"?adminCloudPanel():adminDangerPanel();

    overlay.innerHTML=`<div class="admin-modal-shell">
      ${adminModalHeader(meta[0],meta[1])}
      <div class="admin-modal-tabs">
        <button data-admin-tab="edit" class="${section==="edit"?"active":""}">✏️ Editar</button>
        <button data-admin-tab="repair" class="${section==="repair"?"active":""}">🛠️ Reparar</button>
        <button data-admin-tab="cloud" class="${section==="cloud"?"active":""}">☁️ Nube/copias</button>
        <button data-admin-tab="danger" class="${section==="danger"?"active danger":""}">🗑️ Borrados</button>
      </div>
      <div class="admin-modal-body">${body}</div>
    </div>`;
    document.body.appendChild(overlay);
    bindAdminModal();
  }

  function renderMsrAdminEditor(id){
    const k=idNorm(id);
    const o=db.msr.find(x=>idNorm(x.id)===k);
    const s=db.states?.[k]||stateFor(k);
    const history=(db.meta.auditLog||[]).filter(x=>x.entityType==="msr"&&idNorm(x.id)===k).slice(0,12);
    const target=document.querySelector("#adminEditorResult");
    if(!target)return;
    if(!o){
      if(db.states?.[k]){renderMemoryAdminEditor(k);return;}
      target.className="admin-editor-empty";
      target.innerHTML=`<span>❌</span><strong>ID ${esc(k)} no encontrada</strong><small>No está activa ni existe en memoria histórica.</small>`;
      return;
    }
    target.className="admin-editor-card";
    target.innerHTML=`
      <div class="admin-editor-title">
        <div><span>📦 MSR</span><h3>ID ${esc(k)}</h3><small>Edición completa de la línea importada y su estado operativo.</small></div>
        <span class="admin-editor-status">${esc(s.shipping||"No")}</span>
      </div>
      <div class="admin-form-grid">
        <label class="wide">Orden de trabajo<input id="aeDescription" value="${esc(o.description||"")}"></label>
        <label>Tienda<input id="aeStore" value="${esc(o.store||"")}"></label>
        <label>Nº OT carga<input id="aeLoadOT" value="${esc(o.loadOT||"")}"></label>
        <label>Fecha prevista<input id="aePlanDate" type="date" value="${esc(o.planDate||"")}"></label>
        <label>Hora prevista<input id="aePlanTime" type="time" value="${esc(o.planTime||"")}"></label>
        <label>Estado del fichero (referencia)<input id="aeSourceStatus" value="${esc(o.sourceStatus||"")}"></label>
        <label>Cadena<input id="aeChain" value="${esc(o.chain||"")}"></label>
        <label>Picking<select id="aePicking">${pickingOptions(s.status||"Pendiente")}</select></label>
        <label>Envío<select id="aeShipping">${shippingOptions(s.shipping||"No")}</select></label>
        <label>Fecha expedición<input id="aeDate" type="date" value="${esc(s.date||"")}"></label>
        <label>Hora expedición<input id="aeTime" type="time" value="${esc(s.time||"")}"></label>
        <label>Serval<select id="aeServal">${msrOptions(s.serval||"No",["No","Si"])}</select></label>
        <label class="wide">Comentario<textarea id="aeComment" rows="3">${esc(s.comment||"")}</textarea></label>
      </div>
      <div class="admin-editor-actions">
        <button class="btn primary" id="adminSaveMsr" data-id="${esc(k)}">💾 Guardar cambios</button>
        <button class="btn ghost" id="adminReloadMsr" data-id="${esc(k)}">↻ Descartar cambios</button>
        <button class="btn danger-soft" id="adminMemoryFromEditor" data-id="${esc(k)}">🧹 Borrar memoria</button>
        <button class="btn danger" id="adminDeleteFromEditor" data-id="${esc(k)}">🗑️ Eliminar ID completa</button>
      </div>
      <div class="entity-history">
        <h4>🕘 Historial de cambios</h4>
        ${history.length?history.map(x=>`<div class="history-item"><strong>${new Date(x.at).toLocaleString("es-ES")} · ${esc(x.action)}</strong><small>${esc(x.source||"")} ${x.changes? "· "+esc(JSON.stringify(x.changes)):""}</small></div>`).join(""):"<div class=\"history-empty\">Todavía no hay cambios registrados para esta ID.</div>"}
      </div>`;
    bindMsrAdminEditor();
  }

  function renderHceAdminEditor(query){
    const q=String(query||"").trim().toUpperCase();
    const x=db.hce.find(x=>String(x.key||x.number||x.entryId||"").toUpperCase()===q || String(x.number||"").toUpperCase()===q || String(x.entryId||"").toUpperCase()===q);
    const history=x?(db.meta.auditLog||[]).filter(a=>a.entityType==="hce"&&String(a.id).toUpperCase()===String(x.key||x.number||x.entryId).toUpperCase()).slice(0,12):[];
    const target=document.querySelector("#adminEditorResult");
    if(!target)return;
    if(!x){
      target.className="admin-editor-empty";
      target.innerHTML=`<span>❌</span><strong>No encuentro ese HCE</strong><small>Busca por matrícula, contenedor o ID entrada exacta.</small>`;
      return;
    }
    target.className="admin-editor-card";
    target.innerHTML=`
      <div class="admin-editor-title">
        <div><span>🚛 HCE</span><h3>${esc(x.number||x.entryId)}</h3><small>Corrección completa del contenedor/entrada.</small></div>
        <span class="admin-editor-status">${esc(x.process||"Pendiente de recibir")}</span>
      </div>
      <div class="admin-form-grid">
        <label>Matrícula / contenedor<input id="ahNumber" value="${esc(x.number||"")}"></label>
        <label>ID entrada<input id="ahEntry" value="${esc(x.entryId||"")}"></label>
        <label>Fecha prevista<input id="ahPlanDate" type="date" value="${esc(x.planDate||"")}"></label>
        <label>Hora prevista<input id="ahPlanTime" type="time" value="${esc(x.planTime||"")}"></label>
        <label>Fecha llegada<input id="ahRealDate" type="date" value="${esc(x.realDate||"")}"></label>
        <label>Hora llegada<input id="ahRealTime" type="time" value="${esc(x.realTime||"")}"></label>
        <label>Estado<select id="ahProcess">${hceProcessOptions(x.process||"Pendiente de recibir")}</select></label>
        <label>Transportista<input id="ahTransporter" value="${esc(x.transporter||"")}"></label>
        <label class="wide">Razón / descripción<input id="ahReason" value="${esc(x.reason||"")}"></label>
      </div>
      <div class="admin-editor-actions">
        <button class="btn primary" id="adminSaveHce" data-key="${esc(x.key)}">💾 Guardar cambios</button>
        <button class="btn ghost" id="adminReloadHce" data-key="${esc(x.key)}">↻ Descartar cambios</button>
      </div>
      <div class="entity-history">
        <h4>🕘 Historial de cambios</h4>
        ${history.length?history.map(a=>`<div class="history-item"><strong>${new Date(a.at).toLocaleString("es-ES")} · ${esc(a.action)}</strong><small>${esc(a.source||"")} ${a.changes?"· "+esc(JSON.stringify(a.changes)):""}</small></div>`).join(""):"<div class=\"history-empty\">Todavía no hay cambios registrados para este HCE.</div>"}
      </div>`;
    bindHceAdminEditor();
  }

  function bindMsrAdminEditor(){
    const saveBtn=document.querySelector("#adminSaveMsr");
    if(saveBtn)saveBtn.onclick=()=>{
      const id=idNorm(saveBtn.dataset.id);
      const o=db.msr.find(x=>idNorm(x.id)===id);
      if(!o)return;
      const s=stateFor(id);
      const serval=document.querySelector("#aeServal").value;
      const comment=document.querySelector("#aeComment").value.trim();
      if(serval==="Si"&&!comment){toast("🚨 Serval = Sí requiere comentario obligatorio",true);return;}
      const picking=document.querySelector("#aePicking").value;
      const shipping=document.querySelector("#aeShipping").value;
      const date=document.querySelector("#aeDate").value;
      const time=document.querySelector("#aeTime").value;
      if(shipping!=="No"&&(!date||!time)){toast("Completa fecha y hora de expedición",true);return;}

      makeAdminSnapshot(`Antes de editar línea MSR ${id}`);
      const beforeAdmin={order:{...o},state:{...s}};
      o.description=document.querySelector("#aeDescription").value.trim();
      o.store=document.querySelector("#aeStore").value.trim();
      o.loadOT=document.querySelector("#aeLoadOT").value.trim();
      o.planDate=document.querySelector("#aePlanDate").value;
      o.planTime=document.querySelector("#aePlanTime").value;
      o.sourceStatus=document.querySelector("#aeSourceStatus").value.trim();
      o.chain=document.querySelector("#aeChain").value.trim();
      s.status=picking;s.shipping=shipping;s.date=date;s.time=time;s.serval=serval;s.comment=comment;s.updatedAt=nowISO();
      logAudit("msr",id,"Edición completa admin",{before:beforeAdmin,after:{order:{...o},state:{...s}}},"admin");
      save();toast("✅ Línea MSR corregida y guardada");renderMsrAdminEditor(id);
    };
    const reload=document.querySelector("#adminReloadMsr");if(reload)reload.onclick=()=>renderMsrAdminEditor(reload.dataset.id);
    const mem=document.querySelector("#adminMemoryFromEditor");if(mem)mem.onclick=async()=>{
      const id=idNorm(mem.dataset.id);
      if(!confirm(`¿Borrar solo la memoria de la ID ${id}?`))return;
      makeAdminSnapshot(`Antes de borrar memoria ID ${id}`);
      pushTrash({type:"msr-memory",id,state:{...db.states[id]}});
      delete db.states[id];
      logAudit("msr",id,"Memoria enviada a papelera",{},"admin");
      save();toast("Memoria borrada");renderMsrAdminEditor(id);
    };
    const del=document.querySelector("#adminDeleteFromEditor");if(del)del.onclick=()=>{
      const id=idNorm(del.dataset.id);
      if(!confirm(`¿Eliminar por completo la ID ${id}?`))return;
      makeAdminSnapshot(`Antes de eliminar ID ${id}`);
      const deletedOrder=db.msr.find(x=>idNorm(x.id)===id);
      pushTrash({type:"msr-full",id,order:deletedOrder?{...deletedOrder}:null,state:db.states[id]?{...db.states[id]}:null});
      db.msr=db.msr.filter(x=>idNorm(x.id)!==id);delete db.states[id];
      logAudit("msr",id,"ID enviada a papelera",{},"admin");
      save();toast("ID eliminada");renderAdminModal();
    };
  }

  function bindHceAdminEditor(){
    const saveBtn=document.querySelector("#adminSaveHce");
    if(saveBtn)saveBtn.onclick=()=>{
      const x=db.hce.find(x=>x.key===saveBtn.dataset.key);if(!x)return;
      const process=document.querySelector("#ahProcess").value;
      const rd=document.querySelector("#ahRealDate").value,rt=document.querySelector("#ahRealTime").value;
      if(process!=="Pendiente de recibir"&&(!rd||!rt)){toast("Para avanzar el estado HCE necesitas fecha y hora de llegada",true);return;}
      makeAdminSnapshot(`Antes de editar HCE ${x.key}`);
      const beforeHceAdmin={...x};
      x.number=document.querySelector("#ahNumber").value.trim();
      x.entryId=document.querySelector("#ahEntry").value.trim();
      x.planDate=document.querySelector("#ahPlanDate").value;x.planTime=document.querySelector("#ahPlanTime").value;
      x.realDate=rd;x.realTime=rt;x.process=process;x.transporter=document.querySelector("#ahTransporter").value.trim();
      x.reason=document.querySelector("#ahReason").value.trim();x.updatedAt=nowISO();
      logAudit("hce",x.key,"Edición completa admin",{before:beforeHceAdmin,after:{...x}},"admin");
      save();toast("✅ HCE corregido y guardado");renderHceAdminEditor(x.key);
    };
    const reload=document.querySelector("#adminReloadHce");if(reload)reload.onclick=()=>renderHceAdminEditor(reload.dataset.key);
  }

  function bindAdminModal(){
    document.querySelector("#adminModalClose")?.addEventListener("click",closeAdminCenter);
    document.querySelectorAll("[data-admin-tab]").forEach(btn=>btn.onclick=()=>{adminModalSection=btn.dataset.adminTab;renderAdminModal();});
    document.querySelectorAll("[data-admin-run]").forEach(btn=>btn.onclick=()=>runAdminAction(btn.dataset.adminRun,true).then(()=>{if(document.querySelector("#adminModal"))renderAdminModal();}));

    const msrSearch=document.querySelector("#adminMsrSearchBtn");
    if(msrSearch)msrSearch.onclick=()=>renderMsrAdminEditor(document.querySelector("#adminMsrSearch").value);
    const hceSearch=document.querySelector("#adminHceSearchBtn");
    if(hceSearch)hceSearch.onclick=()=>renderHceAdminEditor(document.querySelector("#adminHceSearch").value);

    const conflictLocal=document.querySelector("#restoreConflictLocal");
    if(conflictLocal)conflictLocal.onclick=async()=>{
      const conflict=getCloudConflict();if(!conflict?.local)return;
      if(!confirm("¿Conservar la copia LOCAL y enviarla a la nube?"))return;
      db=normalizeData(conflict.local);
      localStorage.setItem(STORAGE_KEY,JSON.stringify(db));
      try{if(window.MSRCloud?.enabled)await window.MSRCloud.save(db);lastCloudFingerprint=JSON.stringify(normalizeData(db));clearCloudConflict();pendingCloudSave=false;localStorage.removeItem("msr_hce_pending_sync");markCloudOnline();toast("💻 Copia local conservada y enviada a la nube");renderAdminModal();}
      catch(err){recordAppError(err,"conflict-local");markCloudError(err);toast("No se pudo enviar la copia local",true);}
    };
    const conflictRemote=document.querySelector("#restoreConflictRemote");
    if(conflictRemote)conflictRemote.onclick=()=>{
      const conflict=getCloudConflict();if(!conflict?.remote)return;
      if(!confirm("¿Sustituir este dispositivo por la copia guardada de la NUBE?"))return;
      makeAdminSnapshot("Antes de resolver conflicto usando nube");
      db=normalizeData(conflict.remote);
      localStorage.setItem(STORAGE_KEY,JSON.stringify(db));
      lastCloudFingerprint=JSON.stringify(normalizeData(db));clearCloudConflict();pendingCloudSave=false;localStorage.removeItem("msr_hce_pending_sync");markCloudOnline();toast("☁️ Copia de nube aplicada");renderAdminModal();
    };
    const discardConflict=document.querySelector("#discardConflict");
    if(discardConflict)discardConflict.onclick=()=>{
      if(!confirm("¿Cerrar el aviso de conflicto sin cambiar los datos?"))return;
      clearCloudConflict();toast("Aviso de conflicto cerrado");renderAdminModal();
    };

    const fileDoctorBtn=document.querySelector("#adminFileDoctorBtn"),fileDoctorInput=document.querySelector("#adminFileDoctorInput");
    if(fileDoctorBtn&&fileDoctorInput)fileDoctorBtn.onclick=()=>fileDoctorInput.click();
    if(fileDoctorInput)fileDoctorInput.onchange=e=>{const f=e.target.files?.[0];if(f)openFileDoctor(f);e.target.value="";};

    const backup=document.querySelector("#adminBackupBtn");if(backup)backup.onclick=()=>download(`msr-hce-backup-${today()}.json`,JSON.stringify(db,null,2));
    const restore=document.querySelector("#adminRestoreBtn"),ri=document.querySelector("#adminRestoreInput");
    if(restore&&ri)restore.onclick=()=>ri.click();
    if(ri)ri.onchange=e=>{
      const f=e.target.files?.[0];if(!f)return;
      const rd=new FileReader();
      rd.onload=()=>{try{const x=JSON.parse(rd.result);if(!x.version)throw 0;makeAdminSnapshot("Antes de restaurar backup");db=normalizeData(x);save();toast("Backup restaurado");renderAdminModal()}catch{toast("Backup no válido",true)}};
      rd.readAsText(f);
    };

    const delMem=document.querySelector("#adminDeleteMemoryBtn");
    if(delMem)delMem.onclick=()=>{
      const id=idNorm(document.querySelector("#adminDeleteId").value);if(!id)return;
      if(!db.states[id]){toast("No hay memoria para esa ID",true);return;}
      if(!confirm(`¿Borrar memoria de ID ${id}?`))return;
      makeAdminSnapshot(`Antes de borrar memoria ID ${id}`);
      pushTrash({type:"msr-memory",id,state:{...db.states[id]}});
      delete db.states[id];logAudit("msr",id,"Memoria enviada a papelera",{},"admin");
      save();toast("Memoria eliminada");renderAdminModal();
    };
    const delFull=document.querySelector("#adminDeleteFullBtn");
    if(delFull)delFull.onclick=()=>{
      const id=idNorm(document.querySelector("#adminDeleteId").value);if(!id)return;
      if(!db.states[id]&&!db.msr.some(x=>idNorm(x.id)===id)){toast("No existe esa ID",true);return;}
      if(!confirm(`¿Eliminar por completo la ID ${id}?`))return;
      makeAdminSnapshot(`Antes de eliminar ID ${id}`);
      const deletedOrder=db.msr.find(x=>idNorm(x.id)===id);
      pushTrash({type:"msr-full",id,order:deletedOrder?{...deletedOrder}:null,state:db.states[id]?{...db.states[id]}:null});
      db.msr=db.msr.filter(x=>idNorm(x.id)!==id);delete db.states[id];
      logAudit("msr",id,"ID enviada a papelera",{},"admin");
      save();toast("ID eliminada");renderAdminModal();
    };
    document.querySelectorAll(".restore-trash-btn").forEach(btn=>btn.onclick=()=>restoreTrashItem(btn.dataset.trashId));

    const nuclear=document.querySelector("#adminNuclearBtn");
    if(nuclear)nuclear.onclick=async()=>{
      if(!confirm("¿Borrar TODOS los datos?"))return;
      if(!confirm("CONFIRMACIÓN FINAL: MSR, HCE, memorias y nube. ¿Continuar?"))return;
      makeAdminSnapshot("Antes del borrado total");
      db=defaultData();
      saveLocalOnly();
      try{if(window.MSRCloud?.enabled)await window.MSRCloud.clear();}catch(err){console.warn("Cloud clear",err);markCloudError(err);}
      toast("Datos eliminados");
      renderAdminModal();
    };
  }

  async function adminAuth(){
    const pwd=prompt("🔐 Contraseña de administrador");
    if(pwd===null)return false;
    const data=new TextEncoder().encode(pwd);
    const digest=await crypto.subtle.digest("SHA-256",data);
    const hex=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
    if(hex!=="3156dd05d31035e57d0b80a4033cf98567a2d2591e8b668e3ca10e60911de24f"){
      toast("Contraseña incorrecta",true);
      return false;
    }
    return true;
  }

  async function runAdminAction(action,authenticated=false){
    if(!authenticated && !(await adminAuth()))return;

    if(action==="inspect-id"){
      const raw=prompt("Código / ID MSR que quieres consultar");
      if(!raw)return;
      const info=adminStateSummary(raw);
      adminNotice=info
        ? `ID: ${info.id}\nActiva ahora: ${info.active?"Sí":"No"}\nOrden: ${info.order||"—"}\nTienda: ${info.store||"—"}\nEnvío: ${info.shipping}\nExpedición: ${info.date||"—"} ${info.time||""}\nServal: ${info.serval}\nComentario: ${info.comment||"—"}\nÚltimo cambio: ${info.updatedAt?new Date(info.updatedAt).toLocaleString("es-ES"):"—"}`
        : `No existe información guardada para la ID ${idNorm(raw)}.`;
      render();return;
    }

    if(action==="edit-msr-id"){
      const raw=prompt("Código / ID MSR que quieres editar");
      if(!raw)return;
      const id=idNorm(raw);
      const o=db.msr.find(x=>idNorm(x.id)===id);
      if(!o){toast("La ID no está en la planificación MSR actual",true);return;}
      makeAdminSnapshot(`Antes de editar línea MSR ${id}`);

      const description=prompt("ORDEN DE TRABAJO",o.description||"");
      if(description===null)return;
      const store=prompt("TIENDA",o.store||"");
      if(store===null)return;
      const planDate=prompt("FECHA PREVISTA (AAAA-MM-DD)",o.planDate||"");
      if(planDate===null)return;
      const planTime=prompt("HORA PREVISTA (HH:MM)",o.planTime||"");
      if(planTime===null)return;
      const loadOT=prompt("Nº OT DE CARGA",o.loadOT||"");
      if(loadOT===null)return;
      const sourceStatus=prompt("ESTADO ORIGEN / IMPORTADO",o.sourceStatus||"");
      if(sourceStatus===null)return;

      o.description=String(description).trim();
      o.store=String(store).trim();
      o.planDate=String(planDate).trim();
      o.planTime=String(planTime).trim();
      o.loadOT=String(loadOT).trim();
      o.sourceStatus=String(sourceStatus).trim();

      const s=stateFor(id);
      const shipping=prompt("ENVÍO (No / Parcial / Total)",s.shipping||"No");
      if(shipping!==null && ["No","Parcial","Total"].includes(shipping))s.shipping=shipping;
      const serval=prompt("SERVAL (No / Si)",s.serval||"No");
      if(serval!==null && ["No","Si"].includes(serval))s.serval=serval;
      const comment=prompt(s.serval==="Si"?"COMENTARIO OBLIGATORIO POR SERVAL":"COMENTARIO",s.comment||"");
      if(comment!==null)s.comment=String(comment).trim();
      if(s.serval==="Si"&&!s.comment){
        toast("No se ha guardado: Serval = Sí requiere comentario",true);
        const snap=JSON.parse(localStorage.getItem(ADMIN_UNDO_KEY)||"null");
        if(snap?.db)db=snap.db;
        render();
        return;
      }
      s.updatedAt=nowISO();

      save();
      adminNotice=`ID ${id} editada manualmente.\nOrden de trabajo: ${o.description||"—"}\nTienda: ${o.store||"—"}\nPrevisto: ${o.planDate||"—"} ${o.planTime||""}\nEnvío: ${s.shipping}\nServal: ${s.serval}`;
      render();
      toast(`✏️ ID ${id} actualizada`);
      return;
    }

    if(action==="export-memory"){
      download(`msr-memoria-estados-${today()}.json`,JSON.stringify({exportedAt:nowISO(),states:db.states},null,2));
      toast("📤 Memoria de estados exportada");return;
    }

    if(action==="pull"){
      if(!window.MSRCloud?.enabled){toast("Nube no disponible",true);return;}
      if(!confirm("¿Sustituir la copia de este dispositivo por la versión de la nube?"))return;
      makeAdminSnapshot("Antes de forzar nube → dispositivo");
      try{
        const cloud=await window.MSRCloud.load();
        if(!cloud?.version){toast("No hay datos válidos en la nube",true);return;}
        db=cloud;localStorage.setItem(STORAGE_KEY,JSON.stringify(db));
        adminNotice="Se ha cargado manualmente la copia de la nube.";
        render();toast("☁️ Datos descargados desde la nube");
      }catch(e){console.warn(e);toast("Error al descargar desde la nube",true);}
      return;
    }

    if(action==="push"){
      if(!window.MSRCloud?.enabled){toast("Nube no disponible",true);return;}
      if(!confirm("¿Sobrescribir la nube con los datos de ESTE dispositivo?"))return;
      makeAdminSnapshot("Antes de forzar dispositivo → nube");
      try{await window.MSRCloud.save(db);adminNotice="La copia de este dispositivo se ha forzado a la nube.";render();toast("☁️ Datos enviados a la nube");}
      catch(e){console.warn(e);toast("Error al subir a la nube",true);}
      return;
    }

    if(action==="repair"){
      makeAdminSnapshot("Antes de reparar estructura");
      const before={msr:db.msr.length,hce:db.hce.length,states:Object.keys(db.states||{}).length};
      const mm=new Map();
      db.msr.forEach(o=>{const id=idNorm(o.id);if(id)mm.set(id,{...o,id});});
      db.msr=[...mm.values()];
      const hm=new Map();
      db.hce.forEach(x=>{const key=String(x.key||x.number||x.entryId||"").trim().toUpperCase();if(key)hm.set(key,{...x,key});});
      db.hce=[...hm.values()];
      const states={};
      Object.entries(db.states||{}).forEach(([id,s])=>{const k=idNorm(id||s?.id);if(k)states[k]={...s,id:k};});
      db.states=states;
      const after={msr:db.msr.length,hce:db.hce.length,states:Object.keys(db.states).length};
      adminNotice=`Reparación completada.\nMSR: ${before.msr} → ${after.msr}\nHCE: ${before.hce} → ${after.hce}\nMemorias: ${before.states} → ${after.states}`;
      save();render();toast("🛠️ Reparación completada");return;
    }

    if(action==="health-check"){
      const activeIds=db.msr.map(o=>idNorm(o.id));
      const duplicateIds=[...new Set(activeIds.filter((id,i,a)=>a.indexOf(id)!==i))];
      const invalidStates=Object.entries(db.states||{}).filter(([id,s])=>!["Pendiente","En proceso","Finalizado"].includes(s.status||"Pendiente")||!["No","Parcial","Total"].includes(s.shipping||"No")||!["No","Si"].includes(s.serval||"No"));
      const incompleteShip=Object.entries(db.states||{}).filter(([id,s])=>Boolean(s.date)!==Boolean(s.time)||(s.shipping!=="No"&&(!s.date||!s.time)));
      const servalBad=Object.entries(db.states||{}).filter(([id,s])=>s.serval==="Si"&&!String(s.comment||"").trim());
      const activeSet=new Set(activeIds),orphans=Object.keys(db.states||{}).filter(id=>!activeSet.has(id));
      const hceBad=db.hce.filter(x=>Boolean(x.realDate)!==Boolean(x.realTime)||((x.process||"Pendiente de recibir")!=="Pendiente de recibir"&&(!x.realDate||!x.realTime)));
      const report=[
        duplicateIds.length?`❌ ${duplicateIds.length} ID(s) duplicadas en MSR: ${duplicateIds.slice(0,20).join(", ")}`:"✅ Sin IDs duplicadas en MSR",
        invalidStates.length?`❌ ${invalidStates.length} memoria(s) con estados inválidos`:"✅ Estados de memoria válidos",
        incompleteShip.length?`⚠️ ${incompleteShip.length} expedición(es) incompletas`:"✅ Fechas/horas de expedición coherentes",
        servalBad.length?`❌ ${servalBad.length} Serval sin comentario`:"✅ Serval coherente",
        hceBad.length?`⚠️ ${hceBad.length} HCE con llegada/estado incoherente`:"✅ HCE coherente",
        `💾 ${orphans.length} memoria(s) no activas (esto puede ser normal)`,
        cloudConflictActive?"⚠️ Hay un conflicto de nube pendiente":"✅ Sin conflicto de nube pendiente"
      ];
      showEmployeePopup({type:(duplicateIds.length||invalidStates.length||servalBad.length)?"error":(incompleteShip.length||hceBad.length||cloudConflictActive)?"warning":"success",title:"Chequeo integral del sistema",message:"Resultado de la revisión automática:",details:report,primaryText:"Entendido"});
      return;
    }

    if(action==="restore-undo"){
      let snap=null;try{snap=JSON.parse(localStorage.getItem(ADMIN_UNDO_KEY)||"null")}catch{}
      if(!snap?.db){toast("No hay punto de recuperación disponible",true);return;}
      if(!confirm(`¿Restaurar el estado anterior guardado el ${new Date(snap.at).toLocaleString("es-ES")}?\n${snap.reason||""}`))return;
      db=snap.db;save();adminNotice="Se restauró el último punto de recuperación admin.";render();toast("↩️ Estado restaurado");return;
    }

    if(action==="reset-id"){
      const raw=prompt("Código / ID cuya MEMORIA quieres borrar");
      if(!raw)return;const id=idNorm(raw);
      if(!db.states[id]){toast("Esa ID no tiene memoria guardada",true);return;}
      if(!confirm(`¿Borrar la memoria histórica de la ID ${id}? La orden activa, si existe, se mantendrá.`))return;
      makeAdminSnapshot(`Antes de borrar memoria ID ${id}`);
      delete db.states[id];save();adminNotice=`Memoria de ID ${id} eliminada.`;render();toast(`🧹 Memoria ${id} borrada`);return;
    }

    if(action==="delete-id-all"){
      const raw=prompt("Código / ID que quieres ELIMINAR POR COMPLETO");
      if(!raw)return;const id=idNorm(raw);
      const hasState=Boolean(db.states[id]);const active=db.msr.some(o=>idNorm(o.id)===id);
      if(!hasState&&!active){toast("No existe esa ID",true);return;}
      if(!confirm(`¿Eliminar por completo la ID ${id}?\nOrden activa: ${active?"Sí":"No"}\nMemoria: ${hasState?"Sí":"No"}`))return;
      makeAdminSnapshot(`Antes de eliminar ID completa ${id}`);
      db.msr=db.msr.filter(o=>idNorm(o.id)!==id);delete db.states[id];
      save();adminNotice=`ID ${id} eliminada de planificación y memoria.`;render();toast(`🗑️ ID ${id} eliminada`);return;
    }

    if(action==="purge-orphans"){
      const active=new Set(db.msr.map(o=>idNorm(o.id)));
      const ids=Object.keys(db.states||{}).filter(id=>!active.has(id));
      if(!ids.length){toast("No hay memorias no activas");return;}
      if(!confirm(`¿Borrar ${ids.length} memorias de IDs que NO están en el MSR actual?\nEsto elimina su histórico guardado.`))return;
      makeAdminSnapshot("Antes de borrar memorias no activas");
      ids.forEach(id=>delete db.states[id]);save();
      adminNotice=`Se eliminaron ${ids.length} memorias no activas.`;
      render();toast(`♻️ ${ids.length} memorias eliminadas`);return;
    }

    if(action==="clear-msr"){
      if(!confirm("¿Vaciar planificación MSR? La memoria por ID se conservará."))return;
      makeAdminSnapshot("Antes de vaciar MSR");
      db.msr=[];db.meta.msrImportedAt=null;save();adminNotice="Planificación MSR vaciada; memoria conservada.";render();toast("MSR vaciado · memoria conservada");return;
    }

    if(action==="clear-hce"){
      if(!confirm("¿Vaciar todos los contenedores HCE actuales?"))return;
      makeAdminSnapshot("Antes de vaciar HCE");
      db.hce=[];db.meta.hceImportedAt=null;save();adminNotice="Planificación HCE vaciada.";render();toast("HCE vaciado");return;
    }

    if(action==="diag"){
      const activeIds=new Set(db.msr.map(o=>idNorm(o.id)));
      const diag={
        generatedAt:nowISO(),version:db.version,meta:db.meta,
        counts:{msr:db.msr.length,states:Object.keys(db.states||{}).length,hce:db.hce.length,orphanStates:Object.keys(db.states||{}).filter(id=>!activeIds.has(id)).length},
        lastImportReport:db.meta?.lastImportReport||null,data:db
      };
      download(`msr-hce-diagnostico-${today()}.json`,JSON.stringify(diag,null,2));
      toast("🧪 Diagnóstico descargado");return;
    }
  }

  function render(){
    if(page==="inicio")renderInicio();
    if(page==="resumen")renderResumen();
    if(page==="hce")renderHCE();
    if(page==="import-msr")renderImport("msr");
    if(page==="import-hce")renderImport("hce");
    if(page==="datos")renderDatos();
    bindPage();
  }

  function bindPage(){
    const quickAdmin=$("#quickAdminBtn"); if(quickAdmin)quickAdmin.onclick=()=>openAdminCenter("edit");

    const problemsBtn=$("#problemsBtn"); if(problemsBtn)problemsBtn.onclick=()=>showProblemsModal();

    const addManualMSR=$("#addManualMSRBtn"); if(addManualMSR)addManualMSR.onclick=()=>openManualMsrModal();
    const addManualHCE=$("#addManualHCEBtn"); if(addManualHCE)addManualHCE.onclick=()=>openManualHceModal();

    document.querySelectorAll("[data-go]").forEach(x=>x.onclick=()=>go(x.dataset.go));
    document.querySelectorAll("[data-summary-filter]").forEach(x=>x.onclick=()=>{summaryFilter=x.dataset.summaryFilter;render()});
    const sfrom=$("#summaryDateFrom"); if(sfrom)sfrom.onchange=()=>{
      summaryRolling48=false;summaryDateFrom=sfrom.value;
      if(summaryDateTo&&summaryDateFrom>summaryDateTo)summaryDateTo=summaryDateFrom;
      summaryPage=1;render();
    };
    const sto=$("#summaryDateTo"); if(sto)sto.onchange=()=>{
      summaryRolling48=false;summaryDateTo=sto.value;
      if(summaryDateFrom&&summaryDateTo<summaryDateFrom)summaryDateFrom=summaryDateTo;
      summaryPage=1;render();
    };
    const sToday=$("#summaryToday"); if(sToday)sToday.onclick=()=>{summaryRolling48=false;summaryDateFrom=today();summaryDateTo=today();summaryPage=1;render()};
    const sYesterday=$("#summaryYesterday"); if(sYesterday)sYesterday.onclick=()=>{
      const d=new Date();d.setDate(d.getDate()-1);
      const y=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      summaryRolling48=false;summaryDateFrom=y;summaryDateTo=y;summaryPage=1;render();
    };
    const s48=$("#summary48h"); if(s48)s48.onclick=()=>{summaryRolling48=true;summaryPage=1;render()};
    const s7=$("#summary7d"); if(s7)s7.onclick=()=>{
      const end=new Date(),start=new Date();start.setDate(start.getDate()-6);
      const fd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      summaryRolling48=false;summaryDateFrom=fd(start);summaryDateTo=fd(end);summaryPage=1;render();
    };
    const sAll=$("#summaryAllDates"); if(sAll)sAll.onclick=()=>{summaryRolling48=false;summaryDateFrom="";summaryDateTo="";summaryPage=1;render()};
    const spick=$("#summaryPickingFilter"); if(spick)spick.onchange=()=>{summaryPickingFilter=spick.value;summaryPage=1;render()};
    const sship=$("#summaryShippingFilter"); if(sship)sship.onchange=()=>{summaryShippingFilter=sship.value;summaryPage=1;render()};
    const sserv=$("#summaryServalFilter"); if(sserv)sserv.onchange=()=>{summaryServalFilter=sserv.value;summaryPage=1;render()};
    const stext=$("#summaryTextFilter"); if(stext)stext.oninput=()=>{summaryTextFilter=stext.value;summaryPage=1;clearTimeout(bindPage._searchTimer);bindPage._searchTimer=setTimeout(()=>render(),280)};
    const skey=$("#summarySortKey"); if(skey)skey.onchange=()=>{summarySortKey=skey.value;summaryPage=1;render()};
    const sdir=$("#summarySortDir"); if(sdir)sdir.onchange=()=>{summarySortDir=sdir.value;summaryPage=1;render()};
    const sreset=$("#resetSummaryFilters"); if(sreset)sreset.onclick=()=>{
      summaryFilter="all";summaryDateFilter="all";summaryDateFrom="";summaryDateTo="";summaryRolling48=false;summaryShippingFilter="all";summaryServalFilter="all";summaryPickingFilter="all";summaryTextFilter="";summarySortKey="planDateTime";summarySortDir="asc";summaryPage=1;render();
    };

    const summaryPageSizeEl=$("#summaryPageSize"); if(summaryPageSizeEl)summaryPageSizeEl.onchange=()=>{summaryPageSize=Number(summaryPageSizeEl.value)||25;summaryPage=1;render()};
    const summaryPrev=$("#summaryPrev"); if(summaryPrev)summaryPrev.onclick=()=>{summaryPage=Math.max(1,summaryPage-1);render()};
    const summaryNext=$("#summaryNext"); if(summaryNext)summaryNext.onclick=()=>{summaryPage+=1;render()};

    const clearMSR=$("#clearMSRBtn"); if(clearMSR)clearMSR.onclick=()=>{
      if(!db.msr.length){toast("No hay órdenes MSR para limpiar",true);return;}
      const remembered=Object.keys(db.states).length;
      if(!confirm(`¿Limpiar las ${db.msr.length} órdenes MSR actuales?\n\nLos estados guardados por ID NO se borrarán (${remembered} IDs con memoria).`))return;
      db.msr=[];
      db.meta.msrImportedAt=null;
      summaryDateFilter="all";summaryDateFrom="";summaryDateTo="";summaryRolling48=false;
      save();
      toast("MSR limpio · estados por ID conservados");
      render();
    };

    const clearHCE=$("#clearHCEBtn"); if(clearHCE)clearHCE.onclick=()=>{
      if(!db.hce.length){toast("No hay contenedores HCE para limpiar",true);return;}
      if(!confirm(`¿Limpiar los ${db.hce.length} contenedores HCE actuales?\n\nEsta acción borra la planificación HCE cargada.`))return;
      db.hce=[];
      db.meta.hceImportedAt=null;
      save();
      toast("HCE limpio · listo para nueva importación");
      render();
    };

    document.querySelectorAll("[data-msr-id][data-msr-field]").forEach(el=>{
      el.addEventListener("change",()=>{
        const id=idNorm(el.dataset.msrId),field=el.dataset.msrField;
        const s=stateFor(id);
        const previous={...s};
        s[field]=el.value;

        if(field==="shipping" && s.shipping!=="No" && (!s.date||!s.time)){
          s.shipping=previous.shipping||"No";
          showEmployeePopup({
            type:"warning",
            title:"Falta fecha y hora de expedición",
            message:"No puedes marcar una orden como Parcial o Total sin registrar cuándo se ha expedido.",
            details:["Completa primero Fecha expedición y Hora expedición.","Después vuelve a seleccionar el estado de envío."],
            primaryText:"Corregir ahora"
          });
          render();
          return;
        }

        if(s.shipping==="No"&&(s.date||s.time)){
          showEmployeePopup({
            type:"warning",
            title:"Revisa el estado de envío",
            message:"Hay fecha/hora de expedición, pero Envío sigue marcado como No.",
            details:["Si ya salió mercancía, cambia Envío a Parcial o Total."],
            primaryText:"Entendido"
          });
        }

        if(field==="serval" && s.serval==="Si" && !String(s.comment||"").trim()){
          requestServalComment(id,previous.serval||"No");
          return;
        }

        if(field==="comment" && s.serval==="Si" && !String(s.comment||"").trim()){
          s.comment=previous.comment||"";
          showEmployeePopup({
            type:"error",
            title:"Comentario obligatorio",
            message:"No puedes dejar vacío el comentario mientras Serval esté marcado como Sí.",
            primaryText:"Entendido"
          });
          render();
          return;
        }

        s.updatedAt=nowISO();
        logAudit("msr",id,`Cambio ${field}`,{from:previous[field]??"",to:s[field]??""},"empleado");
        save();
        toast("✓ MSR guardado");
        render();
      });
    });

    const dfrom=$("#dashboardDateFrom"); if(dfrom)dfrom.onchange=()=>{dashboardRolling48=false;dashboardDateFrom=dfrom.value;if(dashboardDateTo&&dashboardDateFrom>dashboardDateTo)dashboardDateTo=dashboardDateFrom;render()};
    const dto=$("#dashboardDateTo"); if(dto)dto.onchange=()=>{dashboardRolling48=false;dashboardDateTo=dto.value;if(dashboardDateFrom&&dashboardDateTo<dashboardDateFrom)dashboardDateFrom=dashboardDateTo;render()};
    const dtoday=$("#dashboardToday"); if(dtoday)dtoday.onclick=()=>{dashboardRolling48=false;dashboardDateFrom=today();dashboardDateTo=today();render()};
    const dy=$("#dashboardYesterday"); if(dy)dy.onclick=()=>{
      const d=new Date();d.setDate(d.getDate()-1);const y=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      dashboardRolling48=false;dashboardDateFrom=y;dashboardDateTo=y;render();
    };
    const d48=$("#dashboard48h"); if(d48)d48.onclick=()=>{
      dashboardRolling48=true;render();
    };
    const dall=$("#dashboardAll"); if(dall)dall.onclick=()=>{dashboardRolling48=false;dashboardDateFrom="";dashboardDateTo="";render()};
    const printBtn=$("#printDashboardBtn"); if(printBtn)printBtn.onclick=()=>{
      stampReportNow();
      document.body.classList.add("pdf-print-mode");
      setTimeout(()=>{
        window.print();
        setTimeout(()=>document.body.classList.remove("pdf-print-mode"),400);
      },80);
    };

    const hf=$("#hceDateFrom"); if(hf)hf.onchange=()=>{hceDateFrom=hf.value;hcePage=1;render()};
    const ht=$("#hceDateTo"); if(ht)ht.onchange=()=>{hceDateTo=ht.value;hcePage=1;render()};
    const hpfilter=$("#hceProcessFilter"); if(hpfilter)hpfilter.onchange=()=>{hceProcessFilter=hpfilter.value;hcePage=1;render()};
    const htfilter=$("#hceTimingFilter"); if(htfilter)htfilter.onchange=()=>{hceTimingFilter=htfilter.value;hcePage=1;render()};
    const hsort=$("#hceSortKey"); if(hsort)hsort.onchange=()=>{hceSortKey=hsort.value;hcePage=1;render()};
    const hdir=$("#hceSortDir"); if(hdir)hdir.onchange=()=>{hceSortDir=hdir.value;hcePage=1;render()};
    const hreset=$("#resetHCEFilters"); if(hreset)hreset.onclick=()=>{hceDateFrom="";hceDateTo="";hceProcessFilter="all";hceTimingFilter="all";hceSortKey="planDateTime";hceSortDir="asc";hcePage=1;render()};
    const hcePageSizeEl=$("#hcePageSize"); if(hcePageSizeEl)hcePageSizeEl.onchange=()=>{hcePageSize=Number(hcePageSizeEl.value)||25;hcePage=1;render()};
    const hcePrev=$("#hcePrev"); if(hcePrev)hcePrev.onclick=()=>{hcePage=Math.max(1,hcePage-1);render()};
    const hceNext=$("#hceNext"); if(hceNext)hceNext.onclick=()=>{hcePage+=1;render()};

    document.querySelectorAll("[data-hce-key][data-hce-field]").forEach(el=>{
      el.addEventListener("change",()=>{
        const key=el.dataset.hceKey,field=el.dataset.hceField;
        const item=db.hce.find(x=>x.key===key);
        if(!item)return;
        const previous={...item};
        item[field]=el.value;

        if(item.realDate&&item.realTime&&(item.process==="Pendiente de recibir"||!item.process)){
          item.process="Posicionado";
          toast("✓ Llegada registrada · estado cambiado a Posicionado");
        }

        if(item.process!=="Pendiente de recibir"&&(!item.realDate||!item.realTime)){
          item.process=previous.process||"Pendiente de recibir";
          item.realDate=previous.realDate||item.realDate;
          item.realTime=previous.realTime||item.realTime;
          showEmployeePopup({
            type:"error",
            title:"No se puede avanzar el estado",
            message:"Para cambiar el contenedor a Posicionado, Descargando o Descargado necesitas registrar primero la llegada.",
            details:["Introduce Fecha llegada y Hora llegada.","Después vuelve a cambiar el estado."],
            primaryText:"Corregir"
          });
          render();
          return;
        }

        item.updatedAt=nowISO();
        logAudit("hce",key,`Cambio ${field}`,{from:previous[field]??"",to:item[field]??""},"empleado");
        save();
        render();
      });
    });
    const clearImportReport=$("#clearImportReport");
    if(clearImportReport)clearImportReport.onclick=()=>{db.meta.lastImportReport=null;save();render();};

    const fileInput=$("#fileInput");
    const dropZone=$("#dropZone");
    const importKind=page==="import-msr"?"msr":page==="import-hce"?"hce":null;

    if(fileInput&&importKind){
      fileInput.onchange=e=>{
        const file=e.target.files?.[0];
        if(file)handleImport(file,importKind);
      };
    }
    if(dropZone&&importKind){
      dropZone.ondragover=e=>{e.preventDefault();dropZone.classList.add("drag");};
      dropZone.ondragleave=()=>dropZone.classList.remove("drag");
      dropZone.ondrop=e=>{
        e.preventDefault();
        dropZone.classList.remove("drag");
        const file=e.dataTransfer?.files?.[0];
        if(file)handleImport(file,importKind);
      };
    }

    document.querySelectorAll("[data-admin-open]").forEach(btn=>btn.onclick=()=>openAdminCenter(btn.dataset.adminOpen));
    document.querySelectorAll("[data-admin-action]").forEach(btn=>btn.onclick=()=>runAdminAction(btn.dataset.adminAction));
    const networkDiag=$("#networkDiagBtn");
    if(networkDiag)networkDiag.onclick=async()=>{
      networkDiag.disabled=true;networkDiag.textContent="⏳ Comprobando…";
      const details=[
        `✅ Aplicación: cargada desde ${location.hostname}`,
        window.XLSX?"✅ Excel: lector local disponible":"❌ Excel: lector no disponible",
        navigator.onLine?"✅ Navegador: con conexión":"⚠️ Navegador: sin conexión"
      ];
      let type="success",title="Red compatible",message="Los componentes locales de la aplicación funcionan.";
      try{
        if(!window.MSRCloud?.enabled)throw new Error("Nube no configurada");
        const d=await window.MSRCloud.diagnose();
        details.push(`✅ Nube: accesible por ${d.transport} · ${d.latencyMs} ms`);
        details.push(`🔄 Sincronización: comprobación cada ${d.pollingSeconds} s`);
      }catch(err){
        type="warning";title="La red bloquea la nube";
        message="La app puede seguir trabajando en este dispositivo, pero la sincronización compartida no está accesible desde esta red.";
        details.push(`❌ Nube: ${err?.message||"bloqueada"}`);
        details.push("💾 Los cambios se conservarán localmente hasta recuperar una red compatible.");
      }
      showEmployeePopup({type,title,message,details,primaryText:"Entendido"});
      networkDiag.disabled=false;networkDiag.textContent="🌐 Diagnóstico de red";
    };

    const memorySearch=$("#memorySearch"),memoryOnly=$("#memoryOnlyOrphans");
    const filterMemoryRows=()=>{
      const q=norm(memorySearch?.value||""),only=Boolean(memoryOnly?.checked);
      document.querySelectorAll("[data-memory-row]").forEach(row=>{
        const matches=!q||String(row.dataset.memorySearch||"").includes(q);
        const active=row.dataset.memoryActive==="1";
        row.hidden=!(matches&&(!only||!active));
      });
    };
    if(memorySearch)memorySearch.oninput=filterMemoryRows;
    if(memoryOnly)memoryOnly.onchange=filterMemoryRows;
    document.querySelectorAll("[data-memory-open]").forEach(btn=>btn.onclick=async()=>{
      if(!(adminSession&&Date.now()<adminSessionUntil)){
        if(!(await adminAuth()))return;
        adminSession=true;adminSessionUntil=Date.now()+(15*60*1000);
      }
      adminModalSection="edit";renderAdminModal();renderMemoryAdminEditor(btn.dataset.memoryOpen);
    });
    const memoryExport=$("#memoryExportBtn");if(memoryExport)memoryExport.onclick=async()=>{
      if(!(await adminAuth()))return;
      download(`msr-memorias-${today()}.json`,JSON.stringify({exportedAt:nowISO(),states:db.states},null,2));
      toast("📤 Memorias exportadas");
    };

    const backup=$("#backupBtn"); if(backup)backup.onclick=()=>download(`msr-hce-backup-${today()}.json`,JSON.stringify(db,null,2));
    const restore=$("#restoreBtn"),ri=$("#restoreInput"); if(restore)restore.onclick=async()=>{if(await adminAuth())ri.click();};
    if(ri)ri.onchange=e=>{
      const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const x=JSON.parse(rd.result);if(!x.version)throw 0;makeAdminSnapshot("Antes de restaurar backup");db=normalizeData(x);save();adminNotice="Backup restaurado correctamente.";toast("Backup restaurado");render()}catch{toast("Backup no válido",true)}};rd.readAsText(f);
    };
    const reset=$("#resetBtn");if(reset)reset.onclick=async()=>{
      if(!(await adminAuth()))return;
      if(!confirm("¿Borrar TODOS los datos de MSR, estados y HCE?"))return;
      if(!confirm("Confirmación FINAL: también se eliminará la memoria histórica y la nube. ¿Continuar?"))return;
      makeAdminSnapshot("Antes del borrado total");
      db=defaultData();
      saveLocalOnly();
      try{if(window.MSRCloud?.enabled)await window.MSRCloud.clear();}catch(err){console.warn("Cloud clear",err);markCloudError(err);}
      adminNotice="Se ejecutó un borrado total.";
      toast("Datos eliminados");
      render();
    };
  }





  function parseSemicolonCSV(text){
    const rows=[]; let row=[], field="", quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(ch==='"'){
        if(quoted && text[i+1]==='"'){field+='"';i++;}
        else quoted=!quoted;
      }else if(ch===';' && !quoted){
        row.push(field);field="";
      }else if((ch==='\n' || ch==='\r') && !quoted){
        if(ch==='\r' && text[i+1]==='\n')i++;
        row.push(field);field="";
        if(row.some(v=>String(v).trim()!==""))rows.push(row);
        row=[];
      }else field+=ch;
    }
    if(field!=="" || row.length){row.push(field);if(row.some(v=>String(v).trim()!==""))rows.push(row);}
    return rows;
  }

  function compareRecord(a,b,fields){
    return fields.some(f=>String(a?.[f]??"")!==String(b?.[f]??""));
  }

  function buildMSRPreview(headers,rows,fileName=""){
    const idx={
      id:findHeader(headers,["Código","Codigo","ID OT de reparto","ID reparto","OT reparto"]),
      work:findHeader(headers,["Orden de trabajo","Descripción","Descripcion"]),
      sourceStatus:findHeader(headers,["Estado"]),
      store:findHeader(headers,["Tienda"]),
      chain:findHeader(headers,["Cadena"]),
      loadOT:findHeader(headers,["Nº OT de carga","N OT de carga","OT de carga","numero ot carga"])
    };
    if(idx.id<0)throw new Error("No encuentro la columna Código");

    const errors=[],warnings=[];
    const inferPlanFromWork=(work)=>{
      const s=String(work||"").trim();
      const m=s.match(/_(\d{2})(\d{2})_(\d{1,2})(AM|PM)(?:_|$)/i);
      if(!m)return {date:"",time:""};
      const day=m[1],month=m[2],now=new Date(),baseYear=now.getFullYear();
      let hour=Number(m[3]);const ap=m[4].toUpperCase();
      if(ap==="PM"&&hour<12)hour+=12;if(ap==="AM"&&hour===12)hour=0;
      const candidates=[baseYear-1,baseYear,baseYear+1]
        .map(y=>({y,d:new Date(y,Number(month)-1,Number(day),hour,0,0)}))
        .filter(x=>x.d.getMonth()===Number(month)-1&&x.d.getDate()===Number(day))
        .sort((a,b)=>Math.abs(a.d-now)-Math.abs(b.d-now));
      const year=String(candidates[0]?.y??baseYear);
      return {date:`${year}-${month}-${day}`,time:`${String(hour).padStart(2,"0")}:00`};
    };

    const map=new Map();
    rows.forEach((r,i)=>{
      const line=i+2;
      const rawId=String(pick(r,idx.id)).trim();
      if(!rawId){errors.push({line,message:"Código/ID vacío. La línea quedará fuera de la importación."});return;}
      const id=idNorm(rawId);
      if(!/^\d+$/.test(id)){errors.push({line,message:"Código/ID no numérico. La línea quedará fuera.",value:rawId});return;}
      const work=String(pick(r,idx.work)).trim();
      const store=String(pick(r,idx.store)).trim();
      const inferred=inferPlanFromWork(work);
      if(!work)warnings.push({line,message:"Orden de trabajo vacía.",value:id});
      if(!store)warnings.push({line,message:"Tienda vacía.",value:id});
      if(!inferred.date||!inferred.time)warnings.push({line,message:"No se pudo obtener fecha/hora prevista desde Orden de trabajo.",value:work||id});
      if(map.has(id))warnings.push({line,message:"ID duplicada en el fichero; se conservará la última aparición.",value:id});
      map.set(id,{
        id,planDate:inferred.date,planTime:inferred.time,description:work,
        loadOT:String(pick(r,idx.loadOT)).trim(),
        sourceStatus:String(pick(r,idx.sourceStatus)).trim(),
        store,chain:String(pick(r,idx.chain)).trim(),
        manual:false
      });
    });

    const current=new Map(db.msr.map(o=>[idNorm(o.id),o]));
    let manualMatches=0,manualKept=0;
    current.forEach((o,id)=>{
      if(o.manual&&map.has(id)){
        manualMatches++;
        warnings.push({line:"—",message:"La ID manual ya aparece en el fichero; los datos importados sustituirán los manuales y se conservará su estado.",value:id});
      }else if(o.manual&&!map.has(id)){
        manualKept++;
        map.set(id,{...o});
        warnings.push({line:"—",message:"ID manual no presente en el fichero; se conservará en la planificación.",value:id});
      }
    });

    const candidate=[...map.values()].sort((a,b)=>
      (`${a.planDate||""}${a.planTime||""}${String(a.id).padStart(12,"0")}`)
      .localeCompare(`${b.planDate||""}${b.planTime||""}${String(b.id).padStart(12,"0")}`)
    );
    const newMap=new Map(candidate.map(o=>[idNorm(o.id),o]));
    let existing=0,newCount=0,changed=0;
    newMap.forEach((o,id)=>{
      const prev=current.get(id);
      if(prev){
        existing++;
        if(compareRecord(prev,o,["description","store","planDate","planTime","loadOT","chain","sourceStatus"]))changed++;
      }else newCount++;
    });
    const missing=[...current.keys()].filter(id=>!newMap.has(id)).length;

    return {
      kind:"msr",fileName,totalRows:rows.length,candidate,errors,warnings,
      comparison:{existing,newCount,missing,changed,manualMatches,manualKept}
    };
  }

  function buildHCEPreview(headers,rows,fileName=""){
    const idx={
      entry:findHeader(headers,["ID ENTRADA","ID entrada","Entrada","ID"]),
      task:findHeader(headers,["ID TAREA","ID tarea"]),
      planDate:findHeader(headers,["FECHA PREVISTA","Fecha prevista","FECHA PLAN","Fecha plan"]),
      planTime:findHeader(headers,["HORA PREVISTA","Hora prevista","HORA PLAN","Hora plan"]),
      number:findHeader(headers,["MATRÍCULA","Matricula","Número contenedor","Numero contenedor","Contenedor"]),
      transporter:findHeader(headers,["TRANSPORTISTA","Transportista"]),
      reason:findHeader(headers,["RAZON","RAZÓN","Razon"]),
      qty:findHeader(headers,["CANTIDAD","Cantidad"])
    };
    if(idx.entry<0&&idx.number<0)throw new Error("No encuentro ID ENTRADA / MATRÍCULA");

    const errors=[],warnings=[];
    const grouped=new Map();
    rows.forEach((r,i)=>{
      const line=i+2;
      const entryId=String(pick(r,idx.entry)).trim();
      const number=String(pick(r,idx.number)).trim().toUpperCase();
      if(!entryId&&!number){errors.push({line,message:"Falta ID ENTRADA y MATRÍCULA. Línea omitida."});return;}
      const key=(number||entryId).toUpperCase();
      const planDate=parseDate(pick(r,idx.planDate));
      const planTime=parseTime(pick(r,idx.planTime));
      if(!planDate)warnings.push({line,message:"Fecha prevista vacía o no reconocida.",value:number||entryId});
      if(!planTime)warnings.push({line,message:"Hora prevista vacía o no reconocida.",value:number||entryId});
      const rawQty=pick(r,idx.qty);
      const qtyRaw=Number(rawQty)||0;
      if(rawQty!==""&&!Number.isFinite(Number(rawQty)))warnings.push({line,message:"Cantidad no numérica; se tomará como 0.",value:String(rawQty)});
      if(!grouped.has(key)){
        grouped.set(key,{
          key,number,entryId,entryIds:entryId?[entryId]:[],
          taskId:String(pick(r,idx.task)).trim(),
          planDate,planTime,
          transporter:String(pick(r,idx.transporter)).trim(),
          reason:String(pick(r,idx.reason)).trim(),
          plannedQty:0,lines:0,manual:false
        });
      }
      const g=grouped.get(key);
      g.plannedQty+=qtyRaw;g.lines+=1;
      if(entryId&&!g.entryIds.includes(entryId))g.entryIds.push(entryId);
      g.entryId=g.entryIds.join(", ");
      if(!g.number&&number)g.number=number;
      if(!g.planDate)g.planDate=planDate;
      if(!g.planTime)g.planTime=planTime;
    });

    const current=new Map(db.hce.map(x=>[String(x.key||x.number||x.entryId||"").toUpperCase(),x]));
    let manualMatches=0,manualKept=0;
    current.forEach((x,key)=>{
      if(x.manual&&grouped.has(key)){
        manualMatches++;
        warnings.push({line:"—",message:"El HCE manual ya aparece en el fichero; se usarán los datos importados y se conservará llegada/estado.",value:key});
      }else if(x.manual&&!grouped.has(key)){
        manualKept++;
        grouped.set(key,{...x});
        warnings.push({line:"—",message:"HCE manual no presente en el fichero; se conservará.",value:key});
      }
    });

    const candidate=[...grouped.values()].map(g=>{
      const prev=current.get(String(g.key).toUpperCase())||{};
      return {...g,realDate:prev.realDate||"",realTime:prev.realTime||"",process:prev.process||"Pendiente de recibir",updatedAt:prev.updatedAt||null};
    }).sort((a,b)=>(`${a.planDate||""}${a.planTime||""}`).localeCompare(`${b.planDate||""}${b.planTime||""}`));

    const newMap=new Map(candidate.map(x=>[String(x.key||x.number||x.entryId||"").toUpperCase(),x]));
    let existing=0,newCount=0,changed=0;
    newMap.forEach((x,key)=>{
      const prev=current.get(key);
      if(prev){
        existing++;
        if(compareRecord(prev,x,["number","entryId","planDate","planTime","transporter","reason","plannedQty"]))changed++;
      }else newCount++;
    });
    const missing=[...current.keys()].filter(key=>!newMap.has(key)).length;
    return {kind:"hce",fileName,totalRows:rows.length,candidate,errors,warnings,comparison:{existing,newCount,missing,changed,manualMatches,manualKept}};
  }

  function showImportPreview(preview){
    pendingImportPreview=preview;
    document.querySelector("#importPreviewModal")?.remove();
    const p=preview;
    const issues=[...(p.errors||[]).map(x=>({level:"error",...x})),...(p.warnings||[]).map(x=>({level:"warning",...x}))];
    const overlay=document.createElement("div");
    overlay.id="importPreviewModal";
    overlay.className="import-preview-overlay";
    overlay.innerHTML=`<div class="import-preview-shell">
      <div class="import-preview-head">
        <div>
          <span>🔎 PREVISUALIZACIÓN SEGURA</span>
          <h2>${p.kind==="msr"?"Importación MSR":"Importación HCE"}</h2>
          <p>${esc(p.fileName||"Archivo")} · todavía NO se ha modificado ningún dato.</p>
        </div>
        <button id="importPreviewClose">✕</button>
      </div>
      <div class="import-preview-kpis">
        <div><b>📄 ${p.totalRows}</b><span>Líneas leídas</span></div>
        <div><b>✅ ${p.candidate.length}</b><span>Registros válidos</span></div>
        <div><b>🆕 ${p.comparison.newCount}</b><span>Nuevos</span></div>
        <div><b>🔁 ${p.comparison.existing}</b><span>Ya existentes</span></div>
        <div><b>✏️ ${p.comparison.changed}</b><span>Con datos distintos</span></div>
        <div><b>📤 ${p.comparison.missing}</b><span>Desaparecen</span></div>
        <div><b>❌ ${p.errors.length}</b><span>Errores</span></div>
        <div><b>⚠️ ${p.warnings.length}</b><span>Avisos</span></div>
      </div>
      ${p.comparison.manualMatches||p.comparison.manualKept?`<div class="import-preview-manual">
        🧩 IDs manuales: <strong>${p.comparison.manualMatches||0}</strong> detectadas ahora en el fichero · <strong>${p.comparison.manualKept||0}</strong> se conservarán porque siguen sin aparecer.
      </div>`:""}
      <div class="import-preview-summary ${p.errors.length?"has-errors":"ok"}">
        <strong>${p.errors.length?"⚠️ Hay líneas que no se importarán":"✅ Archivo listo para aplicar"}</strong>
        <span>${p.errors.length?"Puedes importar únicamente los registros correctos o cancelar para corregir el fichero.":"Revisa el comparador y confirma la importación."}</span>
      </div>
      ${issues.length?`<div class="issue-list import-preview-issues">
        ${issues.slice(0,40).map(x=>{const i=importIssueFix(x,p.kind);return `<div class="issue-item ${x.level}"><b>${x.level==="error"?"❌":"⚠️"} Línea ${i.line}</b><span><strong>${esc(i.problem)}</strong><small>→ ${esc(i.fix)}</small></span>${i.value?`<code>${esc(i.value)}</code>`:""}</div>`}).join("")}
        ${issues.length>40?`<div class="issue-more">… ${issues.length-40} incidencias adicionales</div>`:""}
      </div>`:""}
      <div class="import-preview-actions">
        <button class="btn ghost" id="importPreviewCancel">Cancelar y corregir archivo</button>
        <button class="btn primary" id="importPreviewApply" ${p.candidate.length?"":"disabled"}>✅ Importar ${p.candidate.length} registros correctos</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const cancel=()=>{pendingImportPreview=null;overlay.remove();};
    overlay.querySelector("#importPreviewClose").onclick=cancel;
    overlay.querySelector("#importPreviewCancel").onclick=cancel;
    overlay.querySelector("#importPreviewApply").onclick=()=>applyImportPreview();
  }

  function applyImportPreview(){
    const p=pendingImportPreview;
    if(!p)return;
    makeAdminSnapshot(`Antes de importar ${p.kind.toUpperCase()}`);
    const at=nowISO();

    if(p.kind==="msr"){
      db.msr=p.candidate.map(o=>({...o}));
      db.msr.forEach(o=>stateFor(o.id));
      db.meta.msrImportedAt=at;
    }else{
      db.hce=p.candidate.map(x=>({...x}));
      db.meta.hceImportedAt=at;
    }

    const report={
      kind:p.kind,at,fileName:p.fileName,totalRows:p.totalRows,imported:p.candidate.length,
      errors:p.errors,warnings:p.warnings,comparison:p.comparison
    };
    db.meta.lastImportReport=report;
    addImportHistory(report);
    logAudit("system",p.kind,"Importación aplicada",{fileName:p.fileName,imported:p.candidate.length,comparison:p.comparison,errors:p.errors.length,warnings:p.warnings.length},"importación");
    save();

    document.querySelector("#importPreviewModal")?.remove();
    pendingImportPreview=null;
    const hasIssues=p.errors.length||p.warnings.length;
    go(p.kind==="msr"?(hasIssues?"import-msr":"resumen"):(hasIssues?"import-hce":"hce"));
    toast(`✅ Importación aplicada · ${p.candidate.length} registros`);
    if(hasIssues)setTimeout(()=>importIssuesPopup(p.kind,p.errors,p.warnings),150);
  }

  function handleImport(file,kind){
    if(!file)return;
    if(!window.XLSX){
      showEmployeePopup({
        type:"error",title:"No se puede abrir el archivo todavía",
        message:"El lector de Excel no ha terminado de cargar.",
        details:["Espera unos segundos y vuelve a intentarlo.","Si continúa, pulsa Actualizar o revisa la conexión."],
        primaryText:"Entendido"
      });
      return;
    }
    const rd=new FileReader();
    rd.onload=e=>{
      try{
        let rows=[];
        const name=String(file.name||"").toLowerCase();
        if(name.endsWith(".csv")||name.endsWith(".txt")){
          const bytes=new Uint8Array(e.target.result);
          const decoded=decodeTextSmart(bytes);
          const delimiter=detectCsvDelimiter(decoded.text);
          rows=parseDelimitedText(decoded.text,delimiter);
        }else{
          const wb=XLSX.read(e.target.result,{type:"array",cellDates:true});
          const ws=wb.Sheets[wb.SheetNames[0]];
          rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:true});
        }
        const clean=rows.filter(r=>r.some(v=>String(v).trim()!==""));
        if(clean.length<2)throw new Error("Archivo vacío");
        const headers=clean[0].map(v=>String(v).trim());
        const data=clean.slice(1);
        const preview=kind==="msr"?buildMSRPreview(headers,data,file.name):buildHCEPreview(headers,data,file.name);
        showImportPreview(preview);
      }catch(err){
        console.error(err);
        showEmployeePopup({
          type:"error",title:"No se ha podido analizar el archivo",
          message:err?.message||"No he podido interpretar el archivo.",
          details:["No se ha modificado ningún dato.","Comprueba que es el export correcto.","Si continúa, avisa al responsable/admin."],
          primaryText:"Revisar archivo"
        });
      }
    };
    rd.readAsArrayBuffer(file);
  }

  document.querySelectorAll("#nav button").forEach(b=>b.onclick=()=>go(b.dataset.page));
  $("#menuBtn").onclick=()=>$("#sidebar").classList.toggle("open");
  $("#recalcBtn").onclick=()=>{db=load();toast("Datos actualizados");render()};
  $("#forceSyncBtn").onclick=()=>forceSync();
  window.addEventListener("online",()=>{cloudStatus="checking";renderSyncStatus();toast("🌐 Conexión recuperada · sincronizando cambios…");forceSync();});
  window.addEventListener("offline",()=>{
    renderSyncStatus();
    toast("📴 Sin Internet · trabajando con copia local",true);
    showEmployeePopup({
      type:"warning",
      title:"Sin conexión a Internet",
      message:"Puedes seguir trabajando. Los cambios se guardarán en este dispositivo y se sincronizarán al recuperar la conexión.",
      details:["No cierres ni borres los datos del navegador mientras haya cambios pendientes."],
      primaryText:"Seguir trabajando"
    });
  });
  renderSyncStatus();
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("#installBtn").hidden=false});
  $("#installBtn").onclick=async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$("#installBtn").hidden=true};
  window.addEventListener("storage",e=>{if(e.key===STORAGE_KEY){db=load();render()}});
  window.addEventListener("keydown",e=>{
    if(e.key==="Escape"&&document.querySelector("#adminModal")){closeAdminCenter();return;}
    if(document.body.classList.contains("capture-mode")&&e.key==="Escape")document.body.classList.remove("capture-mode");
  });
  if("serviceWorker" in navigator)window.addEventListener("load",async()=>{
    try{
      const reg=await navigator.serviceWorker.register("./sw.js");
      wireServiceWorkerUpdates(reg);
      reg.update().catch(()=>{});
    }catch(err){console.warn("Service worker",err);}
  });

  async function bootstrapCloud(){
    if(!window.MSRCloud?.enabled){cloudStatus="error";lastSyncError="Nube no configurada";renderSyncStatus();return;}
    try{
      const rawCloud=await window.MSRCloud.load();
      const cloud=rawCloud?.version?normalizeData(rawCloud):null;

      if(cloud){
        lastCloudFingerprint=JSON.stringify(cloud);
        const localDifferent=JSON.stringify(db)!==lastCloudFingerprint;

        if(pendingCloudSave && localDifferent && cloud.meta?.writerId!==DEVICE_ID){
          localStorage.setItem(CLOUD_CONFLICT_KEY,JSON.stringify({at:nowISO(),local:db,remote:cloud}));
          cloudConflictActive=true;
          cloudStatus="error";
          lastSyncError="Hay cambios locales pendientes y una copia distinta en la nube";
          renderSyncStatus();
          showEmployeePopup({
            type:"warning",
            title:"Sincronización pendiente de revisión",
            message:"Este dispositivo tiene cambios sin subir y la nube también cambió.",
            details:["No se ha sobrescrito ninguna copia.","Resuelve el conflicto desde Admin → Nube/copias."],
            primaryText:"Entendido"
          });
        }else if(pendingCloudSave){
          db.meta.writerId=DEVICE_ID;
          await window.MSRCloud.save(db);
          lastCloudFingerprint=JSON.stringify(normalizeData(db));
          pendingCloudSave=false;
          localStorage.removeItem("msr_hce_pending_sync");
          clearCloudConflict();
          markCloudOnline();
          toast("☁️ Cambios pendientes sincronizados");
        }else{
          db=cloud;
          localStorage.setItem(STORAGE_KEY,JSON.stringify(db));
          render();
          markCloudOnline();
          toast("Datos sincronizados desde la nube");
        }
      }else{
        db.meta.writerId=DEVICE_ID;
        await window.MSRCloud.save(db);
        lastCloudFingerprint=JSON.stringify(normalizeData(db));
        pendingCloudSave=false;
        localStorage.removeItem("msr_hce_pending_sync");
        clearCloudConflict();
        markCloudOnline();
      }

      window.MSRCloud.subscribe(next=>{
        if(!next || !next.version)return;
        const normalized=normalizeData(next);
        const incoming=JSON.stringify(normalized);

        // Echo of a save made by this same browser/device.
        if(normalized.meta?.writerId===DEVICE_ID){
          lastCloudFingerprint=incoming;
          if((Number(normalized.meta?.revision)||0)>=(Number(db.meta?.revision)||0)){
            pendingCloudSave=false;
            localStorage.removeItem("msr_hce_pending_sync");
            markCloudOnline();
          }
          return;
        }

        const current=JSON.stringify(db);
        if(incoming===current){
          lastCloudFingerprint=incoming;
          return;
        }

        if(pendingCloudSave || cloudConflictActive){
          localStorage.setItem(CLOUD_CONFLICT_KEY,JSON.stringify({at:nowISO(),local:db,remote:normalized}));
          cloudConflictActive=true;
          cloudStatus="error";
          lastSyncError="Conflicto detectado: hay cambios locales y remotos";
          renderSyncStatus();
          showEmployeePopup({
            type:"warning",
            title:"Cambios simultáneos detectados",
            message:"Otro dispositivo ha actualizado la nube mientras este dispositivo tenía cambios pendientes.",
            details:["No se ha sobrescrito tu trabajo local.","Resuelve qué copia conservar desde Admin → Nube/copias."],
            primaryText:"Entendido"
          });
          return;
        }

        db=normalized;
        localStorage.setItem(STORAGE_KEY,incoming);
        lastCloudFingerprint=incoming;
        markCloudOnline();
        render();
        toast("☁️ Cambios recibidos en directo");
      });
    }catch(err){
      console.warn("Cloud load",err);
      recordAppError(err,"cloud-bootstrap");
      markCloudError(err);
      setTimeout(()=>toast("Nube temporalmente no disponible · la app sigue funcionando en local",true),300);
    }
  }

  window.addEventListener("error",event=>{
    recordAppError(event.error||new Error(event.message||"Error JavaScript"),"window.error");
  });
  window.addEventListener("unhandledrejection",event=>{
    const err=event.reason instanceof Error?event.reason:new Error(String(event.reason||"Promise rechazada"));
    recordAppError(err,"unhandledrejection");
  });

  const initial=location.hash.replace("#",""); go(pages[initial]?initial:"inicio");
  bootstrapCloud();
})();