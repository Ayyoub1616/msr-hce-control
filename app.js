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
  let stateView = { ids: [], showAll: false };
  let summaryFilter = "all";
  let summaryDateFilter = "all";

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
    if(!db.states[k]) db.states[k]={id:k,status:"Pendiente",date:"",time:"",shipping:"No",total:"",sent:"",serval:"No",comment:"",note:"",updatedAt:null};
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
    if(s?.shipping==="Parcial"){
      const left=palletsLeft(s);
      let x=`FALTAN ${left===""?"?":left} PALLETS`;
      if(p&&a){const h=(a-p)/36e5;x+=h<=0?` · ${Math.abs(h).toFixed(1)} h antes`:` · ${h.toFixed(1)} h tarde`;}
      return x;
    }
    if(s?.shipping==="Total"){
      if(p&&a){const h=(a-p)/36e5;return `EXPEDIDO TOTAL · ${h<=0?Math.abs(h).toFixed(1)+" h antes":h.toFixed(1)+" h tarde"}`;}
      return "EXPEDIDO TOTAL";
    }
    if(p){const h=(new Date()-p)/36e5;return h>0?`${h.toFixed(1)} h de retraso`:`faltan ${Math.abs(h).toFixed(1)} h`;}
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
    estados:["Editar estados","Busca varias IDs, edita y conserva el histórico"],
    hce:["Contenedores HCE","Recepción, descarga y checklist operativo"],
    "import-msr":["Importar MSR","Carga el export MSR sin borrar estados manuales"],
    "import-hce":["Importar HCE","Carga la planificación HCE del día"],
    datos:["Datos / copias","Backup, restauración y limpieza"]
  };

  function go(p){
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
    const k=kpis(), recent=db.msr.slice().sort((a,b)=>(`${b.planDate}${b.planTime}`).localeCompare(`${a.planDate}${a.planTime}`)).slice(0,8);
    content.innerHTML=`
      <div class="grid kpis">
        ${kpi("Órdenes MSR",k.total,"Total importadas")}
        ${kpi("Expedidas",k.sent,"Envío total")}
        ${kpi("Parciales",k.partial,`${k.left} pallets pendientes`)}
        ${kpi("Retrasos",k.late,"Órdenes abiertas fuera de hora")}
        ${kpi("Contenedores HCE",k.htotal,"Planificación cargada")}
        ${kpi("Descargados",k.unloaded,"Proceso finalizado")}
        ${kpi("Pendientes HCE",k.hpending,"Por finalizar")}
        ${kpi("Última actualización",db.meta.updatedAt?new Date(db.meta.updatedAt).toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"}):"—","Guardado local")}
      </div>
      <div class="grid two-col">
        <div class="panel">
          <div class="panel-head"><div><h2>Prioridad MSR</h2><p>Órdenes recientes y su situación actual.</p></div><button class="btn ghost" data-go="resumen">Ver resumen</button></div>
          <div class="table-wrap">${tableOrders(recent,true)}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h2>Estado HCE</h2><p>Lectura rápida de la recepción del día.</p></div><button class="btn ghost" data-go="hce">Ver HCE</button></div>
          <div class="grid mini-cards">
            <div class="mini"><strong>${k.htotal}</strong><small>Previstos</small></div>
            <div class="mini"><strong>${k.unloaded}</strong><small>Descargados</small></div>
            <div class="mini"><strong>${k.hpending}</strong><small>Pendientes</small></div>
          </div>
          <div class="statline"><span style="width:${k.htotal?Math.round(k.unloaded/k.htotal*100):0}%"></span></div>
          <div class="notice" style="margin-top:16px">La app conserva los estados por ID aunque vuelvas a importar el MSR. La importación actualiza planificación, no borra tu histórico manual.</div>
        </div>
      </div>`;
  }
  function kpi(label,value,hint){return `<div class="kpi"><small>${label}</small><strong>${esc(value)}</strong><div class="hint">${hint}</div></div>`}

  function orderRows(){
    return db.msr.map(o=>({o,s:db.states[idNorm(o.id)]||{id:idNorm(o.id),status:"Pendiente",shipping:"No",serval:"No"}}))
      .sort((a,b)=>(`${a.o.planDate}${a.o.planTime}`).localeCompare(`${b.o.planDate}${b.o.planTime}`));
  }
  function tableOrders(rows,compact=false){
    const rr=rows.map(x=>x.o?x:{o:x,s:db.states[idNorm(x.id)]||{}});
    if(!rr.length)return `<div class="empty">No hay órdenes MSR importadas.</div>`;
    const head=compact?`<th>Situación</th><th>Fecha</th><th>Hora</th><th>ID</th><th>OT</th>`:
      `<th>Situación</th><th>Fecha prev.</th><th>Hora</th><th>ID</th><th>OT</th><th>Estado</th><th>Envío</th><th>Fecha envío</th><th>Hora</th><th>Serval</th><th>Comentario</th><th>Pallets / tiempo</th>`;
    const body=rr.map(({o,s})=> compact?
      `<tr class="clickable" data-edit-id="${esc(o.id)}"><td>${badge(situation(o))}</td><td>${fmtDate(o.planDate)}</td><td>${fmtTime(o.planTime)}</td><td><strong>${esc(o.id)}</strong></td><td>${esc(o.loadOT||"")}</td></tr>`:
      `<tr class="clickable" data-edit-id="${esc(o.id)}"><td>${badge(situation(o))}</td><td>${fmtDate(o.planDate)}</td><td>${fmtTime(o.planTime)}</td><td><strong>${esc(o.id)}</strong></td><td>${esc(o.loadOT||"")}</td><td>${badge(s.status||"Pendiente")}</td><td>${badge(s.shipping||"No")}</td><td>${fmtDate(s.date)}</td><td>${fmtTime(s.time)}</td><td>${badge(s.serval||"No")}</td><td class="wrap">${esc(s.comment||"")}</td><td class="wrap">${esc(timing(o,s))}</td></tr>`
    ).join("");
    return `<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function renderResumen(){
    let rows=orderRows();
    const dates=[...new Set(db.msr.map(o=>o.planDate).filter(Boolean))].sort();
    if(summaryDateFilter!=="all") rows=rows.filter(({o})=>o.planDate===summaryDateFilter);
    if(summaryFilter!=="all") rows=rows.filter(({o})=>situation(o)===summaryFilter);
    content.innerHTML=`
      <div class="panel" style="margin-top:0">
        <div class="panel-head">
          <div><h2>Resumen MSR</h2><p>${rows.length} órdenes visibles de ${db.msr.length}. El filtro no borra datos.</p></div>
          <div class="filters">
            <select id="summaryDateFilter" class="filter-input">
              <option value="all">Todas las fechas</option>
              ${dates.map(d=>`<option value="${esc(d)}" ${summaryDateFilter===d?"selected":""}>${fmtDate(d)}</option>`).join("")}
            </select>
            ${filterBtn("all","Todas")}${filterBtn("PENDIENTE","Pendientes")}${filterBtn("RETRASO","Retrasos")}${filterBtn("EXPEDIDO PARCIAL","Parciales")}${filterBtn("EXPEDIDO","Expedidas")}
          </div>
        </div>
        <div class="table-wrap">${tableOrders(rows)}</div>
      </div>`;
  }
  function filterBtn(key,label){return `<button class="btn ${summaryFilter===key?"primary":"ghost"}" data-summary-filter="${esc(key)}">${label}</button>`}

  function renderEstados(){
    let states=Object.values(db.states);
    if(stateView.ids.length) states=states.filter(s=>stateView.ids.includes(idNorm(s.id)));
    else if(!stateView.showAll) states=[];
    states.sort((a,b)=>Number(a.id)-Number(b.id)||String(a.id).localeCompare(String(b.id)));
    content.innerHTML=`
      <div class="panel" style="margin-top:0">
        <div class="panel-head">
          <div><h2>Buscador de IDs</h2><p>Introduce una o varias IDs separadas por espacio, coma o salto de línea.</p></div>
          <div class="actions">
            <button class="btn violet" id="newStateBtn">➕ Nueva ID</button>
            <button class="btn ${stateView.showAll?"success":"ghost"}" id="toggleAllStates">${stateView.showAll?"🙈 Ocultar todas":"📋 Mostrar todas"}</button>
            <button class="btn danger" id="clearAllStates">🗑 Borrar todas las IDs</button>
          </div>
        </div>
        <div class="searchbar">
          <input class="ids-input" id="idsSearch" placeholder="Ej.: 289, 327, 417, 440" value="${esc(stateView.ids.join(", "))}">
          <button class="btn primary" id="filterStates">🔎 Filtrar</button>
          <button class="btn ghost" id="clearStateFilter">Limpiar</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h2>${stateView.ids.length?"IDs filtradas":stateView.showAll?"Histórico completo":"Modo buscador"}</h2>
        <p>${states.length?states.length+" registros visibles":"El histórico permanece guardado pero oculto."}</p></div></div>
        <div class="table-wrap">${tableStates(states)}</div>
      </div>`;
  }
  function tableStates(states){
    if(!states.length)return `<div class="empty">Escribe IDs y pulsa Filtrar, o usa Mostrar todas.</div>`;
    return `<table class="data-table"><thead><tr><th>ID</th><th>Estado</th><th>Fecha envío</th><th>Hora</th><th>Envío</th><th>Pallets total</th><th>Enviados</th><th>Quedan</th><th>Serval</th><th>Comentario</th></tr></thead>
    <tbody>${states.map(s=>`<tr class="clickable" data-edit-id="${esc(s.id)}"><td><strong>${esc(s.id)}</strong></td><td>${badge(s.status)}</td><td>${fmtDate(s.date)}</td><td>${fmtTime(s.time)}</td><td>${badge(s.shipping)}</td><td>${esc(s.total)}</td><td>${esc(s.sent)}</td><td>${esc(palletsLeft(s))}</td><td>${badge(s.serval)}</td><td class="wrap">${esc(s.comment)}</td></tr>`).join("")}</tbody></table>`;
  }

  function containerStatus(c){
    if(c.process==="Descargado")return "Descargado";
    if(c.process==="Descargando")return "Descargando";
    if(c.process==="Posicionado")return "Posicionado";
    const p=dt(c.planDate,c.planTime);
    return p && new Date()>p?"Retraso":"Pendiente de recibir";
  }
  function renderHCE(){
    const rows=db.hce.slice().sort((a,b)=>(`${a.planDate}${a.planTime}`).localeCompare(`${b.planDate}${b.planTime}`));
    content.innerHTML=`
      <div class="panel" style="margin-top:0">
        <div class="panel-head">
          <div><h2>Contenedores HCE</h2><p>Rellena directamente cada fila. Los cambios se guardan automáticamente.</p></div>
          <div class="actions"><button class="btn danger" id="clearHCEBtn">🧹 Borrar HCE / nueva actualización</button></div>
        </div>
        <div class="table-wrap">${tableHCE(rows)}</div>
      </div>`;
  }
  function hceOptions(current, options){
    return options.map(v=>`<option value="${esc(v)}" ${current===v?"selected":""}>${esc(v)}</option>`).join("");
  }

  function tableHCE(rows){
    if(!rows.length)return `<div class="empty">No hay planificación HCE importada.</div>`;
    return `<table class="data-table hce-table"><thead><tr><th>Estado</th><th>Contenedor</th><th>ID entrada</th><th>Fecha prev.</th><th>Hora</th><th>Cantidad plan.</th><th>Transportista</th><th>Fecha real</th><th>Hora real</th><th>Proceso</th><th>Muelle</th><th>Matriculado</th><th>Ubicado</th><th>5%</th><th>Muestra</th><th>Comentario</th></tr></thead>
      <tbody>${rows.map(c=>`<tr>
        <td class="hce-status">${badge(containerStatus(c))}</td>
        <td><strong>${esc(c.number)}</strong></td>
        <td class="wrap">${esc(c.entryId)}</td>
        <td>${fmtDate(c.planDate)}</td>
        <td>${fmtTime(c.planTime)}</td>
        <td>${esc(c.plannedQty||0)}</td>
        <td class="wrap">${esc(c.transporter||"")}</td>
        <td><input class="hce-edit hce-date" type="date" data-hce-key="${esc(c.key)}" data-hce-field="realDate" value="${esc(c.realDate||"")}"></td>
        <td><input class="hce-edit hce-time" type="time" data-hce-key="${esc(c.key)}" data-hce-field="realTime" value="${esc(c.realTime||"")}"></td>
        <td><select class="hce-edit hce-select" data-hce-key="${esc(c.key)}" data-hce-field="process">${hceOptions(c.process||"Pendiente de recibir",["Pendiente de recibir","Posicionado","Descargando","Descargado"])}</select></td>
        <td><input class="hce-edit hce-dock" type="text" data-hce-key="${esc(c.key)}" data-hce-field="dock" value="${esc(c.dock||"")}" placeholder="Muelle"></td>
        <td><select class="hce-edit hce-select" data-hce-key="${esc(c.key)}" data-hce-field="registered">${hceOptions(c.registered||"No",["No","Si"])}</select></td>
        <td><select class="hce-edit hce-select" data-hce-key="${esc(c.key)}" data-hce-field="located">${hceOptions(c.located||"No",["No","En proceso","Si"])}</select></td>
        <td><select class="hce-edit hce-select" data-hce-key="${esc(c.key)}" data-hce-field="five">${hceOptions(c.five||"No",["No","En proceso","Si"])}</select></td>
        <td><select class="hce-edit hce-sample" data-hce-key="${esc(c.key)}" data-hce-field="sample">${hceOptions(c.sample||"Pendiente de sacar",["Pendiente de sacar","No solicitada","Sacada"])}</select></td>
        <td><textarea class="hce-edit hce-comment" rows="2" data-hce-key="${esc(c.key)}" data-hce-field="comment" placeholder="Comentario">${esc(c.comment||"")}</textarea></td>
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
    if(page==="estados")renderEstados();
    if(page==="hce")renderHCE();
    if(page==="import-msr")renderImport("msr");
    if(page==="import-hce")renderImport("hce");
    if(page==="datos")renderDatos();
    bindPage();
  }

  function bindPage(){
    document.querySelectorAll("[data-go]").forEach(x=>x.onclick=()=>go(x.dataset.go));
    document.querySelectorAll("[data-edit-id]").forEach(x=>x.onclick=()=>openState(x.dataset.editId));
    document.querySelectorAll("[data-summary-filter]").forEach(x=>x.onclick=()=>{summaryFilter=x.dataset.summaryFilter;render()});
    const sdf=$("#summaryDateFilter"); if(sdf)sdf.onchange=()=>{summaryDateFilter=sdf.value;render()};
    document.querySelectorAll("[data-hce-key][data-hce-field]").forEach(el=>{
      el.addEventListener("change",()=>{
        const key=el.dataset.hceKey, field=el.dataset.hceField;
        const item=db.hce.find(x=>x.key===key);
        if(!item)return;
        item[field]=el.value;
        item.updatedAt=nowISO();
        save();

        if(field==="process" && el.value==="Descargado"){
          alert("DESCARGADO: introduce la cantidad REAL en HCE y dale salida.");
        }
        if(field==="registered" && el.value==="Si"){
          alert("MATRICULADO: en X, FINALIZA y después CIERRA la orden de descarga.");
        }

        toast("HCE guardado");
        if(field==="process" || field==="realDate" || field==="realTime")render();
      });
    });

    const filter=$("#filterStates"); if(filter)filter.onclick=()=>{
      const ids=$("#idsSearch").value.split(/[\s,;|]+/).map(idNorm).filter(Boolean);
      stateView.ids=[...new Set(ids)].sort((a,b)=>Number(a)-Number(b)); stateView.showAll=false;
      // create missing records automatically, mirroring Excel workflow
      const missing=stateView.ids.filter(id=>!db.states[id]);
      if(missing.length && confirm(`${missing.length} ID(s) no existen. ¿Quieres crearlas ahora?`)){
        missing.forEach(id=>stateFor(id)); save(); toast("IDs nuevas creadas");
      }
      render();
    };
    const clear=$("#clearStateFilter"); if(clear)clear.onclick=()=>{stateView.ids=[];stateView.showAll=false;render()};
    const toggle=$("#toggleAllStates"); if(toggle)toggle.onclick=()=>{stateView.ids=[];stateView.showAll=!stateView.showAll;render()};
    const nw=$("#newStateBtn"); if(nw)nw.onclick=()=>{const id=idNorm(prompt("Nueva ID:")||"");if(!id)return;if(db.states[id])return openState(id);stateFor(id);save();stateView.ids=[id];stateView.showAll=false;openState(id)};
    const clearAll=$("#clearAllStates"); if(clearAll)clearAll.onclick=()=>{
      if(!confirm("Se borrarán TODAS las IDs y todos sus estados. ¿Continuar?"))return;
      if(!confirm("Segunda confirmación: esta acción no se puede deshacer salvo que tengas backup. ¿Borrar?"))return;
      db.states={};save();stateView={ids:[],showAll:false};toast("Histórico de estados eliminado");render();
    };
    const ch=$("#clearHCEBtn"); if(ch)ch.onclick=()=>{
      if(!confirm("¿Borrar toda la planificación HCE y el checklist actual?"))return;
      db.hce=[];db.meta.hceImportedAt=null;save();toast("HCE limpio");render();
    };
    const fi=$("#fileInput"); if(fi)fi.onchange=e=>handleImport(e.target.files[0],page==="import-msr"?"msr":"hce");
    const dz=$("#dropZone"); if(dz){
      ["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("drag")}));
      ["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("drag")}));
      dz.addEventListener("drop",e=>handleImport(e.dataTransfer.files[0],page==="import-msr"?"msr":"hce"));
    }
    const backup=$("#backupBtn"); if(backup)backup.onclick=()=>download(`msr-hce-backup-${today()}.json`,JSON.stringify(db,null,2));
    const restore=$("#restoreBtn"),ri=$("#restoreInput"); if(restore)restore.onclick=()=>ri.click();
    if(ri)ri.onchange=e=>{
      const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const x=JSON.parse(rd.result);if(!x.version)throw 0;db=x;save();toast("Backup restaurado");render()}catch{toast("Backup no válido",true)}};rd.readAsText(f);
    };
    const reset=$("#resetBtn");if(reset)reset.onclick=()=>{
      if(!confirm("¿Borrar TODOS los datos de MSR, estados y HCE?"))return;
      if(!confirm("Confirmación final. ¿Borrar absolutamente todo?"))return;
      db=defaultData();save();toast("Datos eliminados");render();
    };
  }

  function openState(id){
    const s=stateFor(id); save();
    $("#stateDialogTitle").textContent=`ID ${id}`;
    $("#f-id").value=s.id;$("#f-status").value=s.status||"Pendiente";$("#f-date").value=s.date||"";$("#f-time").value=s.time||"";
    $("#f-shipping").value=s.shipping||"No";$("#f-total").value=s.total??"";$("#f-sent").value=s.sent??"";$("#f-left").value=palletsLeft(s);
    $("#f-serval").value=s.serval||"No";$("#f-comment").value=s.comment||"";$("#f-note").value=s.note||"";
    calcLeft();$("#stateDialog").showModal();
  }
  function calcLeft(){const t=Number($("#f-total").value),s=Number($("#f-sent").value);$("#f-left").value=(Number.isFinite(t)&&Number.isFinite(s))?Math.max(0,t-s):""}
  $("#f-total").oninput=calcLeft;$("#f-sent").oninput=calcLeft;
  $("#saveStateBtn").onclick=()=>{
    const id=idNorm($("#f-id").value), total=$("#f-total").value,sent=$("#f-sent").value;
    if(total!==""&&sent!==""&&Number(sent)>Number(total))return toast("Pallets enviados no puede superar pallets total",true);
    const shipping=$("#f-shipping").value;
    if(shipping==="Parcial"&&(total===""||sent===""))return toast("En envío parcial completa pallets total y enviados",true);
    const serval=$("#f-serval").value, comment=$("#f-comment").value.trim();
    if(serval==="Si"&&!comment)return toast("Serval = Si requiere comentario",true);
    db.states[id]={id,status:$("#f-status").value,date:$("#f-date").value,time:$("#f-time").value,shipping,total,sent,
      serval,comment,note:$("#f-note").value.trim(),updatedAt:nowISO()};
    save();$("#stateDialog").close();toast("Estado guardado");
    if(shipping==="Total")setTimeout(()=>alert("ENVÍO TOTAL: recuerda cerrar la orden de carga en SHP."),50);
    if(shipping==="Parcial")setTimeout(()=>alert(`ENVÍO PARCIAL: quedan ${palletsLeft(db.states[id])} pallets.`),50);
    render();
  };

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
        dock:prev.dock||"",
        registered:prev.registered||"No",
        located:prev.located||"No",
        five:prev.five||"No",
        sample:prev.sample||"Pendiente de sacar",
        comment:prev.comment||"",
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

  const initial=location.hash.replace("#",""); go(pages[initial]?initial:"inicio");
})();