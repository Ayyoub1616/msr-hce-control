/* MSR · HCE Control — static PWA for GitHub Pages */
(() => {
  "use strict";

  const STORAGE_KEY = "msr_hce_control_v1";
  const VERSION = 1;
  const defaultData = () => ({
    version: VERSION,
    msr: [],
    states: {},
    hce: [],
    meta: { updatedAt: null, msrImportedAt: null, hceImportedAt: null }
  });

  let db = load();
  let page = "inicio";
  let deferredInstall = null;
  let summaryFilter = "all";
  let summaryDateFilter = "all";
  let summaryDateFrom = "";
  let summaryDateTo = "";
  let summaryStateFilter = "all";
  let summaryShippingFilter = "all";
  let summaryServalFilter = "all";
  let summaryTextFilter = "";
  let summaryIdsFilter = [];
  let summarySortKey = "planDateTime";
  let summarySortDir = "asc";
  let dashboardDate = today();
  let hceDateFrom = "";
  let hceDateTo = "";
  let hceProcessFilter = "all";
  let hceTimingFilter = "all";
  let hceSortKey = "planDateTime";
  let hceSortDir = "asc";

  const $ = s => document.querySelector(s);
  const content = $("#content");

  function load() {
    try {
      const x = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return x && x.version ? x : defaultData();
    } catch { return defaultData(); }
  }
  function save() {
    db.meta.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    window.dispatchEvent(new CustomEvent("msr-data-changed"));
    if(window.MSRCloud?.enabled) window.MSRCloud.save(db).catch(err=>console.warn("Cloud save",err));
  }
  function toast(msg, error=false) {
    const el=$("#toast"); el.textContent=msg; el.className="toast show"+(error?" error":"");
    clearTimeout(toast._t); toast._t=setTimeout(()=>el.className="toast",2600);
  }
  function esc(v=""){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]))}
  function norm(s=""){return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
  function idNorm(v){ const s=String(v??"").trim().replace(/^0+/,""); return s || String(v??"").trim(); }
  function nowISO(){return new Date().toISOString()}
  function today(){return new Date().toISOString().slice(0,10)}
  function fmtDate(v){ if(!v)return ""; const s=String(v); if(/^\d{4}-\d{2}-\d{2}$/.test(s)){const [y,m,d]=s.split("-");return `${d}/${m}/${y}`} return s; }
  function fmtTime(v){ if(!v)return ""; return String(v).slice(0,5); }
  function dt(date,time){ if(!date)return null; const d=new Date(`${date}T${time||"00:00"}:00`); return isNaN(d)?null:d; }
  function download(name,text,type="application/json"){
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href);
  }
  function parseDate(v){
    if(v==null||v==="")return "";
    if(v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);
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

  function stateFor(id){
    const k=idNorm(id);
    if(!db.states[k]) db.states[k]={id:k,status:"Pendiente",date:"",time:"",shipping:"No",serval:"No",comment:"",updatedAt:null};
    return db.states[k];
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
  function timing(o,s){
    const p=plannedFor(o), a=actualFor(o,s);
    if(!p)return "SIN PREVISIÓN";
    const ref=a||new Date();
    const h=(ref-p)/36e5;
    if(a){
      if(h<=0)return `A TIEMPO · ${Math.abs(h).toFixed(1)} h antes`;
      return `TARDE · ${h.toFixed(1)} h`;
    }
    if(h>0)return `RETRASO · ${h.toFixed(1)} h`;
    return `FALTAN ${Math.abs(h).toFixed(1)} h`;
  }

  function msrTimeBadge(o,s){
    const t=timing(o,s);
    let cls="b-gray";
    if(t.startsWith("A TIEMPO"))cls="b-green";
    else if(t.startsWith("TARDE")||t.startsWith("RETRASO"))cls="b-red";
    else if(t.startsWith("FALTAN"))cls="b-blue";
    return `<span class="badge ${cls}">${esc(t)}</span>`;
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


  function renderInicio(){
    const msr=orderRows().filter(({o})=>!dashboardDate||o.planDate===dashboardDate)
      .sort((a,b)=>(`${a.o.planDate}${a.o.planTime}`).localeCompare(`${b.o.planDate}${b.o.planTime}`));
    const hce=db.hce.filter(x=>!dashboardDate||x.planDate===dashboardDate)
      .sort((a,b)=>(`${a.planDate}${a.planTime}`).localeCompare(`${b.planDate}${b.planTime}`));

    const msrPending=msr.filter(({s})=>(s.status||"Pendiente")==="Pendiente").length;
    const msrProcess=msr.filter(({s})=>(s.status||"Pendiente")==="En proceso").length;
    const msrDone=msr.filter(({s})=>(s.status||"Pendiente")==="Finalizado").length;
    const msrLate=msr.filter(({o,s})=>["RETRASO","TARDE"].some(x=>timing(o,s).startsWith(x))).length;

    const hcePending=hce.filter(x=>!(x.realDate&&x.realTime)).length;
    const hceOnTime=hce.filter(x=>x.realDate&&x.realTime&&hceTiming(x).hours<=0).length;
    const hceLate=hce.filter(x=>x.realDate&&x.realTime&&hceTiming(x).hours>0).length;

    content.innerHTML=`
      <div class="dashboard-toolbar no-capture">
        <div class="filters">
          <label>Fecha del informe <input id="dashboardDate" class="filter-input" type="date" value="${esc(dashboardDate)}"></label>
          <button class="btn ghost" id="dashboardToday">Hoy</button>
          <button class="btn primary" id="captureModeBtn">📸 Modo captura</button>
          <button class="btn ghost" id="printDashboardBtn">🖨 Imprimir / PDF</button>
        </div>
      </div>

      <section class="report-card">
        <div class="report-head">
          <div><div class="eyebrow">PARTE OPERATIVO · MSR / HCE</div><h2>${dashboardDate?fmtDate(dashboardDate):"Todas las fechas"}</h2></div>
          <div class="report-updated">Actualizado ${new Date().toLocaleString("es-ES")}</div>
        </div>

        <div class="section-title">Órdenes MSR</div>
        <div class="grid report-kpis">
          ${kpi("Órdenes",msr.length,"Total")}
          ${kpi("Pendientes",msrPending,"Reparto")}
          ${kpi("En proceso",msrProcess,"Reparto")}
          ${kpi("Finalizadas",msrDone,"Reparto")}
          ${kpi("Con retraso",msrLate,"Cumplimiento")}
        </div>
        <div class="table-wrap report-table">
          <table class="data-table">
            <thead><tr><th>Cumplimiento</th><th>ID</th><th>Descripción</th><th>Estado reparto</th><th>Envío</th><th>Expedición</th><th>Serval</th><th>Comentario</th></tr></thead>
            <tbody>${msr.length?msr.map(({o,s})=>`<tr class="${s.serval==="Si"?"serval-alert":""}">
              <td>${msrTimeBadge(o,s)}</td>
              <td><strong>${esc(o.id)}</strong></td>
              <td class="wrap">${esc(o.description||"")}</td>
              <td>${badge(s.status||"Pendiente")}</td>
              <td>${badge(s.shipping||"No")}</td>
              <td>${s.date?`${fmtDate(s.date)} · ${fmtTime(s.time)}`:"—"}</td>
              <td>${badge(s.serval||"No")}</td>
              <td class="wrap">${esc(s.comment||"")}</td>
            </tr>`).join(""):`<tr><td colspan="8" class="empty">Sin órdenes para esta fecha.</td></tr>`}</tbody>
          </table>
        </div>

        <div class="section-title hce-title">Contenedores HCE</div>
        <div class="grid report-kpis hce-kpis">
          ${kpi("Contenedores",hce.length,"Previstos")}
          ${kpi("Pendientes",hcePending,"Sin llegada")}
          ${kpi("A tiempo",hceOnTime,"Llegados")}
          ${kpi("Tarde",hceLate,"Llegados")}
        </div>
        <div class="table-wrap report-table">
          <table class="data-table">
            <thead><tr><th>Cumplimiento</th><th>Matrícula</th><th>Previsto</th><th>Llegada</th><th>Estado</th></tr></thead>
            <tbody>${hce.length?hce.map(x=>`<tr>
              <td>${timeBadge(hceTiming(x))}</td>
              <td><strong>${esc(x.number||x.entryId)}</strong></td>
              <td>${fmtDate(x.planDate)} · ${fmtTime(x.planTime)}</td>
              <td>${x.realDate?`${fmtDate(x.realDate)} · ${fmtTime(x.realTime)}`:"—"}</td>
              <td>${badge(x.process||"Pendiente de recibir")}</td>
            </tr>`).join(""):`<tr><td colspan="5" class="empty">Sin contenedores para esta fecha.</td></tr>`}</tbody>
          </table>
        </div>
      </section>`;
  }
  function kpi(label,value,hint){return `<div class="kpi"><small>${label}</small><strong>${esc(value)}</strong><div class="hint">${hint}</div></div>`}

  function orderRows(){
    return db.msr.map(o=>({o,s:stateFor(o.id)}));
  }

  function msrOptions(current, options){
    return options.map(v=>`<option value="${esc(v)}" ${current===v?"selected":""}>${esc(v)}</option>`).join("");
  }

  function sortSummaryRows(rows){
    const val=({o,s})=>{
      if(summarySortKey==="planDateTime")return `${o.planDate||""} ${o.planTime||""}`;
      if(summarySortKey==="id")return Number(o.id)||0;
      if(summarySortKey==="status")return s.status||"";
      if(summarySortKey==="shipping")return s.shipping||"";
      if(summarySortKey==="serval")return s.serval||"";
      if(summarySortKey==="timing"){
        const p=plannedFor(o),a=actualFor(o,s),r=a||new Date();
        return p?(r-p):0;
      }
      return "";
    };
    return rows.sort((a,b)=>{
      const va=val(a),vb=val(b);
      const cmp=typeof va==="number"&&typeof vb==="number"?va-vb:String(va).localeCompare(String(vb),"es",{numeric:true});
      return summarySortDir==="desc"?-cmp:cmp;
    });
  }

  function tableOrders(rows,compact=false){
    const rr=rows.map(x=>x.o?x:{o:x,s:stateFor(x.id)});
    if(!rr.length)return `<div class="empty">No hay órdenes MSR con estos filtros.</div>`;
    if(compact){
      return `<table class="data-table"><thead><tr><th>Cumplimiento</th><th>ID</th><th>Descripción</th></tr></thead><tbody>${rr.map(({o,s})=>`<tr><td>${msrTimeBadge(o,s)}</td><td><strong>${esc(o.id)}</strong></td><td class="wrap">${esc(o.description||"")}</td></tr>`).join("")}</tbody></table>`;
    }
    return `<table class="data-table msr-table"><thead><tr>
      <th>Cumplimiento</th><th>ID</th><th>Descripción</th><th>Estado reparto</th><th>Envío</th><th>Fecha expedición</th><th>Hora expedición</th><th>Serval</th><th>Comentario</th>
      </tr></thead><tbody>${rr.map(({o,s})=>`<tr class="${s.serval==="Si"?"serval-alert":""}">
        <td class="msr-situation">${msrTimeBadge(o,s)}</td>
        <td><strong>${esc(o.id)}</strong></td>
        <td class="wrap msr-description">${esc(o.description||"")}</td>
        <td><select class="msr-edit msr-select" data-msr-id="${esc(o.id)}" data-msr-field="status">${msrOptions(s.status||"Pendiente",["Pendiente","En proceso","Finalizado"])}</select></td>
        <td><select class="msr-edit msr-select" data-msr-id="${esc(o.id)}" data-msr-field="shipping">${msrOptions(s.shipping||"No",["No","Parcial","Total"])}</select></td>
        <td><input class="msr-edit msr-date" type="date" data-msr-id="${esc(o.id)}" data-msr-field="date" value="${esc(s.date||"")}"></td>
        <td><input class="msr-edit msr-time" type="time" data-msr-id="${esc(o.id)}" data-msr-field="time" value="${esc(s.time||"")}"></td>
        <td><select class="msr-edit msr-select-short ${s.serval==="Si"?"serval-field":""}" data-msr-id="${esc(o.id)}" data-msr-field="serval">${msrOptions(s.serval||"No",["No","Si"])}</select></td>
        <td><textarea class="msr-edit msr-comment ${s.serval==="Si"?"serval-field":""}" rows="2" data-msr-id="${esc(o.id)}" data-msr-field="comment" placeholder="Comentario">${esc(s.comment||"")}</textarea></td>
      </tr>`).join("")}</tbody></table>`;
  }

  function renderResumen(){
    let rows=orderRows();
    if(summaryDateFilter!=="all")rows=rows.filter(({o})=>o.planDate===summaryDateFilter);
    if(summaryDateFrom)rows=rows.filter(({o})=>o.planDate&&o.planDate>=summaryDateFrom);
    if(summaryDateTo)rows=rows.filter(({o})=>o.planDate&&o.planDate<=summaryDateTo);
    if(summaryStateFilter!=="all")rows=rows.filter(({s})=>(s.status||"Pendiente")===summaryStateFilter);
    if(summaryShippingFilter!=="all")rows=rows.filter(({s})=>(s.shipping||"No")===summaryShippingFilter);
    if(summaryServalFilter!=="all")rows=rows.filter(({s})=>(s.serval||"No")===summaryServalFilter);
    if(summaryIdsFilter.length)rows=rows.filter(({o})=>summaryIdsFilter.includes(idNorm(o.id)));
    if(summaryTextFilter){
      const q=norm(summaryTextFilter);
      rows=rows.filter(({o,s})=>norm([o.id,o.description,s.comment].join(" ")).includes(q));
    }
    rows=sortSummaryRows(rows);

    const dates=[...new Set(db.msr.map(o=>o.planDate).filter(Boolean))].sort();
    content.innerHTML=`
      <div class="panel" style="margin-top:0">
        <div class="panel-head">
          <div><h2>Resumen MSR</h2><p>${rows.length} órdenes visibles de ${db.msr.length}. Edita directamente; se guarda automáticamente.</p></div>
          <button class="btn ghost" id="resetSummaryFilters">Limpiar filtros</button>
        </div>
        <div class="simple-filter-grid">
          <label>Fecha<select id="summaryDateFilter" class="filter-input"><option value="all">Todas</option>${dates.map(d=>`<option value="${esc(d)}" ${summaryDateFilter===d?"selected":""}>${fmtDate(d)}</option>`).join("")}</select></label>
          <label>Desde<input id="summaryDateFrom" class="filter-input" type="date" value="${esc(summaryDateFrom)}"></label>
          <label>Hasta<input id="summaryDateTo" class="filter-input" type="date" value="${esc(summaryDateTo)}"></label>
          <label>Estado reparto<select id="summaryStateFilter" class="filter-input">${msrOptions(summaryStateFilter,["all","Pendiente","En proceso","Finalizado"])}</select></label>
          <label>Envío<select id="summaryShippingFilter" class="filter-input">${msrOptions(summaryShippingFilter,["all","No","Parcial","Total"])}</select></label>
          <label>Serval<select id="summaryServalFilter" class="filter-input">${msrOptions(summaryServalFilter,["all","No","Si"])}</select></label>
          <label>Buscar<input id="summaryTextFilter" class="filter-input" placeholder="ID o descripción" value="${esc(summaryTextFilter)}"></label>
          <label>Ordenar<select id="summarySortKey" class="filter-input">
            <option value="planDateTime" ${summarySortKey==="planDateTime"?"selected":""}>Fecha + hora prevista</option>
            <option value="id" ${summarySortKey==="id"?"selected":""}>ID</option>
            <option value="status" ${summarySortKey==="status"?"selected":""}>Estado reparto</option>
            <option value="shipping" ${summarySortKey==="shipping"?"selected":""}>Envío</option>
            <option value="serval" ${summarySortKey==="serval"?"selected":""}>Serval</option>
            <option value="timing" ${summarySortKey==="timing"?"selected":""}>Cumplimiento</option>
          </select></label>
          <label>Dirección<select id="summarySortDir" class="filter-input"><option value="asc" ${summarySortDir==="asc"?"selected":""}>Ascendente</option><option value="desc" ${summarySortDir==="desc"?"selected":""}>Descendente</option></select></label>
        </div>
        <div class="table-wrap">${tableOrders(rows)}</div>
      </div>`;
  }
  function filterBtn(key,label){return `<button class="btn ${summaryFilter===key?"primary":"ghost"}" data-summary-filter="${esc(key)}">${label}</button>`}


  function hceTiming(c){
    const p=dt(c.planDate,c.planTime);
    if(!p)return {label:"SIN PREVISIÓN",hours:null,kind:"gray"};
    const a=dt(c.realDate,c.realTime);
    const ref=a||new Date();
    const h=(ref-p)/36e5;
    if(a){
      if(h<=0)return {label:`A TIEMPO · ${Math.abs(h).toFixed(1)} h antes`,hours:h,kind:"green"};
      return {label:`TARDE · ${h.toFixed(1)} h`,hours:h,kind:"red"};
    }
    if(h>0)return {label:`RETRASO · ${h.toFixed(1)} h`,hours:h,kind:"red"};
    return {label:`FALTAN ${Math.abs(h).toFixed(1)} h`,hours:h,kind:"blue"};
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

    content.innerHTML=`
      <div class="panel" style="margin-top:0">
        <div class="panel-head">
          <div><h2>Contenedores HCE</h2><p>Introduce fecha y hora de llegada. Al completarlas pasa automáticamente a Posicionado.</p></div>
          <button class="btn ghost" id="resetHCEFilters">Limpiar filtros</button>
        </div>
        <div class="simple-filter-grid hce-simple-filters">
          <label>Desde<input id="hceDateFrom" class="filter-input" type="date" value="${esc(hceDateFrom)}"></label>
          <label>Hasta<input id="hceDateTo" class="filter-input" type="date" value="${esc(hceDateTo)}"></label>
          <label>Estado<select id="hceProcessFilter" class="filter-input">${msrOptions(hceProcessFilter,["all","Pendiente de recibir","Posicionado","Descargando","Descargado"])}</select></label>
          <label>Cumplimiento<select id="hceTimingFilter" class="filter-input"><option value="all" ${hceTimingFilter==="all"?"selected":""}>Todos</option><option value="ontime" ${hceTimingFilter==="ontime"?"selected":""}>A tiempo</option><option value="late" ${hceTimingFilter==="late"?"selected":""}>Retraso</option><option value="pending" ${hceTimingFilter==="pending"?"selected":""}>Pendientes</option></select></label>
          <label>Ordenar<select id="hceSortKey" class="filter-input"><option value="planDateTime" ${hceSortKey==="planDateTime"?"selected":""}>Fecha + hora</option><option value="number" ${hceSortKey==="number"?"selected":""}>Matrícula</option><option value="process" ${hceSortKey==="process"?"selected":""}>Estado</option><option value="timing" ${hceSortKey==="timing"?"selected":""}>Cumplimiento</option></select></label>
          <label>Dirección<select id="hceSortDir" class="filter-input"><option value="asc" ${hceSortDir==="asc"?"selected":""}>Ascendente</option><option value="desc" ${hceSortDir==="desc"?"selected":""}>Descendente</option></select></label>
        </div>
        <div class="table-wrap">${tableHCE(rows)}</div>
      </div>`;
  }

  function tableHCE(rows){
    if(!rows.length)return `<div class="empty">No hay contenedores HCE con estos filtros.</div>`;
    return `<table class="data-table hce-table simple-hce"><thead><tr><th>Cumplimiento</th><th>Matrícula</th><th>Fecha prevista</th><th>Hora prevista</th><th>Fecha llegada</th><th>Hora llegada</th><th>Estado</th></tr></thead>
      <tbody>${rows.map(x=>`<tr>
        <td>${timeBadge(hceTiming(x))}</td>
        <td><strong>${esc(x.number||x.entryId)}</strong></td>
        <td>${fmtDate(x.planDate)}</td>
        <td>${fmtTime(x.planTime)}</td>
        <td><input class="hce-edit hce-date" type="date" data-hce-key="${esc(x.key)}" data-hce-field="realDate" value="${esc(x.realDate||"")}"></td>
        <td><input class="hce-edit hce-time" type="time" data-hce-key="${esc(x.key)}" data-hce-field="realTime" value="${esc(x.realTime||"")}"></td>
        <td><select class="hce-edit hce-select" data-hce-key="${esc(x.key)}" data-hce-field="process">${msrOptions(x.process||"Pendiente de recibir",["Pendiente de recibir","Posicionado","Descargando","Descargado"])}</select></td>
      </tr>`).join("")}</tbody></table>`;
  }


  function renderImport(kind){
    const msr=kind==="msr";
    const when=msr?db.meta.msrImportedAt:db.meta.hceImportedAt;
    content.innerHTML=`
      <div class="panel" style="margin-top:0">
        <div class="panel-head"><div><h2>Importar ${msr?"MSR":"HCE"}</h2><p>Admite .xlsx, .xls, .csv. La detección de columnas es automática por nombre.</p></div></div>
        <div class="import-zone" id="dropZone">
          <div style="font-size:36px">📄</div>
          <h3>Arrastra aquí el archivo</h3>
          <p>o selecciónalo desde tu equipo</p>
          <input type="file" id="fileInput" accept=".xlsx,.xls,.csv">
          <label class="btn primary" for="fileInput">Seleccionar archivo</label>
        </div>
        <div class="notice ${msr?"":"warn"}" style="margin-top:16px">
          ${msr
            ?"Las órdenes que ya tengan estado manual conservarán Total/Parcial, pallets, Serval y comentarios."
            :"Una nueva importación HCE agrupa todas las líneas por MATRÍCULA. El checklist del mismo contenedor se conserva."}
        </div>
        <div class="preview">
          <strong>Última importación:</strong> ${when?new Date(when).toLocaleString("es-ES"):"Nunca"} ·
          <strong>Registros:</strong> ${msr?db.msr.length:db.hce.length}
        </div>
      </div>`;
  }

  function renderDatos(){
    content.innerHTML=`
      <div class="grid two-col">
        <div class="panel" style="margin-top:0">
          <div class="panel-head"><div><h2>Copia de seguridad</h2><p>Descarga un JSON con MSR, estados e HCE.</p></div></div>
          <div class="actions">
            <button class="btn primary" id="backupBtn">⬇️ Descargar backup</button>
            <button class="btn ghost" id="restoreBtn">⬆️ Restaurar backup</button>
            <input id="restoreInput" type="file" accept=".json" hidden>
          </div>
        </div>
        <div class="panel" style="margin-top:0">
          <div class="panel-head"><div><h2>Almacenamiento</h2><p>GitHub Pages es estático: esta versión guarda datos localmente.</p></div></div>
          <div class="list">
            <div class="list-item"><div><strong>${db.msr.length} órdenes</strong><small>Planificación MSR</small></div></div>
            <div class="list-item"><div><strong>${Object.keys(db.states).length} estados</strong><small>Histórico por ID</small></div></div>
            <div class="list-item"><div><strong>${db.hce.length} contenedores</strong><small>Planificación HCE</small></div></div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h2>Zona peligrosa</h2><p>Estas acciones borran información del navegador actual.</p></div></div>
        <div class="actions">
          <button class="btn danger" id="resetBtn">Borrar absolutamente todos los datos</button>
        </div>
      </div>`;
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
    document.querySelectorAll("[data-go]").forEach(x=>x.onclick=()=>go(x.dataset.go));
    document.querySelectorAll("[data-summary-filter]").forEach(x=>x.onclick=()=>{summaryFilter=x.dataset.summaryFilter;render()});
    const sdf=$("#summaryDateFilter"); if(sdf)sdf.onchange=()=>{summaryDateFilter=sdf.value;render()};
    const sfrom=$("#summaryDateFrom"); if(sfrom)sfrom.onchange=()=>{summaryDateFrom=sfrom.value;summaryDateFilter="all";render()};
    const sto=$("#summaryDateTo"); if(sto)sto.onchange=()=>{summaryDateTo=sto.value;summaryDateFilter="all";render()};
    const ssit=$("#summarySituationFilter"); if(ssit)ssit.onchange=()=>{summaryFilter=ssit.value;render()};
    const sstate=$("#summaryStateFilter"); if(sstate)sstate.onchange=()=>{summaryStateFilter=sstate.value;render()};
    const sship=$("#summaryShippingFilter"); if(sship)sship.onchange=()=>{summaryShippingFilter=sship.value;render()};
    const sserv=$("#summaryServalFilter"); if(sserv)sserv.onchange=()=>{summaryServalFilter=sserv.value;render()};
    const stext=$("#summaryTextFilter"); if(stext)stext.onchange=()=>{summaryTextFilter=stext.value;render()};
    const sids=$("#summaryIdsFilter"); if(sids)sids.onchange=()=>{summaryIdsFilter=[...new Set(sids.value.split(/[\s,;|]+/).map(idNorm).filter(Boolean))];render()};
    const skey=$("#summarySortKey"); if(skey)skey.onchange=()=>{summarySortKey=skey.value;render()};
    const sdir=$("#summarySortDir"); if(sdir)sdir.onchange=()=>{summarySortDir=sdir.value;render()};
    const sreset=$("#resetSummaryFilters"); if(sreset)sreset.onclick=()=>{
      summaryFilter="all";summaryDateFilter="all";summaryDateFrom="";summaryDateTo="";summaryStateFilter="all";summaryShippingFilter="all";summaryServalFilter="all";summaryTextFilter="";summaryIdsFilter=[];summarySortKey="planDateTime";summarySortDir="asc";render();
    };

    document.querySelectorAll("[data-msr-id][data-msr-field]").forEach(el=>{
      el.addEventListener("change",()=>{
        const id=idNorm(el.dataset.msrId),field=el.dataset.msrField;
        const s=stateFor(id);
        s[field]=el.value;
        if(s.date&&s.time&&s.shipping==="No")toast("Has indicado fecha/hora de expedición pero Envío sigue en No",true);
        if(s.shipping!=="No"&&(!s.date||!s.time))toast("Completa fecha y hora de expedición",true);
        if(s.status==="Finalizado"&&s.shipping==="No")toast("Reparto finalizado: revisa si debe marcarse el envío",true);
        if(s.serval==="Si"&&!String(s.comment||"").trim())toast("Serval = Sí requiere comentario",true);
        s.updatedAt=nowISO();
        save();
        toast("MSR guardado");
        render();
      });
    });

    const dd=$("#dashboardDate"); if(dd)dd.onchange=()=>{dashboardDate=dd.value;render()};
    const dtoday=$("#dashboardToday"); if(dtoday)dtoday.onclick=()=>{dashboardDate=today();render()};
    const capture=$("#captureModeBtn"); if(capture)capture.onclick=()=>document.body.classList.toggle("capture-mode");
    const printBtn=$("#printDashboardBtn"); if(printBtn)printBtn.onclick=()=>window.print();

    const hf=$("#hceDateFrom"); if(hf)hf.onchange=()=>{hceDateFrom=hf.value;render()};
    const ht=$("#hceDateTo"); if(ht)ht.onchange=()=>{hceDateTo=ht.value;render()};
    const hpfilter=$("#hceProcessFilter"); if(hpfilter)hpfilter.onchange=()=>{hceProcessFilter=hpfilter.value;render()};
    const htfilter=$("#hceTimingFilter"); if(htfilter)htfilter.onchange=()=>{hceTimingFilter=htfilter.value;render()};
    const hsort=$("#hceSortKey"); if(hsort)hsort.onchange=()=>{hceSortKey=hsort.value;render()};
    const hdir=$("#hceSortDir"); if(hdir)hdir.onchange=()=>{hceSortDir=hdir.value;render()};
    const hreset=$("#resetHCEFilters"); if(hreset)hreset.onclick=()=>{hceDateFrom="";hceDateTo="";hceProcessFilter="all";hceTimingFilter="all";hceSortKey="planDateTime";hceSortDir="asc";render()};

    document.querySelectorAll("[data-hce-key][data-hce-field]").forEach(el=>{
      el.addEventListener("change",()=>{
        const key=el.dataset.hceKey,field=el.dataset.hceField;
        const item=db.hce.find(x=>x.key===key);
        if(!item)return;
        item[field]=el.value;

        if(item.realDate&&item.realTime&&(item.process==="Pendiente de recibir"||!item.process)){
          item.process="Posicionado";
        }
        if(item.process!=="Pendiente de recibir"&&(!item.realDate||!item.realTime)){
          toast("Introduce fecha y hora de llegada antes de cambiar el estado",true);
          item.process="Pendiente de recibir";
        }

        item.updatedAt=nowISO();
        save();
        toast("HCE guardado");
        render();
      });
    });
    const backup=$("#backupBtn"); if(backup)backup.onclick=()=>download(`msr-hce-backup-${today()}.json`,JSON.stringify(db,null,2));
    const restore=$("#restoreBtn"),ri=$("#restoreInput"); if(restore)restore.onclick=()=>ri.click();
    if(ri)ri.onchange=e=>{
      const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const x=JSON.parse(rd.result);if(!x.version)throw 0;db=x;save();toast("Backup restaurado");render()}catch{toast("Backup no válido",true)}};rd.readAsText(f);
    };
    const reset=$("#resetBtn");if(reset)reset.onclick=()=>{
      if(!confirm("¿Borrar TODOS los datos de MSR, estados y HCE?"))return;
      if(!confirm("Confirmación final. ¿Borrar absolutamente todo?"))return;
      db=defaultData();save();if(window.MSRCloud?.enabled)window.MSRCloud.clear().catch(console.warn);toast("Datos eliminados");render();
    };
  }



  function openContainer(key){
    const c=db.hce.find(x=>x.key===key);if(!c)return;
    $("#containerDialogTitle").textContent=c.number||c.entryId||"HCE";
    $("#c-number").value=c.number||"";$("#c-entry").value=c.entryId||"";$("#c-plan-date").value=c.planDate||"";$("#c-plan-time").value=c.planTime||"";$("#c-plan-qty").value=c.plannedQty??"";$("#c-transporter").value=c.transporter||"";
    $("#c-real-date").value=c.realDate||"";$("#c-real-time").value=c.realTime||"";$("#c-process").value=c.process||"Pendiente de recibir";
    $("#c-dock").value=c.dock||"";$("#c-registered").value=c.registered||"No";$("#c-located").value=c.located||"No";$("#c-five").value=c.five||"No";
    $("#c-sample").value=c.sample||"Pendiente de sacar";$("#c-comment").value=c.comment||"";$("#containerDialog").dataset.key=key;$("#containerDialog").showModal();
  }
  $("#saveContainerBtn").onclick=()=>{
    const key=$("#containerDialog").dataset.key,c=db.hce.find(x=>x.key===key);if(!c)return;
    Object.assign(c,{realDate:$("#c-real-date").value,realTime:$("#c-real-time").value,process:$("#c-process").value,dock:$("#c-dock").value.trim(),
      registered:$("#c-registered").value,located:$("#c-located").value,five:$("#c-five").value,sample:$("#c-sample").value,comment:$("#c-comment").value.trim(),updatedAt:nowISO()});
    save();$("#containerDialog").close();toast("HCE actualizado");
    if(c.process==="Descargado")setTimeout(()=>alert("DESCARGADO: introduce la cantidad REAL en HCE y dale salida."),50);
    if(c.registered==="Si")setTimeout(()=>alert("MATRICULADO: en X, FINALIZA y después CIERRA la orden de descarga."),50);
    render();
  };

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

  function handleImport(file,kind){
    if(!file)return;
    if(!window.XLSX){toast("El lector Excel aún no se ha cargado. Prueba de nuevo en unos segundos.",true);return}
    const rd=new FileReader();
    rd.onload=e=>{
      try{
        let rows=[];
        const name=String(file.name||"").toLowerCase();

        if(name.endsWith(".csv")){
          const bytes=new Uint8Array(e.target.result);
          let text="";
          try{text=new TextDecoder("windows-1252").decode(bytes);}
          catch{text=new TextDecoder("utf-8").decode(bytes);}
          rows=parseSemicolonCSV(text);
        }else{
          const wb=XLSX.read(e.target.result,{type:"array",cellDates:true});
          const ws=wb.Sheets[wb.SheetNames[0]];
          rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:true});
        }

        const clean=rows.filter(r=>r.some(v=>String(v).trim()!==""));
        if(clean.length<2)throw new Error("Archivo vacío");

        // Primera fila = cabeceras. Nunca se importa como dato.
        const headers=clean[0].map(v=>String(v).trim());
        const data=clean.slice(1);

        if(kind==="msr")importMSR(headers,data); else importHCE(headers,data);
      }catch(err){
        console.error(err);
        toast("No he podido interpretar el archivo. Revisa que sea el export correcto.",true)
      }
    };
    rd.readAsArrayBuffer(file);
  }

  function importMSR(h,rows){
    const idx={
      id:findHeader(h,["Código","Codigo","ID OT de reparto","ID reparto","OT reparto"]),
      work:findHeader(h,["Orden de trabajo","Descripción","Descripcion"]),
      sourceStatus:findHeader(h,["Estado"]),
      store:findHeader(h,["Tienda"]),
      chain:findHeader(h,["Cadena"]),
      loadOT:findHeader(h,["Nº OT de carga","N OT de carga","OT de carga","numero ot carga"])
    };
    if(idx.id<0)throw new Error("No encuentro la columna Código");

    const inferPlanFromWork=(work)=>{
      const s=String(work||"").trim();
      const m=s.match(/_(\d{2})(\d{2})_(\d{1,2})(AM|PM)(?:_|$)/i);
      if(!m)return {date:"",time:""};
      const day=m[1],month=m[2];
      const year=String(new Date().getFullYear());
      let hour=Number(m[3]);
      const ap=m[4].toUpperCase();
      if(ap==="PM" && hour<12)hour+=12;
      if(ap==="AM" && hour===12)hour=0;
      return {date:`${year}-${month}-${day}`,time:`${String(hour).padStart(2,"0")}:00`};
    };

    const map=new Map();
    rows.forEach(r=>{
      const rawId=String(pick(r,idx.id)).trim();
      if(!rawId)return;
      const id=idNorm(rawId);
      if(!/^\d+$/.test(id))return;

      const work=String(pick(r,idx.work)).trim();
      const inferred=inferPlanFromWork(work);
      map.set(id,{
        id,
        planDate:inferred.date,
        planTime:inferred.time,
        description:work,
        loadOT:String(pick(r,idx.loadOT)).trim(),
        sourceStatus:String(pick(r,idx.sourceStatus)).trim(),
        store:String(pick(r,idx.store)).trim(),
        chain:String(pick(r,idx.chain)).trim()
      });
    });

    // Se carga TODO el fichero. No se elimina ninguna orden por fecha.
    db.msr=[...map.values()].sort((a,b)=>
      (`${a.planDate}${a.planTime}${String(a.id).padStart(12,"0")}`)
      .localeCompare(`${b.planDate}${b.planTime}${String(b.id).padStart(12,"0")}`)
    );
    db.msr.forEach(o=>stateFor(o.id));
    db.meta.msrImportedAt=nowISO();
    save();
    toast(`${db.msr.length} órdenes MSR importadas`);
    go("resumen");
  }

  function importHCE(h,rows){
    const idx={
      entry:findHeader(h,["ID ENTRADA","ID entrada","Entrada","ID"]),
      task:findHeader(h,["ID TAREA","ID tarea"]),
      planDate:findHeader(h,["FECHA PREVISTA","Fecha prevista","FECHA PLAN","Fecha plan"]),
      planTime:findHeader(h,["HORA PREVISTA","Hora prevista","HORA PLAN","Hora plan"]),
      number:findHeader(h,["MATRÍCULA","Matricula","Número contenedor","Numero contenedor","Contenedor"]),
      transporter:findHeader(h,["TRANSPORTISTA","Transportista"]),
      reason:findHeader(h,["RAZON","RAZÓN","Razon"]),
      qty:findHeader(h,["CANTIDAD","Cantidad"])
    };
    if(idx.entry<0 && idx.number<0)throw new Error("No encuentro ID ENTRADA / MATRÍCULA");

    const old=new Map(db.hce.map(c=>[c.key,c]));
    const grouped=new Map();

    rows.forEach(r=>{
      const entryId=String(pick(r,idx.entry)).trim();
      const number=String(pick(r,idx.number)).trim();
      if(!entryId && !number)return;
      const key=(number || entryId).toUpperCase();
      const qtyRaw=Number(pick(r,idx.qty)) || 0;

      if(!grouped.has(key)){
        grouped.set(key,{
          key,number,entryId,entryIds:entryId?[entryId]:[],
          taskId:String(pick(r,idx.task)).trim(),
          planDate:parseDate(pick(r,idx.planDate)),
          planTime:parseTime(pick(r,idx.planTime)),
          transporter:String(pick(r,idx.transporter)).trim(),
          reason:String(pick(r,idx.reason)).trim(),
          plannedQty:0,lines:0
        });
      }

      const g=grouped.get(key);
      g.plannedQty += qtyRaw;
      g.lines += 1;
      if(entryId && !g.entryIds.includes(entryId))g.entryIds.push(entryId);
      g.entryId=g.entryIds.join(", ");
      if(!g.number && number)g.number=number;
      if(!g.entryId && entryId)g.entryId=entryId;
      if(!g.planDate)g.planDate=parseDate(pick(r,idx.planDate));
      if(!g.planTime)g.planTime=parseTime(pick(r,idx.planTime));
      if(!g.transporter)g.transporter=String(pick(r,idx.transporter)).trim();
      if(!g.reason)g.reason=String(pick(r,idx.reason)).trim();
    });

    db.hce=[...grouped.values()].map(g=>{
      const prev=old.get(g.key)||{};
      return {
        ...g,
        realDate:prev.realDate||"",
        realTime:prev.realTime||"",
        process:prev.process||"Pendiente de recibir",
        updatedAt:prev.updatedAt||null
      };
    }).sort((a,b)=>(`${a.planDate}${a.planTime}`).localeCompare(`${b.planDate}${b.planTime}`));

    db.meta.hceImportedAt=nowISO();
    save();
    toast(`${db.hce.length} entradas HCE importadas y agrupadas`);
    go("hce");
  }

  document.querySelectorAll("#nav button").forEach(b=>b.onclick=()=>go(b.dataset.page));
  $("#menuBtn").onclick=()=>$("#sidebar").classList.toggle("open");
  $("#recalcBtn").onclick=()=>{db=load();toast("Datos actualizados");render()};
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("#installBtn").hidden=false});
  $("#installBtn").onclick=async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$("#installBtn").hidden=true};
  window.addEventListener("storage",e=>{if(e.key===STORAGE_KEY){db=load();render()}});
  if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.warn));

  async function bootstrapCloud(){
    if(!window.MSRCloud?.enabled)return;
    try{
      const cloud=await window.MSRCloud.load();
      if(cloud && cloud.version){
        db=cloud;
        localStorage.setItem(STORAGE_KEY,JSON.stringify(db));
        render();
        toast("Datos sincronizados desde la nube");
      }else{
        await window.MSRCloud.save(db);
      }
    }catch(err){console.warn("Cloud load",err);toast("Nube no disponible: usando copia local",true);}
  }

  const initial=location.hash.replace("#",""); go(pages[initial]?initial:"inicio");
  bootstrapCloud();
})();