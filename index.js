(() => {
  const { React, ReactNative: RN } = vendetta.metro.common;
  const { storage } = vendetta.plugin;
  const { findByName, findByStoreName } = vendetta.metro;
  const { after } = vendetta.patcher;
  const h = React.createElement;
  let unpatch = null;
  let attached = false;
  let matched = false;
  let probes = [];
  let timer = null;
  let diagnostic = 'Поиск панели...';
  function shape(value) {
    if (value == null) return String(value);
    if (Array.isArray(value)) return 'массив';
    if (typeof value !== 'object') return typeof value;
    return Object.keys(value).slice(0, 25).map(k => {
      const v = value[k];
      return k + ':' + (Array.isArray(v) ? 'массив' : v === null ? 'null' : typeof v);
    }).join(', ');
  }
  let itemDiagnostic = 'Ожидание отображения панели';
  function structure(v, depth) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'Array[' + v.length + '](' + (depth > 0 && v.length ? structure(v[0], depth - 1) : '') + ')';
    if (typeof v !== 'object') return typeof v;
    if (depth <= 0) return 'object';
    const keys = Object.keys(v).slice(0, 12);
    return '{' + keys.map(k => (/^\d{7,}$/.test(k) ? '[ID]' : k) + ':' + structure(v[k], depth - 1)).join(', ') + '}';
  }
  function scanPanel() {
    const modules = vendetta.metro.modules || globalThis.modules;
    if (!modules) { diagnostic = 'Реестр модулей недоступен'; return; }
    let found = 0;
    for (const id in modules) {
      const def = modules[id];
      if (!def?.isInitialized) continue;
      const ex = def.publicModule?.exports;
      if (!ex || typeof ex.default !== 'function' || ex.default.name !== 'useGuildsBarProps') continue;
      found++;
      if (probes.some(p => p.ex === ex)) continue;
      try {
        const un = after('default', ex, (_args, ret) => {
          try {
            const data = ret?.listDataProps;
            diagnostic = 'Панель найдена. sections: ' + structure(data?.sections, 3);
            if (data && typeof data.renderItem === 'function') {
              const original = data.renderItem;
              const copy = Object.assign({}, data, {
                renderItem: function (...args) {
                  const result = original.apply(this, args);
                  try {
                    const p = result && result.props;
                    itemDiagnostic = 'Аргументы: ' + structure(args, 3) + '\nРезультат: ' + structure(result, 2) + '\nСвойства: ' + structure(p, 2);
                  } catch (_) {}
                  return result;
                }
              });
              return Object.assign({}, ret, { listDataProps: copy });
            }
          } catch (_) {}
        });
        probes.push({ ex, un });
      } catch (_) {}
    }
    if (probes.length && !diagnostic.startsWith('Панель найдена.')) diagnostic = 'Модуль панели найден, ожидается открытие списка серверов.';
    else if (!found && !probes.length) diagnostic = 'Модуль useGuildsBarProps не найден.';
  }
  if (!Array.isArray(storage.hiddenIds)) storage.hiddenIds = [];

  function filterTree(node, hidden) {
    if (Array.isArray(node)) return node.map(n => filterTree(n, hidden));
    if (!React.isValidElement(node)) return node;
    const props = node.props || {};
    let changes = null;
    if (Array.isArray(props.guildFolders)) {
      matched = true;
      const folders = props.guildFolders.map(folder => {
        if (!folder || !Array.isArray(folder.guildIds)) return folder;
        return Object.assign({}, folder, { guildIds: folder.guildIds.filter(id => !hidden.has(String(id))) });
      }).filter(folder => !folder || !Array.isArray(folder.guildIds) || folder.guildIds.length > 0);
      changes = { guildFolders: folders };
    }
    if (props.children != null) {
      const children = filterTree(props.children, hidden);
      if (children !== props.children) changes = Object.assign(changes || {}, { children });
    }
    return changes ? React.cloneElement(node, changes) : node;
  }
  function ListWrapper({ tree }) {
    vendetta.storage.useProxy(storage);
    const hidden = Array.isArray(storage.hiddenIds) ? storage.hiddenIds : [];
    return filterTree(tree, new Set(hidden.map(String)));
  }
  function Settings() {
    vendetta.storage.useProxy(storage);
    const hidden = new Set(Array.isArray(storage.hiddenIds) ? storage.hiddenIds.map(String) : []);
    let guilds = [];
    try {
      const store = findByStoreName('GuildStore');
      const all = store?.getGuilds?.() || {};
      guilds = Object.values(all).filter(g => g?.id && g?.name).sort((a,b) => a.name.localeCompare(b.name));
    } catch (e) { vendetta.logger.error('Не удалось получить серверы', e); }
    const status = !attached
      ? 'Список серверов не найден. Возможно, эта версия Discord несовместима. Попробуй перезапустить Discord.'
      : !matched ? 'Список серверов ещё не обнаружен. Перезапусти Discord и снова открой настройки.'
      : 'Переключатель включён — сервер виден. Выключен — скрыт. Только на этом устройстве.';
    const rows = guilds.map(g => {
      const id = String(g.id);
      return h(RN.View, {key:id, style:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingVertical:12,borderBottomWidth:1,borderBottomColor:'#3f4147'}},
        h(RN.View,{style:{flex:1,marginRight:10}},h(RN.Text,{style:{color:'#f2f3f5',fontSize:16}},String(g.name)),h(RN.Text,{style:{color:'#949ba4',fontSize:12,marginTop:3}},id)),
        h(RN.Switch,{value:!hidden.has(id),onValueChange:visible => {
          const list = Array.isArray(storage.hiddenIds) ? Array.from(storage.hiddenIds).filter(x => String(x) !== id) : [];
          if (!visible) list.push(id);
          storage.hiddenIds = list;
        }})
      );
    });
    return h(RN.ScrollView,{style:{flex:1},contentContainerStyle:{padding:16}},
      h(RN.Text,{style:{color:'#b5bac1',marginBottom:8}},status),
      h(RN.Text,{style:{color:'#b5bac1',marginBottom:16,fontSize:12}},'Диагностика (только структура): ' + diagnostic + '\n' + itemDiagnostic),
      guilds.length ? rows : h(RN.Text,{style:{color:'#b5bac1'}},'Серверы не найдены. Вернись в Discord и открой настройки ещё раз.')
    );
  }
  return {
    onLoad() {
      attached = false; matched = false;
      scanPanel(); let ticks = 0; timer = setInterval(() => { scanPanel(); if (++ticks >= 30 && timer) { clearInterval(timer); timer = null; } }, 1000);
      try {
        const module = findByName('GuildsConnected', false);
        if (module && typeof module.default === 'function') {
          unpatch = after('default', module, (_args, tree) => h(ListWrapper, {tree}));
          attached = true;
        } else vendetta.logger.warn('GuildsConnected не найден: интерфейс Discord мог измениться');
      } catch (e) { vendetta.logger.error('Не удалось подключить фильтр списка серверов', e); }
    },
    onUnload() { if (timer) clearInterval(timer); timer = null; for (const p of probes) p.un(); probes = []; if (unpatch) unpatch(); unpatch = null; attached = false; matched = false; },
    settings: Settings
  };
})()
