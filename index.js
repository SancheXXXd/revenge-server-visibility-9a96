(() => {
  const { React, ReactNative: RN } = vendetta.metro.common;
  const { storage } = vendetta.plugin;
  const { findByStoreName } = vendetta.metro;
  const { after } = vendetta.patcher;
  const h = React.createElement;
  let patches = [];
  let timer = null;
  let panelFound = false;
  let itemObserved = false;
  if (!Array.isArray(storage.hiddenIds)) storage.hiddenIds = [];

  function hidden(id) {
    return id != null && Array.isArray(storage.hiddenIds) && storage.hiddenIds.some(x => String(x) === String(id));
  }
  function guildId(element) {
    const id = element?.props?.guildId;
    return typeof id === 'string' ? id : null;
  }
  function wrapPanel(ret) {
    const data = ret?.listDataProps;
    if (!data || typeof data.renderItem !== 'function' || typeof data.itemSize !== 'function') return ret;
    const render = data.renderItem;
    const size = data.itemSize;
    const copy = Object.assign({}, data, {
      renderItem: function (...args) {
        const element = Reflect.apply(render, this, args);
        const id = guildId(element);
        if (id) itemObserved = true;
        return id && hidden(id) ? null : element;
      },
      itemSize: function (...args) {
        try {
          // Query only the render callback for this position. Do not alter the
          // underlying guild tree, server ordering, membership or account data.
          const element = Reflect.apply(render, this, args);
          const id = guildId(element);
          if (id && hidden(id)) return 0;
        } catch (_) { /* keep Discord's original size if the shape differs */ }
        return Reflect.apply(size, this, args);
      }
    });
    return Object.assign({}, ret, { listDataProps: copy });
  }
  function scanPanel() {
    const modules = vendetta.metro.modules || globalThis.modules;
    if (!modules) return;
    for (const id in modules) {
      const def = modules[id];
      if (!def?.isInitialized) continue;
      const ex = def.publicModule?.exports;
      if (!ex || typeof ex.default !== 'function' || ex.default.name !== 'useGuildsBarProps') continue;
      if (patches.some(p => p.ex === ex)) continue;
      try {
        const un = after('default', ex, (_args, result) => wrapPanel(result));
        patches.push({ ex, un }); panelFound = true;
      } catch (e) { vendetta.logger.warn('Не удалось подключиться к панели серверов', e); }
    }
  }
  function Settings() {
    vendetta.storage.useProxy(storage);
    const ids = new Set(Array.isArray(storage.hiddenIds) ? storage.hiddenIds.map(String) : []);
    let guilds = [];
    try {
      const all = findByStoreName('GuildStore')?.getGuilds?.() || {};
      guilds = Object.values(all).filter(g => g?.id && g?.name).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) { vendetta.logger.error('Не удалось получить серверы', e); }
    const status = !panelFound
      ? 'Панель не найдена. Перезапусти Discord. Если это не помогло, версия Discord может быть несовместима.'
      : !itemObserved
      ? 'Панель найдена. Открой список серверов и вернись сюда. Если изменения не видны, перезапусти Discord.'
      : 'Включено — сервер виден; выключено — скрыт. После изменения перезапусти Discord. Скрытие только локальное.';
    return h(RN.ScrollView, {style:{flex:1},contentContainerStyle:{padding:16}},
      h(RN.Text, {style:{color:'#b5bac1',marginBottom:16}}, status),
      guilds.length ? guilds.map(g => {
        const id = String(g.id);
        return h(RN.View, {key:id,style:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingVertical:12,borderBottomWidth:1,borderBottomColor:'#3f4147'}},
          h(RN.View,{style:{flex:1,marginRight:10}},h(RN.Text,{style:{color:'#f2f3f5',fontSize:16}},String(g.name)),h(RN.Text,{style:{color:'#949ba4',fontSize:12,marginTop:3}},id)),
          h(RN.Switch,{value:!ids.has(id),onValueChange:visible => {
            const list = Array.isArray(storage.hiddenIds) ? Array.from(storage.hiddenIds).filter(x => String(x) !== id) : [];
            if (!visible) list.push(id);
            storage.hiddenIds = list;
          }})
        );
      }) : h(RN.Text,{style:{color:'#b5bac1'}},'Серверы не найдены. Открой Discord и зайди в настройки ещё раз.')
    );
  }
  return {
    onLoad() {
      panelFound = false; itemObserved = false;
      scanPanel(); let ticks = 0;
      timer = setInterval(() => { scanPanel(); if (++ticks >= 30 && timer) { clearInterval(timer); timer = null; } }, 1000);
    },
    onUnload() {
      if (timer) clearInterval(timer); timer = null;
      for (const p of patches) { try { p.un(); } catch (_) {} }
      patches = []; panelFound = false; itemObserved = false;
    },
    settings: Settings
  };
})()
