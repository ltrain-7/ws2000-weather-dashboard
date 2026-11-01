(function attachDashboardLayout(root) {
  "use strict";

  const STORAGE_KEY = "dashboardLayoutV1";

  function normalizeLayout(value, availableIds) {
    const ids = uniqueStrings(availableIds);
    const available = new Set(ids);
    const order = uniqueStrings(value?.order).filter((id) => available.has(id));
    for (const id of ids) {
      if (!order.includes(id)) order.push(id);
    }
    const hidden = uniqueStrings(value?.hidden).filter((id) => available.has(id));
    if (hidden.length === ids.length && ids.length) hidden.pop();
    return { order, hidden };
  }

  function moveModule(layout, id, direction) {
    const order = [...layout.order];
    const from = order.indexOf(id);
    const to = Math.min(order.length - 1, Math.max(0, from + direction));
    if (from < 0 || from === to) return { ...layout, order };
    order.splice(from, 1);
    order.splice(to, 0, id);
    return { ...layout, order };
  }

  function setModuleHidden(layout, id, hidden) {
    const hiddenIds = new Set(layout.hidden);
    if (hidden) hiddenIds.add(id);
    else hiddenIds.delete(id);
    if (hiddenIds.size === layout.order.length && layout.order.length) hiddenIds.delete(id);
    return { ...layout, hidden: layout.order.filter((moduleId) => hiddenIds.has(moduleId)) };
  }

  function loadLayout(storage, availableIds) {
    try {
      return normalizeLayout(JSON.parse(storage.getItem(STORAGE_KEY) || "null"), availableIds);
    } catch {
      return normalizeLayout(null, availableIds);
    }
  }

  function saveLayout(storage, layout) {
    storage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }

  function uniqueStrings(values) {
    return Array.from(new Set(Array.isArray(values) ? values.filter((value) => typeof value === "string" && value) : []));
  }

  root.WeatherDashboardLayout = {
    STORAGE_KEY,
    loadLayout,
    moveModule,
    normalizeLayout,
    saveLayout,
    setModuleHidden
  };
})(window);
