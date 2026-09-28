(() => {
  const cfg=window.MSR_SUPABASE_CONFIG||{};
  const enabled=Boolean(cfg.url&&cfg.anonKey&&window.supabase?.createClient);
  let client=null;
  let channel=null;
  if(enabled) client=window.supabase.createClient(cfg.url,cfg.anonKey);

  window.MSRCloud={
    enabled,
    async load(){
      if(!client)return null;
      const {data,error}=await client.from("app_state").select("payload,updated_at").eq("id","main").maybeSingle();
      if(error)throw error;
      return data?.payload||null;
    },
    async save(payload){
      if(!client)return;
      const {error}=await client.from("app_state").upsert({
        id:"main",
        payload,
        updated_at:new Date().toISOString()
      });
      if(error)throw error;
    },
    subscribe(onChange){
      if(!client)return null;
      if(channel)client.removeChannel(channel);
      channel=client
        .channel("msr-hce-live")
        .on("postgres_changes",{
          event:"*",
          schema:"public",
          table:"app_state",
          filter:"id=eq.main"
        },payload=>{
          const next=payload?.new?.payload;
          if(next)onChange(next);
        })
        .subscribe();
      return channel;
    },
    async clear(){
      if(!client)return;
      const {error}=await client.from("app_state").delete().eq("id","main");
      if(error)throw error;
    }
  };
})();