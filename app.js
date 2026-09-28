/* MSR · HCE Control — static PWA for GitHub Pages */
(() => {
  "use strict";

  const STORAGE_KEY = "msr_hce_control_v1";
  const ADMIN_UNDO_KEY = "msr_hce_admin_undo_v1";
  const VERSION = 1;
  const defaultData = () => ({
    version: VERSION,
    msr: [],
    states: {},
    hce: [],
    meta: { updatedAt: null, msrImportedAt: null, hceImportedAt: null, lastImportReport: null }
  });

  let db = load();
  let page = "inicio";
  let deferredInstall = null;
  let summaryFilter = "all";
  let summaryDateFilter = "all";
  let summaryDateFrom = "";
  let summaryDateTo = "";
  let summaryShippingFilter = "all";
  let summaryServalFilter = "all";
  let summaryTextFilter = "";
  let summaryIdsFilter = [];
  let summarySortKey = "planDateTime";
  let summarySortDir = "asc";
  let dashboardDateFrom = today();
  let dashboardDateTo = today();
  let hceDateFrom = "";
  let hceDateTo = "";
  let hceProcessFilter = "all";
  let hceTimingFilter = "all";
  let hceSortKey = "planDateTime";
  let hceSortDir = "asc";
  let adminNotice = "";

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

  function msrTimeBadge(o,s){
    const t=timing(o,s);
    let cls="b-gray";
    if(t.includes("A TIEMPO"))cls="b-green";
    else if(t.includes("TARDE")||t.includes("RETRASO"))cls="b-red";
    else if(t.includes("FALTAN"))cls="b-blue";
    return `<span class="badge ${cls}">${esc(t)}</span>`;
  }

  function msrRowClass(o,s){
    if((s.serval||"No")==="Si")return "row-danger row-serval";
    const t=timing(o,s);
    if((s.shipping||"No")==="Total")return t.includes("TARDE")?"row-done-late":"row-success";
    if((s.shipping||"No")==="Parcial")return "row-warning";
    if(t.includes("RETRASO"))return "row-danger";
    if(t.includes("FALTAN"))return "row-info";
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


  function renderInicio(){
    const inDashboardRange=d=>{
      if(!d)return false;
      if(dashboardDateFrom && d<dashboardDateFrom)return false;
      if(dashboardDateTo && d>dashboardDateTo)return false;
      return true;
    };
    const msr=orderRows().filter(({o})=>inDashboardRange(o.planDate))
      .sort((a,b)=>(`${a.o.planDate}${a.o.planTime}`).localeCompare(`${b.o.planDate}${b.o.planTime}`));
    const hce=db.hce.filter(x=>inDashboardRange(x.planDate))
      .sort((a,b)=>(`${a.planDate}${a.planTime}`).localeCompare(`${b.planDate}${b.planTime}`));

    const msrNo=msr.filter(({s})=>(s.shipping||"No")==="No").length;
    const msrPartial=msr.filter(({s})=>(s.shipping||"No")==="Parcial").length;
    const msrTotal=msr.filter(({s})=>(s.shipping||"No")==="Total").length;
    const msrServal=msr.filter(({s})=>(s.serval||"No")==="Si").length;
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

    const rangeLabel=dashboardDateFrom||dashboardDateTo
      ? `${dashboardDateFrom?fmtDate(dashboardDateFrom):"Inicio"} → ${dashboardDateTo?fmtDate(dashboardDateTo):"Actualidad"}`
      : "Todas las fechas";

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
            <button class="btn success" id="captureModeBtn">🖼️ Vista captura</button>
            <button class="btn primary" id="saveDashboardImageBtn">📸 Guardar PNG</button>
            <button class="btn violet" id="printDashboardBtn">📄 PDF</button>
          </div>
        </div>
      </div>

      <button class="capture-exit capture-only" id="exitCaptureBtn">← Volver al panel</button>
      <section class="report-card" id="operationalReport">
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

        <div class="status-legend">
          <span class="legend success">🟢 Finalizado / a tiempo</span>
          <span class="legend warning">🟠 Parcial / pendiente</span>
          <span class="legend danger">🔴 Retraso / incidencia</span>
          <span class="legend info">🔵 En curso / próximo</span>
          <span class="legend purple">🟣 Descargando</span>
        </div>
        <div class="section-title">📋 Órdenes MSR</div>
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
            <thead><tr><th>⏱ Cumplimiento</th><th>🔢 Código</th><th>📝 Orden de trabajo</th><th>🏬 Tienda</th><th>🚚 Envío</th><th>🕒 Expedición</th><th>⚠️ Serval</th><th>💬 Comentario</th></tr></thead>
            <tbody>${msr.length?msr.map(({o,s})=>`<tr class="${msrRowClass(o,s)} ${s.serval==="Si"?"serval-alert":""}">
              <td>${msrTimeBadge(o,s)}</td>
              <td><strong>${esc(o.id)}</strong></td>
              <td class="wrap">${esc(o.description||"")}</td>
              <td>${esc(o.store||"")}</td>
              <td>${badge(s.shipping||"No")}</td>
              <td>${s.date?`${fmtDate(s.date)} · ${fmtTime(s.time)}`:"—"}</td>
              <td>${badge(s.serval||"No")}</td>
              <td class="wrap">${esc(s.comment||"")}</td>
            </tr>`).join(""):`<tr><td colspan="8" class="empty">No hay órdenes MSR en este periodo.</td></tr>`}</tbody>
          </table>
        </div>

        <div class="section-title hce-title">🚛 Contenedores HCE</div>
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
              <td>${timeBadge(hceTiming(x))}</td>
              <td><strong>${esc(x.number||x.entryId)}</strong></td>
              <td>${fmtDate(x.planDate)} · ${fmtTime(x.planTime)}</td>
              <td>${x.realDate?`${fmtDate(x.realDate)} · ${fmtTime(x.realTime)}`:"—"}</td>
              <td>${badge(x.process||"Pendiente de recibir")}</td>
            </tr>`).join(""):`<tr><td colspan="5" class="empty">No hay contenedores HCE en este periodo.</td></tr>`}</tbody>
          </table>
        </div>

        <div class="report-footer">MSR · HCE Control · Parte generado ${new Date().toLocaleString("es-ES")}</div>
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
      return `<table class="data-table"><thead><tr><th>Código</th><th>Orden de trabajo</th><th>Tienda</th></tr></thead><tbody>${rr.map(({o})=>`<tr><td><strong>${esc(o.id)}</strong></td><td class="wrap">${esc(o.description||"")}</td><td>${esc(o.store||"")}</td></tr>`).join("")}</tbody></table>`;
    }

    return `<table class="data-table msr-table"><thead><tr>
      <th>Código</th>
      <th>Orden de trabajo</th>
      <th>Tienda</th>
      <th>Envío</th>
      <th>Fecha expedición</th>
      <th>Hora expedición</th>
      <th>Serval</th>
      <th>Comentario</th>
    </tr></thead><tbody>${rr.map(({o,s})=>`<tr class="${msrRowClass(o,s)} ${s.serval==="Si"?"serval-alert":""}">
      <td><strong>${esc(o.id)}</strong></td>
      <td class="wrap msr-description">${esc(o.description||"")}</td>
      <td>${esc(o.store||"")}</td>
      <td><select class="msr-edit msr-select ${stateSelectClass("shipping",s.shipping||"No")}" data-msr-id="${esc(o.id)}" data-msr-field="shipping">${msrOptions(s.shipping||"No",["No","Parcial","Total"])}</select></td>
      <td><input class="msr-edit msr-date" type="date" data-msr-id="${esc(o.id)}" data-msr-field="date" value="${esc(s.date||"")}"></td>
      <td><input class="msr-edit msr-time" type="time" data-msr-id="${esc(o.id)}" data-msr-field="time" value="${esc(s.time||"")}"></td>
      <td><select class="msr-edit msr-select-short ${stateSelectClass("serval",s.serval||"No")} ${s.serval==="Si"?"serval-field":""}" data-msr-id="${esc(o.id)}" data-msr-field="serval">${msrOptions(s.serval||"No",["No","Si"])}</select></td>
      <td><textarea class="msr-edit msr-comment ${s.serval==="Si"?"serval-field":""}" rows="2" data-msr-id="${esc(o.id)}" data-msr-field="comment" placeholder="Comentario">${esc(s.comment||"")}</textarea></td>
    </tr>`).join("")}</tbody></table>`;
  }

  function renderResumen(){
    let rows=orderRows();

    if(summaryDateFilter!=="all")rows=rows.filter(({o})=>o.planDate===summaryDateFilter);
    if(summaryShippingFilter!=="all")rows=rows.filter(({s})=>(s.shipping||"No")===summaryShippingFilter);
    if(summaryServalFilter!=="all")rows=rows.filter(({s})=>(s.serval||"No")===summaryServalFilter);
    if(summaryTextFilter){
      const q=norm(summaryTextFilter);
      rows=rows.filter(({o,s})=>norm([o.id,o.description,o.store,s.comment].join(" ")).includes(q));
    }
    rows=sortSummaryRows(rows);

    const dates=[...new Set(db.msr.map(o=>o.planDate).filter(Boolean))].sort();

    content.innerHTML=`
      <div class="panel" style="margin-top:0">
        <div class="panel-head">
          <div>
            <h2>Resumen MSR</h2>
            <p>${rows.length} órdenes visibles de ${db.msr.length}. Los cambios se guardan automáticamente.</p>
          </div>
          <div class="actions">
            <button class="btn ghost" id="resetSummaryFilters">Limpiar filtros</button>
            <button class="btn danger-soft" id="clearMSRBtn">🧹 Limpiar MSR</button>
          </div>
        </div>
        <div class="memory-note">
          <strong>💾 Memoria de estados activa</strong>
          <span>Al limpiar MSR se borran solo las órdenes visibles. Los estados de cada Código se conservan y se recuperan si esa ID vuelve a aparecer en una importación futura.</span>
          <span class="memory-count">${Object.keys(db.states).length} IDs guardadas</span>
        </div>

        <div class="simple-filter-grid">
          <label>Fecha
            <select id="summaryDateFilter" class="filter-input">
              <option value="all">📅 Todas las fechas</option>
              ${dates.map(d=>`<option value="${esc(d)}" ${summaryDateFilter===d?"selected":""}>${fmtDate(d)}</option>`).join("")}
            </select>
          </label>

          <label>Envío
            <select id="summaryShippingFilter" class="filter-input">
              <option value="all" ${summaryShippingFilter==="all"?"selected":""}>🚚 Todos</option>
              <option value="No" ${summaryShippingFilter==="No"?"selected":""}>No</option>
              <option value="Parcial" ${summaryShippingFilter==="Parcial"?"selected":""}>Parcial</option>
              <option value="Total" ${summaryShippingFilter==="Total"?"selected":""}>Total</option>
            </select>
          </label>

          <label>Serval
            <select id="summaryServalFilter" class="filter-input">
              <option value="all" ${summaryServalFilter==="all"?"selected":""}>⚠️ Todos</option>
              <option value="No" ${summaryServalFilter==="No"?"selected":""}>No</option>
              <option value="Si" ${summaryServalFilter==="Si"?"selected":""}>Sí</option>
            </select>
          </label>

          <label>Buscar
            <input id="summaryTextFilter" class="filter-input" placeholder="Código, orden, tienda..." value="${esc(summaryTextFilter)}">
          </label>

          <label>Ordenar por
            <select id="summarySortKey" class="filter-input">
              <option value="planDateTime" ${summarySortKey==="planDateTime"?"selected":""}>Fecha prevista</option>
              <option value="id" ${summarySortKey==="id"?"selected":""}>Código</option>
              <option value="store" ${summarySortKey==="store"?"selected":""}>Tienda</option>
              <option value="shipping" ${summarySortKey==="shipping"?"selected":""}>Envío</option>
              <option value="sendDateTime" ${summarySortKey==="sendDateTime"?"selected":""}>Fecha/hora expedición</option>
              <option value="serval" ${summarySortKey==="serval"?"selected":""}>Serval</option>
            </select>
          </label>

          <label>Dirección
            <select id="summarySortDir" class="filter-input">
              <option value="asc" ${summarySortDir==="asc"?"selected":""}>Ascendente</option>
              <option value="desc" ${summarySortDir==="desc"?"selected":""}>Descendente</option>
            </select>
          </label>
        </div>

        <div class="table-wrap">${tableOrders(rows)}</div>
      </div>`;
  }

  function filterBtn(key,label){return `<button class="btn ${summaryFilter===key?"primary":"ghost"}" data-summary-filter="${esc(key)}">${label}</button>`}


  function hceTiming(c){
    const p=dt(c.planDate,c.planTime);
    if(!p)return {label:"⚪ SIN PREVISIÓN",hours:null,kind:"gray"};
    const a=dt(c.realDate,c.realTime);
    const ref=a||new Date();
    const diff=ref-p;
    const label=exactDurationLabel(diff);
    if(a){
      if(diff<=0)return {label:`🟢 A TIEMPO · ${label} antes`,hours:diff/36e5,kind:"green"};
      return {label:`🔴 TARDE · ${label}`,hours:diff/36e5,kind:"red"};
    }
    if(diff>0)return {label:`🔴 RETRASO · ${label}`,hours:diff/36e5,kind:"red"};
    return {label:`🔵 FALTAN · ${label}`,hours:diff/36e5,kind:"blue"};
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
          <div class="actions">
            <button class="btn ghost" id="resetHCEFilters">Limpiar filtros</button>
            <button class="btn danger-soft" id="clearHCEBtn">🧹 Limpiar HCE</button>
          </div>
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
      <tbody>${rows.map(x=>`<tr class="${hceRowClass(x)}">
        <td>${timeBadge(hceTiming(x))}</td>
        <td><strong>${esc(x.number||x.entryId)}</strong></td>
        <td>${fmtDate(x.planDate)}</td>
        <td>${fmtTime(x.planTime)}</td>
        <td><input class="hce-edit hce-date" type="date" data-hce-key="${esc(x.key)}" data-hce-field="realDate" value="${esc(x.realDate||"")}"></td>
        <td><input class="hce-edit hce-time" type="time" data-hce-key="${esc(x.key)}" data-hce-field="realTime" value="${esc(x.realTime||"")}"></td>
        <td><select class="hce-edit hce-select ${stateSelectClass("hce",x.process||"Pendiente de recibir")}" data-hce-key="${esc(x.key)}" data-hce-field="process">${msrOptions(x.process||"Pendiente de recibir",["Pendiente de recibir","Posicionado","Descargando","Descargado"])}</select></td>
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
                ${issueList.slice(0,60).map(x=>`<div class="issue-item ${x.level}">
                  <b>${x.level==="error"?"❌":"⚠️"} Línea ${x.line}</b>
                  <span>${esc(x.message)}</span>
                  ${x.value?`<code>${esc(x.value)}</code>`:""}
                </div>`).join("")}
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
        </div>
      </div>

      ${adminNotice?`<div class="admin-result"><strong>ℹ️ Resultado administrador</strong><pre>${esc(adminNotice)}</pre></div>`:""}

      <div class="panel admin-panel">
        <div class="panel-head">
          <div><h2>🔐 Centro de administrador</h2><p>Herramientas para localizar, corregir, recuperar o eliminar datos.</p></div>
          <span class="admin-badge">Contraseña requerida</span>
        </div>

        <div class="admin-help">
          <span>🟢 Seguro: consultar/exportar</span>
          <span>🟠 Precaución: reparar/sincronizar</span>
          <span>🔴 Destructivo: borrar</span>
        </div>

        <div class="admin-grid">
          <button class="admin-action safe" data-admin-action="inspect-id"><span>🔎</span><strong>Buscar una ID</strong><small>Ver si está activa y qué memoria tiene guardada</small></button>
          <button class="admin-action safe" data-admin-action="export-memory"><span>📤</span><strong>Exportar memoria</strong><small>Descarga todos los estados históricos</small></button>
          <button class="admin-action safe" data-admin-action="diag"><span>🧪</span><strong>Diagnóstico completo</strong><small>Datos + último informe de importación</small></button>

          <button class="admin-action warning" data-admin-action="pull"><span>☁️⬇️</span><strong>Nube → dispositivo</strong><small>Forzar descarga del estado compartido</small></button>
          <button class="admin-action warning" data-admin-action="push"><span>☁️⬆️</span><strong>Dispositivo → nube</strong><small>Forzar esta copia como estado compartido</small></button>
          <button class="admin-action warning" data-admin-action="repair"><span>🛠️</span><strong>Reparar estructura</strong><small>Normaliza IDs y elimina duplicados internos</small></button>
          <button class="admin-action warning" data-admin-action="restore-undo"><span>↩️</span><strong>Deshacer último cambio admin</strong><small>Restaura el último punto automático</small></button>

          <button class="admin-action danger-zone" data-admin-action="reset-id"><span>🧹</span><strong>Borrar memoria de ID</strong><small>Elimina solo su estado histórico guardado</small></button>
          <button class="admin-action danger-zone" data-admin-action="delete-id-all"><span>🗑️</span><strong>Borrar ID por completo</strong><small>Elimina orden activa y memoria de esa ID</small></button>
          <button class="admin-action danger-zone" data-admin-action="purge-orphans"><span>♻️</span><strong>Borrar memorias no activas</strong><small>Elimina estados de IDs que no están en el MSR actual</small></button>
          <button class="admin-action danger-zone" data-admin-action="clear-msr"><span>📦</span><strong>Vaciar MSR</strong><small>Conserva todas las memorias por ID</small></button>
          <button class="admin-action danger-zone" data-admin-action="clear-hce"><span>🚛</span><strong>Vaciar HCE</strong><small>Elimina planificación HCE actual</small></button>
        </div>
      </div>

      <div class="panel danger-admin">
        <div class="panel-head">
          <div><h2>🚨 Borrado total protegido</h2><p>Último recurso. Elimina MSR, HCE, memoria histórica y estado compartido.</p></div>
        </div>
        <div class="notice danger">Requiere contraseña + doble confirmación. Descarga un backup antes de usarlo.</div>
        <button class="btn danger" id="resetBtn">☢️ Borrar absolutamente todos los datos</button>
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

  async function runAdminAction(action){
    if(!(await adminAuth()))return;

    if(action==="inspect-id"){
      const raw=prompt("Código / ID MSR que quieres consultar");
      if(!raw)return;
      const info=adminStateSummary(raw);
      adminNotice=info
        ? `ID: ${info.id}\nActiva ahora: ${info.active?"Sí":"No"}\nOrden: ${info.order||"—"}\nTienda: ${info.store||"—"}\nEnvío: ${info.shipping}\nExpedición: ${info.date||"—"} ${info.time||""}\nServal: ${info.serval}\nComentario: ${info.comment||"—"}\nÚltimo cambio: ${info.updatedAt?new Date(info.updatedAt).toLocaleString("es-ES"):"—"}`
        : `No existe información guardada para la ID ${idNorm(raw)}.`;
      render();return;
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
    document.querySelectorAll("[data-go]").forEach(x=>x.onclick=()=>go(x.dataset.go));
    document.querySelectorAll("[data-summary-filter]").forEach(x=>x.onclick=()=>{summaryFilter=x.dataset.summaryFilter;render()});
    const sdf=$("#summaryDateFilter"); if(sdf)sdf.onchange=()=>{summaryDateFilter=sdf.value;render()};
    const sship=$("#summaryShippingFilter"); if(sship)sship.onchange=()=>{summaryShippingFilter=sship.value;render()};
    const sserv=$("#summaryServalFilter"); if(sserv)sserv.onchange=()=>{summaryServalFilter=sserv.value;render()};
    const stext=$("#summaryTextFilter"); if(stext)stext.onchange=()=>{summaryTextFilter=stext.value;render()};
    const skey=$("#summarySortKey"); if(skey)skey.onchange=()=>{summarySortKey=skey.value;render()};
    const sdir=$("#summarySortDir"); if(sdir)sdir.onchange=()=>{summarySortDir=sdir.value;render()};
    const sreset=$("#resetSummaryFilters"); if(sreset)sreset.onclick=()=>{
      summaryFilter="all";summaryDateFilter="all";summaryShippingFilter="all";summaryServalFilter="all";summaryTextFilter="";summarySortKey="planDateTime";summarySortDir="asc";render();
    };

    const clearMSR=$("#clearMSRBtn"); if(clearMSR)clearMSR.onclick=()=>{
      if(!db.msr.length){toast("No hay órdenes MSR para limpiar",true);return;}
      const remembered=Object.keys(db.states).length;
      if(!confirm(`¿Limpiar las ${db.msr.length} órdenes MSR actuales?\n\nLos estados guardados por ID NO se borrarán (${remembered} IDs con memoria).`))return;
      db.msr=[];
      db.meta.msrImportedAt=null;
      summaryDateFilter="all";
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

        if((field==="date"||field==="time") && ((s.date&&!s.time)||(!s.date&&s.time))){
          toast("⚠️ Expedición incompleta: indica fecha Y hora",true);
        }
        if(s.shipping!=="No"&&(!s.date||!s.time)){
          toast("⚠️ Envío marcado: falta completar fecha y hora de expedición",true);
        }
        if(s.shipping==="No"&&(s.date||s.time)){
          toast("⚠️ Hay fecha/hora de expedición pero Envío está en No",true);
        }
        if(s.serval==="Si"&&!String(s.comment||"").trim()){
          toast("⚠️ Serval = Sí: el comentario es obligatorio",true);
        }
        if(field==="comment" && s.serval==="Si" && !String(s.comment||"").trim()){
          s.comment=previous.comment||"";
          toast("No puedes dejar vacío el comentario mientras Serval sea Sí",true);
          render();
          return;
        }

        s.updatedAt=nowISO();
        save();
        toast("✓ MSR guardado");
        render();
      });
    });

    const dfrom=$("#dashboardDateFrom"); if(dfrom)dfrom.onchange=()=>{dashboardDateFrom=dfrom.value;if(dashboardDateTo&&dashboardDateFrom>dashboardDateTo)dashboardDateTo=dashboardDateFrom;render()};
    const dto=$("#dashboardDateTo"); if(dto)dto.onchange=()=>{dashboardDateTo=dto.value;if(dashboardDateFrom&&dashboardDateTo<dashboardDateFrom)dashboardDateFrom=dashboardDateTo;render()};
    const dtoday=$("#dashboardToday"); if(dtoday)dtoday.onclick=()=>{dashboardDateFrom=today();dashboardDateTo=today();render()};
    const dy=$("#dashboardYesterday"); if(dy)dy.onclick=()=>{
      const d=new Date();d.setDate(d.getDate()-1);const y=d.toISOString().slice(0,10);
      dashboardDateFrom=y;dashboardDateTo=y;render();
    };
    const d48=$("#dashboard48h"); if(d48)d48.onclick=()=>{
      const end=today();const d=new Date();d.setDate(d.getDate()-1);
      dashboardDateFrom=d.toISOString().slice(0,10);dashboardDateTo=end;render();
    };
    const dall=$("#dashboardAll"); if(dall)dall.onclick=()=>{dashboardDateFrom="";dashboardDateTo="";render()};
    const capture=$("#captureModeBtn"); if(capture)capture.onclick=()=>{
      document.body.classList.add("capture-mode");
      window.scrollTo({top:0,behavior:"smooth"});
    };
    const exitCapture=$("#exitCaptureBtn"); if(exitCapture)exitCapture.onclick=()=>document.body.classList.remove("capture-mode");
    const printBtn=$("#printDashboardBtn"); if(printBtn)printBtn.onclick=()=>window.print();
    const saveImg=$("#saveDashboardImageBtn"); if(saveImg)saveImg.onclick=async()=>{
      const report=$("#operationalReport");
      if(!report||!window.html2canvas){toast("No se puede generar la imagen ahora",true);return;}
      try{
        toast("Generando imagen...");
        const canvas=await window.html2canvas(report,{scale:2,backgroundColor:"#ffffff",useCORS:true});
        const a=document.createElement("a");
        a.download=`parte-operativo-${today()}.png`;
        a.href=canvas.toDataURL("image/png");
        a.click();
        toast("📸 Imagen PNG generada");
      }catch(e){console.warn(e);toast("Error al generar PNG",true);}
    };

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
        const previous={...item};
        item[field]=el.value;

        if((field==="realDate"||field==="realTime")&&((item.realDate&&!item.realTime)||(!item.realDate&&item.realTime))){
          toast("⚠️ Llegada incompleta: indica fecha Y hora",true);
        }

        if(item.realDate&&item.realTime&&(item.process==="Pendiente de recibir"||!item.process)){
          item.process="Posicionado";
          toast("✓ Llegada registrada · estado cambiado a Posicionado");
        }

        if(item.process!=="Pendiente de recibir"&&(!item.realDate||!item.realTime)){
          item.process="Pendiente de recibir";
          item.realDate=previous.realDate||item.realDate;
          item.realTime=previous.realTime||item.realTime;
          toast("⚠️ Primero debes registrar fecha y hora de llegada",true);
        }

        item.updatedAt=nowISO();
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

    document.querySelectorAll("[data-admin-action]").forEach(btn=>btn.onclick=()=>runAdminAction(btn.dataset.adminAction));
    const backup=$("#backupBtn"); if(backup)backup.onclick=()=>download(`msr-hce-backup-${today()}.json`,JSON.stringify(db,null,2));
    const restore=$("#restoreBtn"),ri=$("#restoreInput"); if(restore)restore.onclick=async()=>{if(await adminAuth())ri.click();};
    if(ri)ri.onchange=e=>{
      const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const x=JSON.parse(rd.result);if(!x.version)throw 0;makeAdminSnapshot("Antes de restaurar backup");db=x;save();adminNotice="Backup restaurado correctamente.";toast("Backup restaurado");render()}catch{toast("Backup no válido",true)}};rd.readAsText(f);
    };
    const reset=$("#resetBtn");if(reset)reset.onclick=async()=>{
      if(!(await adminAuth()))return;
      if(!confirm("¿Borrar TODOS los datos de MSR, estados y HCE?"))return;
      if(!confirm("Confirmación FINAL: también se eliminará la memoria histórica y la nube. ¿Continuar?"))return;
      makeAdminSnapshot("Antes del borrado total");db=defaultData();save();if(window.MSRCloud?.enabled)window.MSRCloud.clear().catch(console.warn);adminNotice="Se ejecutó un borrado total.";toast("Datos eliminados");render();
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

    const errors=[],warnings=[];
    const inferPlanFromWork=(work)=>{
      const s=String(work||"").trim();
      const m=s.match(/_(\d{2})(\d{2})_(\d{1,2})(AM|PM)(?:_|$)/i);
      if(!m)return {date:"",time:""};
      const day=m[1],month=m[2],year=String(new Date().getFullYear());
      let hour=Number(m[3]);const ap=m[4].toUpperCase();
      if(ap==="PM"&&hour<12)hour+=12;if(ap==="AM"&&hour===12)hour=0;
      return {date:`${year}-${month}-${day}`,time:`${String(hour).padStart(2,"0")}:00`};
    };

    const map=new Map();
    rows.forEach((r,i)=>{
      const line=i+2;
      const rawId=String(pick(r,idx.id)).trim();
      if(!rawId){errors.push({line,message:"Código/ID vacío. La línea no se ha importado."});return;}
      const id=idNorm(rawId);
      if(!/^\d+$/.test(id)){errors.push({line,message:"Código/ID no numérico. La línea no se ha importado.",value:rawId});return;}

      const work=String(pick(r,idx.work)).trim();
      const store=String(pick(r,idx.store)).trim();
      const inferred=inferPlanFromWork(work);
      if(!work)warnings.push({line,message:"Orden de trabajo vacía.",value:id});
      if(!store)warnings.push({line,message:"Tienda vacía.",value:id});
      if(!inferred.date||!inferred.time)warnings.push({line,message:"No se pudo obtener fecha/hora prevista desde Orden de trabajo.",value:work||id});
      if(map.has(id))warnings.push({line,message:"ID duplicada en el fichero; se conserva la última aparición.",value:id});

      map.set(id,{
        id,planDate:inferred.date,planTime:inferred.time,description:work,
        loadOT:String(pick(r,idx.loadOT)).trim(),
        sourceStatus:String(pick(r,idx.sourceStatus)).trim(),
        store,chain:String(pick(r,idx.chain)).trim()
      });
    });

    db.msr=[...map.values()].sort((a,b)=>
      (`${a.planDate}${a.planTime}${String(a.id).padStart(12,"0")}`)
      .localeCompare(`${b.planDate}${b.planTime}${String(b.id).padStart(12,"0")}`)
    );
    db.msr.forEach(o=>stateFor(o.id));
    db.meta.msrImportedAt=nowISO();
    db.meta.lastImportReport={kind:"msr",at:nowISO(),totalRows:rows.length,imported:db.msr.length,errors,warnings};
    save();
    toast(errors.length?`⚠️ MSR: ${db.msr.length} importadas · ${errors.length} errores`:`✅ ${db.msr.length} órdenes MSR importadas`,errors.length>0);
    go(errors.length||warnings.length?"import-msr":"resumen");
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
    if(idx.entry<0&&idx.number<0)throw new Error("No encuentro ID ENTRADA / MATRÍCULA");

    const errors=[],warnings=[];
    const old=new Map(db.hce.map(c=>[c.key,c]));
    const grouped=new Map();

    rows.forEach((r,i)=>{
      const line=i+2;
      const entryId=String(pick(r,idx.entry)).trim();
      const number=String(pick(r,idx.number)).trim();
      if(!entryId&&!number){errors.push({line,message:"Falta ID ENTRADA y MATRÍCULA. Línea omitida."});return;}
      const key=(number||entryId).toUpperCase();
      const planDate=parseDate(pick(r,idx.planDate));
      const planTime=parseTime(pick(r,idx.planTime));
      if(!planDate)warnings.push({line,message:"Fecha prevista vacía o no reconocida.",value:number||entryId});
      if(!planTime)warnings.push({line,message:"Hora prevista vacía o no reconocida.",value:number||entryId});

      const rawQty=pick(r,idx.qty);
      const qtyRaw=Number(rawQty)||0;
      if(rawQty!==""&&!Number.isFinite(Number(rawQty)))warnings.push({line,message:"Cantidad no numérica; se toma como 0.",value:String(rawQty)});

      if(!grouped.has(key)){
        grouped.set(key,{
          key,number,entryId,entryIds:entryId?[entryId]:[],
          taskId:String(pick(r,idx.task)).trim(),
          planDate,planTime,
          transporter:String(pick(r,idx.transporter)).trim(),
          reason:String(pick(r,idx.reason)).trim(),
          plannedQty:0,lines:0
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

    db.hce=[...grouped.values()].map(g=>{
      const prev=old.get(g.key)||{};
      return {...g,realDate:prev.realDate||"",realTime:prev.realTime||"",process:prev.process||"Pendiente de recibir",updatedAt:prev.updatedAt||null};
    }).sort((a,b)=>(`${a.planDate}${a.planTime}`).localeCompare(`${b.planDate}${b.planTime}`));

    db.meta.hceImportedAt=nowISO();
    db.meta.lastImportReport={kind:"hce",at:nowISO(),totalRows:rows.length,imported:db.hce.length,errors,warnings};
    save();
    toast(errors.length?`⚠️ HCE: ${db.hce.length} contenedores · ${errors.length} errores`:`✅ ${db.hce.length} contenedores HCE importados`,errors.length>0);
    go(errors.length||warnings.length?"import-hce":"hce");
  }

  document.querySelectorAll("#nav button").forEach(b=>b.onclick=()=>go(b.dataset.page));
  $("#menuBtn").onclick=()=>$("#sidebar").classList.toggle("open");
  $("#recalcBtn").onclick=()=>{db=load();toast("Datos actualizados");render()};
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("#installBtn").hidden=false});
  $("#installBtn").onclick=async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$("#installBtn").hidden=true};
  window.addEventListener("storage",e=>{if(e.key===STORAGE_KEY){db=load();render()}});
  window.addEventListener("keydown",e=>{
    if(document.body.classList.contains("capture-mode")&&e.key==="Escape")document.body.classList.remove("capture-mode");
  });
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

      window.MSRCloud.subscribe(next=>{
        if(!next || !next.version)return;
        const incoming=JSON.stringify(next);
        const current=JSON.stringify(db);
        if(incoming===current)return;
        db=next;
        localStorage.setItem(STORAGE_KEY,incoming);
        render();
        toast("Cambios recibidos en directo");
      });
    }catch(err){
      console.warn("Cloud load",err);
      setTimeout(()=>toast("Nube temporalmente no disponible · la app sigue funcionando en local",true),300);
    }
  }

  const initial=location.hash.replace("#",""); go(pages[initial]?initial:"inicio");
  bootstrapCloud();
})();