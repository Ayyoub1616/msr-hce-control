(() => {
  const cfg=window.MSR_SUPABASE_CONFIG||{};
  const enabled=Boolean(cfg.url&&cfg.anonKey);
  const base=String(cfg.url||"").replace(/\/$/,"");
  const pollMs=12000;
  let timer=null;
  let lastUpdated=null;

  const authHeaders=()=>{
    const h={apikey:cfg.anonKey||""};
    if(String(cfg.anonKey||"").startsWith("eyJ"))h.Authorization=`Bearer ${cfg.anonKey}`;
    return h;
  };

  async function request(path,options={},timeoutMs=7000){
    if(!enabled)throw new Error("Nube no configurada");
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const res=await fetch(base+path,{
        ...options,
        signal:controller.signal,
        headers:{...authHeaders(),...(options.headers||{})}
      });
      if(!res.ok){
        let detail="";
        try{detail=await res.text()}catch{}
        throw new Error(`Nube HTTP ${res.status}${detail?": "+detail.slice(0,180):""}`);
      }
      return res;
    }catch(err){
      if(err?.name==="AbortError")throw new Error("Tiempo de espera agotado al conectar con la nube");
      throw err;
    }finally{
      clearTimeout(timeout);
    }
  }

  async function loadRecord(){
    const res=await request("/rest/v1/app_state?id=eq.main&select=payload,updated_at",{
      method:"GET",
      headers:{Accept:"application/json"}
    });
    const rows=await res.json();
    return rows?.[0]||null;
  }

  window.MSRCloud={
    enabled,
    transport:"REST-polling",
    async load(){
      const row=await loadRecord();
      if(row?.updated_at)lastUpdated=row.updated_at;
      return row?.payload||null;
    },
    async save(payload){
      await request("/rest/v1/app_state?on_conflict=id",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          Prefer:"resolution=merge-duplicates,return=minimal"
        },
        body:JSON.stringify({id:"main",payload,updated_at:new Date().toISOString()})
      });
      lastUpdated=null;
    },
    subscribe(onChange){
      if(timer)clearInterval(timer);
      let busy=false;
      const check=async()=>{
        if(busy||!navigator.onLine)return;
        busy=true;
        try{
          const row=await loadRecord();
          const stamp=row?.updated_at||null;
          if(lastUpdated===null){
            lastUpdated=stamp;
          }else if(stamp&&stamp!==lastUpdated){
            lastUpdated=stamp;
            if(row?.payload)onChange(row.payload);
          }
        }catch{
          // bootstrap/save paths surface connectivity errors; polling stays quiet.
        }finally{busy=false;}
      };
      check();
      timer=setInterval(check,pollMs);
      return {type:"polling",intervalMs:pollMs};
    },
    async clear(){
      await request("/rest/v1/app_state?id=eq.main",{method:"DELETE"});
      lastUpdated=null;
    },
    async diagnose(){
      const started=performance.now();
      const row=await loadRecord();
      return {
        ok:true,
        transport:"HTTPS REST",
        latencyMs:Math.round(performance.now()-started),
        hasCloudData:Boolean(row?.payload),
        updatedAt:row?.updated_at||null,
        pollingSeconds:pollMs/1000
      };
    }
  };
})();